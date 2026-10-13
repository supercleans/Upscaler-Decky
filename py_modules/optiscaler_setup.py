"""Read-only checks and shared instructions for the installed proxy route."""
import configparser
import os
import stat
from pathlib import Path
import re
import shlex


GUIDE = 'https://github.com/dawoodtogoo2020-code/HelixSR-Decky/blob/main/OPTISCALER_GUIDE.md'
KEYS = ('Dx12Upscaler', 'FfxDx12Path', 'FfxDx12SRPath', 'FfxDx12FGPath', 'EnableDlssInputs',
        'NvapiPath', 'OverrideNvapiDll', 'UseFakenvapi', 'Dxgi', 'ShortcutKey',
        'UpscalerIndex', 'Fsr4ForceModel')
MANAGED_KEYS = {'dx12upscaler', 'ffxdx12path', 'ffxdx12srpath', 'ffxdx12fgpath'}


def parse_config(source):
    parser = configparser.ConfigParser(interpolation=None, strict=True)
    try:
        parser.read_string(source.lstrip('\ufeff'))
    except configparser.Error as exc:
        raise ValueError('Invalid or repeated configuration setting: ' + str(exc)[:200]) from exc
    return parser


def config_generation(source):
    """Identify whether an OptiScaler.ini text follows the 0.9.4 or v10+ Nightly schema."""
    try:
        parser = parse_config(source)
    except ValueError:
        return None
    sections = {s.lower(): s for s in parser.sections()}
    has_fakenvapi = 'fakenvapi' in sections and parser.has_option(sections['fakenvapi'], 'UseFakenvapi')
    has_override_nvapi = 'nvapi' in sections and parser.has_option(sections['nvapi'], 'OverrideNvapiDll')
    if has_fakenvapi and not has_override_nvapi:
        return 'nightly'
    if has_override_nvapi and not has_fakenvapi:
        return '0.9.4'
    return None


def default_dx12_upscaler(template):
    """Return the canonical DX12 FFX upscaler code for the given OptiScaler.ini template."""
    return 'ffx' if config_generation(template) == 'nightly' else 'fsr31'


def _replace_section_option(source, section, key, value):
    parsed = parse_config(source)
    newline = '\r\n' if '\r\n' in source else '\n'
    lines = re.split(r'(?<=\n)', source)
    current, header, replaced = '', None, False
    for i, line in enumerate(lines):
        match = parsed.SECTCRE.match(line.strip())
        if match:
            current = match['header']
            if current == section:
                header = i
        elif current == section and re.match(r'[ \t]*' + re.escape(key) + r'[ \t]*[=:]', line, re.I):
            ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
            lines[i] = key + '=' + value + ending
            replaced = True
    if not replaced:
        if header is None:
            source += ('' if not source or source.endswith(('\n', '\r')) else newline) + '[' + section + ']' + newline + key + '=' + value + newline
        else:
            if not lines[header].endswith(('\n', '\r')):
                lines[header] += newline
            lines.insert(header + 1, key + '=' + value + newline)
            source = ''.join(lines)
    else:
        source = ''.join(lines)
    return source


def migrate_config(source, template):
    """Migrate user-customized settings when switching OptiScaler.ini between 0.9.4 and Nightly."""
    bom = '\ufeff' if source.startswith('\ufeff') else ''
    source_body = source.removeprefix('\ufeff')
    template_body = template.removeprefix('\ufeff')
    src_gen = config_generation(source_body)
    tpl_gen = config_generation(template_body)
    if not src_gen or not tpl_gen or src_gen == tpl_gen:
        return source
    src_parser = parse_config(source_body)
    tpl_parser = parse_config(template_body)
    tpl_raw = configparser.ConfigParser(interpolation=None, strict=True)
    tpl_raw.optionxform = str
    tpl_raw.read_string(template_body)
    tpl_sections = {s.lower(): s for s in tpl_raw.sections()}
    tpl_options = {
        s.lower(): {k.lower(): k for k in tpl_raw.options(s)}
        for s in tpl_raw.sections()
    }
    overrides = []
    for sec in src_parser.sections():
        sec_lower = sec.lower()
        for opt_lower, raw_val in src_parser.items(sec):
            val = raw_val.strip()
            if not val or val.lower() == 'auto' or opt_lower in MANAGED_KEYS:
                continue
            target_sec = None
            target_key = None
            target_val = val
            if src_gen == '0.9.4' and tpl_gen == 'nightly':
                if sec_lower == 'nvapi' and opt_lower == 'overridenvapidll':
                    target_sec, target_key = 'fakenvapi', 'UseFakenvapi'
                elif sec_lower == 'nukems' and opt_lower == 'makedepthcopy':
                    target_sec, target_key = 'NvngxFG', 'MakeDepthCopy'
                elif sec_lower == 'fsr' and opt_lower == 'fsr4forceenableint8':
                    if val.lower() in ('true', '1', 'on'):
                        target_sec, target_key, target_val = 'FSR', 'Fsr4ForceModel', '2'
                    elif val.lower() in ('false', '0', 'off'):
                        target_sec, target_key, target_val = 'FSR', 'Fsr4ForceModel', '0'
                    else:
                        continue
                elif sec_lower == 'upscalers' and opt_lower == 'dx11upscaler':
                    target_sec, target_key = 'Upscalers', 'Dx11Upscaler'
                    if val.lower() == 'fsr31_12':
                        target_val = 'ffx_12'
                elif sec_lower == 'upscalers' and opt_lower == 'vulkanupscaler':
                    target_sec, target_key = 'Upscalers', 'VulkanUpscaler'
                    if val.lower() == 'fsr31':
                        target_val = 'ffx'
                    elif val.lower() == 'fsr31_12':
                        target_val = 'ffx_12'
                elif sec_lower == 'cas' and opt_lower == 'usedepthawaresharpen' and val.lower() in ('true', '1', 'on'):
                    target_sec, target_key, target_val = 'Sharpness', 'Shader', 'da'
                elif sec_lower == 'cas' and opt_lower == 'usedasdepthawaresharpen' and val.lower() in ('true', '1', 'on'):
                    target_sec, target_key, target_val = 'Sharpness', 'Shader', 'lcda'
            elif src_gen == 'nightly' and tpl_gen == '0.9.4':
                if sec_lower == 'fakenvapi' and opt_lower == 'usefakenvapi':
                    target_sec, target_key = 'NvApi', 'OverrideNvapiDll'
                elif sec_lower == 'nvngxfg' and opt_lower == 'makedepthcopy':
                    target_sec, target_key = 'Nukems', 'MakeDepthCopy'
                elif sec_lower == 'fsr' and opt_lower == 'fsr4forcemodel':
                    if val == '2':
                        target_sec, target_key, target_val = 'FSR', 'Fsr4ForceEnableInt8', 'true'
                    elif val == '0':
                        target_sec, target_key, target_val = 'FSR', 'Fsr4ForceEnableInt8', 'false'
                    else:
                        continue
                elif sec_lower == 'upscalers' and opt_lower == 'dx11upscaler':
                    target_sec, target_key = 'Upscalers', 'Dx11Upscaler'
                    if val.lower() == 'ffx_12':
                        target_val = 'fsr31_12'
                elif sec_lower == 'upscalers' and opt_lower == 'vulkanupscaler':
                    target_sec, target_key = 'Upscalers', 'VulkanUpscaler'
                    if val.lower() == 'ffx':
                        target_val = 'fsr31'
                    elif val.lower() == 'ffx_12':
                        target_val = 'fsr31_12'
                elif sec_lower == 'sharpness' and opt_lower == 'shader':
                    if val.lower() in ('da', 'dascas'):
                        target_sec, target_key, target_val = 'CAS', 'UseDepthAwareSharpen', 'true'
                    elif val.lower() == 'lcda':
                        overrides.append(('CAS', 'UseDepthAwareSharpen', 'true'))
                        target_sec, target_key, target_val = 'CAS', 'UseDASDepthAwareSharpen', 'true'
                    else:
                        continue
            if target_sec is None:
                if sec_lower in tpl_sections and opt_lower in tpl_options.get(sec_lower, {}):
                    target_sec = tpl_sections[sec_lower]
                    target_key = tpl_options[sec_lower][opt_lower]
            if target_sec and target_key and tpl_parser.has_option(target_sec, target_key):
                overrides.append((target_sec, target_key, target_val))
    migrated = template_body
    if '\r\n' in source_body and '\r\n' not in migrated:
        migrated = migrated.replace('\n', '\r\n')
    elif '\r\n' not in source_body and '\r\n' in migrated:
        migrated = migrated.replace('\r\n', '\n')
    for sec, key, val in overrides:
        migrated = _replace_section_option(migrated, sec, key, val)
    return bom + migrated


def pin_config(source, template, settings):
    """Change only unique managed settings in their upstream sections."""
    src_gen = config_generation(source)
    tpl_gen = config_generation(template)
    if src_gen and tpl_gen and src_gen != tpl_gen:
        source = migrate_config(source, template)
    bom = '\ufeff' if source.startswith('\ufeff') else ''
    source = source.removeprefix('\ufeff')
    parsed, upstream = parse_config(source), parse_config(template)
    original = {s: dict(parsed.items(s)) for s in parsed.sections()}
    defaults = dict(parsed.defaults())
    managed = set()
    for key, value in settings:
        expected = [s for s in upstream.sections() if upstream.has_option(s, key)]
        present = [s for s in parsed.sections() if parsed.has_option(s, key)]
        if len(expected) != 1:
            raise ValueError('Upstream OptiScaler configuration changed: ' + key)
        section = expected[0]
        managed.add((section, key.lower()))
        if present and present != [section]:
            raise ValueError('Managed configuration setting is misplaced or repeated: ' + key)
        source = _replace_section_option(source, section, key, value)
        parsed = parse_config(source)
        if parsed.get(section, key) != value:
            raise ValueError('Managed configuration setting could not be safely updated: ' + key)
    unchanged = lambda data: {(s, k): v for s, items in data.items() for k, v in items.items() if (s, k) not in managed}
    if defaults != dict(parsed.defaults()) or unchanged(original) != unchanged({s: dict(parsed.items(s)) for s in parsed.sections()}):
        raise ValueError('Configuration structure needs manual review; unrelated settings would change')
    return bom + source


def configuration(path):
    path = Path(path)
    if not path.exists():
        return {}, 'Configuration is not installed'
    try:
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_BINARY', 0)
        with os.fdopen(os.open(path, flags), 'rb') as f:
            info = os.fstat(f.fileno())
            if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_size > 1 << 20:
                raise ValueError('Configuration is not a regular file or is too large')
            raw = f.read((1 << 20) + 1)
        if len(raw) > 1 << 20 or b'\x00' in raw:
            raise ValueError('Configuration is too large or invalid')
        parser = parse_config(raw.decode('utf-8-sig'))
        values = {}
        for section in parser.sections():
            for key in KEYS:
                if parser.has_option(section, key):
                    if key in values:
                        raise ValueError('Repeated setting needs review: ' + key)
                    values[key] = parser.get(section, key).strip()
        return values, ''
    except (OSError, ValueError, UnicodeError, configparser.Error) as exc:
        return {}, 'Configuration needs review: ' + str(exc)[:200]


def override_status(options):
    if re.search(r'[$`\n\r]|&&|\|\||[<>]', options):
        return 'unknown'
    try:
        tokens = shlex.split(options)
    except ValueError:
        return 'unknown'
    overrides = [t for t in tokens if t.startswith('WINEDLLOVERRIDES=')]
    if not overrides:
        return 'missing'
    if len(overrides) != 1:
        return 'conflict'
    # An assignment after the command can be a game argument, not its environment.
    position = tokens.index(overrides[0])
    if any(not re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*=.*', t) for t in tokens[:position]):
        return 'unknown'
    rules = []
    for rule in overrides[0].split('=', 1)[1].split(';'):
        names, _, modes = rule.partition('=')
        names = [n.strip().lower().removesuffix('.dll') for n in names.split(',')]
        if '*' in names:
            return 'unknown'
        if 'dxgi' in names:
            rules.append(modes.replace(' ', '').lower())
    return 'correct' if rules == ['n,b'] else 'conflict' if rules else 'missing'


def setup_report(target, route, options, proxy_files=()):
    directory = Path(target) if target else None
    if directory and (directory.is_file() or directory.suffix.lower() == '.dll'):
        directory = directory.parent
    values, error = configuration(directory / 'OptiScaler.ini') if directory else ({}, 'No target folder detected')
    expected = {key: 'Z:' + str(directory / 'HelixSR' / name).replace('/', '\\')
                for key, name in [('FfxDx12Path', 'helixsr.dll'), ('FfxDx12SRPath', 'helixsr_upscaler.dll')]} if directory else {}
    paths_match = bool(expected) and all(values.get(k, '').strip('"\'') == v for k, v in expected.items())
    is_nightly_schema = 'UseFakenvapi' in values and 'OverrideNvapiDll' not in values
    valid_backends = ('fsr31', 'ffx') if is_nightly_schema else ('fsr31', 'ffx')
    configured = route == 'optiscaler' and values.get('Dx12Upscaler', '').lower() in valid_backends and paths_match and not error
    required = ('dxgi.dll', 'fakenvapi.dll', 'fakenvapi.ini', 'HelixSR/helixsr.dll',
                'HelixSR/helixsr_upscaler.dll', 'HelixSR/helixsr_weights.bin', 'HelixSR/helixsr_kernels.pak')
    missing = [name for name in required if not directory or not (directory / name).is_file()]
    launch = override_status(options)
    key = values.get('ShortcutKey', 'auto')
    shortcut = 'Insert (default)' if key.lower() == 'auto' else 'overlay shortcut disabled' if key == '-1' else 'configured ShortcutKey=' + key
    checks = []
    if route == 'optiscaler':
        checks.append('Install adds OptiScaler, fakenvapi and HelixSR automatically for this route.')
        if is_nightly_schema:
            checks.append('OptiScaler Nightly (v10+) configuration detected (`Dx12Upscaler=ffx`, built-in `[fakenvapi]`).')
        if missing:
            checks.append('Missing setup files: ' + ', '.join(missing))
        if error:
            checks.append(error)
        elif not configured:
            checks.append('HelixSR backend or provider paths differ. Review Update HelixSR to restore the managed route while retaining other settings.')
        if launch != 'correct':
            checks.append('DXGI launch override: ' + launch + '. Review the proxy launch option in Steam or your launcher.')
        if not any(Path(p).parent == directory and Path(p).name.lower() == 'dxgi.dll' for p in proxy_files):
            checks.append('OptiScaler DXGI proxy identity has not been detected in the target folder.')
        if values.get('EnableDlssInputs', '').lower() in ('false', 'off', '0'):
            checks.append('DLSS input is disabled in OptiScaler.ini. Review EnableDlssInputs before expecting the game to offer DLSS.')
        if values.get('UseFakenvapi', '').lower() in ('false', 'off', '0') or values.get('OverrideNvapiDll', '').lower() in ('false', 'off', '0'):
            checks.append('Automatic fakenvapi/NVAPI handling is disabled. Review this per-game choice if DLSS input is missing.')
        if directory and (directory / 'nvapi64.dll').exists():
            checks.append('An existing nvapi64.dll may affect DLSS input. It is not replaced; review OptiScaler.log and NvapiPath.')
        if values.get('NvapiPath', 'auto').lower() != 'auto':
            checks.append('Custom NvapiPath is configured. Verify it points to your intended per-game NVAPI provider.')
        checks.append('Run the game in DX12. Open OptiScaler using ' + shortcut + '. Select Upscaling → Upscalers → FFX: FSR HelixSR (3.1.5).')
        my_fsr_dll = directory / 'HelixSR/my-fsr/amd_fidelityfx_upscaler_dx12.dll' if directory else None
        if my_fsr_dll and my_fsr_dll.is_file():
            flavor = ''
            try:
                head = my_fsr_dll.read_bytes()[:4 << 20]
                if b'4.1.1-igpu-lossy-cyboman\x00' in head:
                    flavor = ' (iGPU Lossy)'
                elif b'4.1.1-igpu-cyboman\x00' in head:
                    flavor = ' (iGPU Exact)'
            except OSError:
                pass
            checks.append('FSR 4 is installed in HelixSR/my-fsr' + flavor + '. In OptiScaler (' + shortcut + '), open Upscaling → Upscalers → FFX Upscaler to switch between FSR HelixSR (3.1.5) and FSR 4.1.1.')
        checks.append('If DLSS is unavailable, use a supported FSR or XeSS input if the game offers one. Input name alone does not identify the output backend. Otherwise collect a fresh OptiScaler.log.')
        checks.append('Check a fresh helixsr.log for neural output, then check gameplay for artifacts or crashes. Installed files and a mapped proxy alone do not prove rendering.')
    elif route == 'direct':
        checks.append('Native FSR 3.1 replacement: select AMD FSR in the game. This route does not need OptiScaler or an additional DXGI override.')
    else:
        checks.append('No supported route detected. Review compatibility reasons before installing.')
    checks.append('Frame generation is separate. Existing settings are preserved; HelixSR does not add frame generation.')
    return dict(configured=configured, backend=values.get('Dx12Upscaler', 'unknown'),
                optiscaler_schema='nightly' if is_nightly_schema else '0.9.4',
                provider_paths_match=paths_match, override=launch, overlay_shortcut=shortcut,
                settings=values, missing=missing, checks=checks, guide=GUIDE)
