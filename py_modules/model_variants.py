"""Reviewed model capabilities, separate from upstream versions and input routes.

An official URL/digest proves where an archive came from, not which network its
converter generates. New model families need a reviewed recipe and payload
adapter before they can become selectable in either frontend.
"""
import hashlib
import json
from pathlib import Path
import re
import struct

DEFAULT_VARIANT = 'helixsr-model-e'
FSR4_IGPU_EXACT = 'fsr4-igpu-exact'
FSR4_IGPU_LOSSY = 'fsr4-igpu-lossy'
FSR4_VARIANTS = (FSR4_IGPU_EXACT, FSR4_IGPU_LOSSY)
ADAPTER = 'separate-network-v1'
FSR4_ADAPTER = 'fsr4-igpu-cyboman-v1'
MY_FSR_DLL = 'my-fsr/amd_fidelityfx_upscaler_dx12.dll'
RECIPE_FILES = (
    "helixsr-setup.sh",
    "setup/helixsr_setup.py",
    "setup/kernels/common/fp16.h",
    "setup/kernels/common/port_cpp.h",
    "setup/kernels/common/port_hlsl.hlsli",
    "setup/kernels/rt/px_common.h",
    "setup/kernels/rt/px_cpp.h",
    "setup/kernels/rt/px_hlsl.h",
    "setup/kernels/u5/u5_memory.h",
    "setup/lib/compact_hlsl.py",
    "setup/lib/compact_u5.py",
    "setup/lib/extract_ptx.py",
    "setup/lib/extract_weights.py",
    "setup/lib/family_hlsl.py",
    "setup/lib/family_k/gen_helper.py",
    "setup/lib/family_k/trace_frags.py",
    "setup/lib/family_k/two_sites.json",
    "setup/lib/family_k/validate.py",
    "setup/lib/family_u/gen_helper.py",
    "setup/lib/family_u/ptxsim_up.py",
    "setup/lib/family_u/trace_frags.py",
    "setup/lib/family_u/two_sites.json",
    "setup/lib/family_u/validate.py",
    "setup/lib/fast_tiles.py",
    "setup/lib/kernels.py",
    "setup/lib/load_fence.py",
    "setup/lib/model/launch_synth",
    "setup/lib/model/launch_synth.cpp",
    "setup/lib/model/launch_synth.exe",
    "setup/lib/model/model.cpp",
    "setup/lib/model/model.h",
    "setup/lib/model/model_gen.inc",
    "setup/lib/ptx2hlsl.py",
    "setup/lib/ptxsim.py",
    "setup/lib/regen_kernels.py",
    "setup/lib/samplers.py",
    "setup/lib/splitk_hlsl.py",
    "setup/lib/trace_tables.py",
    "setup/lib/u5_roll.py",
    "setup/lib/u5_rows.py",
)
REVIEWED_RECIPES = {
    'ac43f9144497a2e9f506d0bb05577328c667d3c657d466f469b9bf13558bb791': DEFAULT_VARIANT,
    '712dc923a8149fc0d2fcc6099d2f87df11d77c5999323a41bbc71075c8bd647d': DEFAULT_VARIANT,
}
FSR4_SPECS = {
    FSR4_IGPU_EXACT: dict(dll_member='exact/amd_fidelityfx_upscaler_dx12.dll',
                          marker=b'4.1.1-igpu-cyboman\x00'),
    FSR4_IGPU_LOSSY: dict(dll_member='lossy/amd_fidelityfx_upscaler_dx12.dll',
                          marker=b'4.1.1-igpu-lossy-cyboman\x00'),
}
VARIANTS = {
    DEFAULT_VARIANT: dict(id=DEFAULT_VARIANT, label='HelixSR Model E',
                          source='NVIDIA DLSS 310.7.0', adapter=ADAPTER,
                          routes=['direct', 'optiscaler']),
    FSR4_IGPU_EXACT: dict(id=FSR4_IGPU_EXACT, label='FSR 4.1.1 (iGPU Exact)',
                          source='fsr4-shader-performance-overrides (OptiScaler: HelixSR + FSR 4 Exact)', adapter=FSR4_ADAPTER,
                          routes=['direct', 'optiscaler']),
    FSR4_IGPU_LOSSY: dict(id=FSR4_IGPU_LOSSY, label='FSR 4.1.1 (iGPU Lossy)',
                          source='fsr4-shader-performance-overrides (OptiScaler: HelixSR + FSR 4 Lossy)', adapter=FSR4_ADAPTER,
                          routes=['direct', 'optiscaler']),
}
FUTURE_NOTE = ('Choose HelixSR Model E (NVIDIA DLSS 310.7.0) or FSR 4.1.1 iGPU (Exact/Lossy). '
               'Direct route installs the selected upscaler DLL directly; OptiScaler route '
               'installs HelixSR alongside the selected FSR 4 variant in HelixSR/my-fsr so you can '
               'switch between HelixSR and FSR 4 in real time in-game (both Exact and Lossy are '
               'prepared together for instant switching).')


def is_fsr4_variant(value):
    if isinstance(value, dict):
        value = value.get('id')
    return value in FSR4_VARIANTS


def select_variant(variant_id=None):
    key = DEFAULT_VARIANT if variant_id is None else variant_id
    if not isinstance(key, str) or key not in VARIANTS:
        raise ValueError('This HelixSR model is not supported. Update the app and check available variants.')
    return dict(VARIANTS[key])


def catalog():
    return dict(variants=[dict(v) for v in VARIANTS.values()], default=DEFAULT_VARIANT,
                note=FUTURE_NOTE)


def recipe_digest(package):
    expected = {n for n in RECIPE_FILES if n.startswith('setup/')}
    actual = {p.relative_to(package).as_posix() for p in (package / 'setup').rglob('*') if p.is_file()}
    if actual != expected | {'setup/helixsr_install.py'}:
        raise ValueError('This upstream model recipe needs support in an app update: conversion files changed')
    hashes = {}
    for name in RECIPE_FILES:
        path = package / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 4 << 20:
            raise ValueError('HelixSR model recipe is missing or unsafe: ' + name)
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()


def verify_recipe(package, variant_id=None):
    selected = select_variant(variant_id)
    digest = recipe_digest(package)
    if REVIEWED_RECIPES.get(digest) != selected['id']:
        raise ValueError('This upstream model recipe needs support in an app update. '
                         'No network was built and no game files were changed. '
                         'Check plugin or desktop app updates and report the HelixSR version.')
    return dict(id=selected['id'], adapter=selected['adapter'], recipe_sha256=digest)


def valid_variant(value):
    if not isinstance(value, dict) or not isinstance(value.get('id'), str) or value['id'] not in VARIANTS:
        return False
    if set(value) != {'id', 'adapter', 'recipe_sha256'}:
        return False
    spec = VARIANTS[value['id']]
    if value.get('adapter') != spec['adapter'] or not isinstance(value.get('recipe_sha256'), str):
        return False
    if spec['adapter'] == FSR4_ADAPTER:
        return bool(re.fullmatch(r'[a-f0-9]{64}', value['recipe_sha256']))
    return REVIEWED_RECIPES.get(value['recipe_sha256']) == value['id']


def verify_fsr4_archive(unpacked_dir, variant_id):
    selected = select_variant(variant_id)
    if selected['id'] not in FSR4_SPECS:
        raise ValueError('Selected variant is not an FSR 4 iGPU variant')
    spec = FSR4_SPECS[selected['id']]
    notice = unpacked_dir / 'NOTICE.md'
    dll_path = unpacked_dir / spec['dll_member']
    if not notice.is_file() or notice.is_symlink() or not dll_path.is_file() or dll_path.is_symlink():
        raise ValueError('Unexpected upstream FSR 4 archive layout: ' + spec['dll_member'])
    raw = dll_path.read_bytes()
    if len(raw) < 4096 or len(raw) > 256 << 20 or spec['marker'] not in raw:
        raise ValueError('FSR 4 DLL does not match the selected variant marker')
    digest = hashlib.sha256(raw).hexdigest()
    model = dict(id=selected['id'], adapter=selected['adapter'], recipe_sha256=digest)
    return model, dll_path


def verify_fsr4_outputs(package, variant=None):
    package = Path(package)
    if variant is None:
        manifest_path = package / 'helixsr_setup.json'
        if not manifest_path.is_file() or manifest_path.is_symlink() or manifest_path.stat().st_size > 65536:
            raise ValueError('Prepared FSR 4 manifest is missing or unsafe')
        data = json.loads(manifest_path.read_text(encoding='utf-8'))
        variant = data.get('model') if isinstance(data, dict) else None
    if not valid_variant(variant) or variant.get('id') not in FSR4_SPECS:
        raise ValueError('Invalid FSR 4 variant metadata')
    spec = FSR4_SPECS[variant['id']]
    dll_path = package / MY_FSR_DLL
    if not dll_path.is_file() or dll_path.is_symlink():
        raise ValueError('Prepared FSR 4 DLL is missing')
    raw = dll_path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != variant['recipe_sha256'] or spec['marker'] not in raw:
        raise ValueError('Prepared FSR 4 DLL does not match the selected variant identity')


SOURCE_SHA256 = 'be6e434a94ca32499515eb62ca0e6c274526055d568d0426e4c652dcdfb6ee6e'
WEIGHTS_SIZE = 1903872
WEIGHTS_SHA256 = '762adfde720035f7ac43910846e0ce6826c239bcd41f863196f77c547ae57153'
KERNEL_NAMES = tuple(('px_' + name).encode() for name in (
    'auto_exposure', 'auto_exposure_copy', 'clear_buffer', 'copy_exposure',
    'luma_convert', 'reduce_sum', 'u10', 'k8_rel', 'k8_hdr_colvar_mvhi',
    'k8_hdr_colvar_mvlo', 'k8_hdr_mvdiff_mvhi', 'k8_hdr_mvdiff_mvlo',
    'k8_ldr_colvar_mvhi', 'k8_ldr_colvar_mvlo', 'k8_ldr_mvdiff_mvhi',
    'k8_ldr_mvdiff_mvlo', 'k4', 'k9', 'k10', 'k11', 'u6', 'k7', 'u9',
    'u5', 'u8', 'k5', 'k5f', 'k5n', 'u4', 'u5_table'))


def verify_outputs(package):
    weights = package / 'helixsr_weights.bin'
    manifest = package / 'helixsr_setup.json'
    if not manifest.is_file() or manifest.stat().st_size > 4096:
        raise ValueError('Generated HelixSR model identity is missing; see the build log')
    data = json.loads(manifest.read_text(encoding='utf-8'))
    if (not isinstance(data, dict) or set(data) != {'source_sha256', 'ptx_target', 'shaders', 'wave64', 'weights_sha256'}
            or data['source_sha256'] != SOURCE_SHA256 or data['weights_sha256'] != WEIGHTS_SHA256
            or data['ptx_target'] not in ('sm_80', 'sm_89') or type(data['wave64']) is not bool
            or type(data['shaders']) is not int
            or data['shaders'] != len(KERNEL_NAMES) * (2 if data['wave64'] else 1)
            or weights.stat().st_size != WEIGHTS_SIZE
            or hashlib.sha256(weights.read_bytes()).hexdigest() != WEIGHTS_SHA256):
        raise ValueError('Generated HelixSR model does not match the selected Model E recipe')
    pak = package / 'helixsr_kernels.pak'
    with pak.open('rb') as source:
        header = source.read(16)
        if len(header) != 16 or header[:8] != b'HXSRKPAK':
            raise ValueError('Generated HelixSR kernels have an unsupported format')
        version, count = struct.unpack('<II', header[8:])
        if version != 2 or count != data['shaders']:
            raise ValueError('Generated HelixSR kernels do not match the model manifest')
        names, end = set(), 16 + 40 * count
        size = pak.stat().st_size
        for _ in range(count):
            row = source.read(40)
            if len(row) != 40:
                raise ValueError('Generated HelixSR kernel table is truncated')
            name, offset, length = struct.unpack('<32sII', row)
            name = name.split(b'\0', 1)[0]
            if not name or name in names or offset != end or not length or offset + length > size:
                raise ValueError('Generated HelixSR kernel table is invalid')
            names.add(name)
            end += length
        if end != size:
            raise ValueError('Generated HelixSR kernels have unexpected trailing bytes')
        expected = set(KERNEL_NAMES)
        if data['wave64']:
            expected |= {name + b'_w64' for name in KERNEL_NAMES}
        if names != expected:
            raise ValueError('Generated HelixSR kernels do not match the selected model recipe')


def variant_label(value):
    return VARIANTS[value['id']]['label'] if valid_variant(value) else 'Model unverified'


DEFAULT_OPTISCALER_CHANNEL = 'bundled'
OPTISCALER_NIGHTLY_CHANNEL = 'nightly'
OPTISCALER_CHANNELS = {
    DEFAULT_OPTISCALER_CHANNEL: dict(
        id=DEFAULT_OPTISCALER_CHANNEL,
        label='OptiScaler 0.9.4 (Bundled)',
        source='HelixSR official package (0.9.4)',
    ),
    OPTISCALER_NIGHTLY_CHANNEL: dict(
        id=OPTISCALER_NIGHTLY_CHANNEL,
        label='OptiScaler Nightly (Official)',
        source='optiscaler/OptiScaler-nightly',
    ),
}


def select_optiscaler_channel(channel=None):
    key = DEFAULT_OPTISCALER_CHANNEL if channel is None else channel
    if not isinstance(key, str) or key not in OPTISCALER_CHANNELS:
        raise ValueError('Unsupported OptiScaler build channel')
    return dict(OPTISCALER_CHANNELS[key])


def optiscaler_catalog():
    return dict(
        channels=[dict(v) for v in OPTISCALER_CHANNELS.values()],
        default=DEFAULT_OPTISCALER_CHANNEL,
    )


def valid_optiscaler_build(value):
    if value is None:
        return True
    if not isinstance(value, dict) or value.get('channel') not in OPTISCALER_CHANNELS:
        return False
    channel = value['channel']
    if channel == DEFAULT_OPTISCALER_CHANNEL:
        return (set(value) <= {'channel', 'label', 'version'}
                and isinstance(value.get('version'), str) and bool(value.get('version')))
    if channel == OPTISCALER_NIGHTLY_CHANNEL:
        if set(value) != {'channel', 'label', 'version', 'tag', 'release_sha256', 'dll_sha256', 'ini_sha256'}:
            return False
        return (isinstance(value.get('label'), str) and bool(value['label'])
                and isinstance(value.get('version'), str) and bool(value['version'])
                and isinstance(value.get('tag'), str) and bool(re.fullmatch(r'nightly-\d{8}(?:-[A-Za-z0-9._-]+)?', value['tag']))
                and all(isinstance(value.get(k), str) and bool(re.fullmatch(r'[a-f0-9]{64}', value[k]))
                        for k in ('release_sha256', 'dll_sha256', 'ini_sha256')))
    return False


def optiscaler_channel_of(record):
    if isinstance(record, dict):
        build = record.get('optiscaler_build')
        if isinstance(build, dict) and build.get('channel') in OPTISCALER_CHANNELS:
            return build['channel']
    return DEFAULT_OPTISCALER_CHANNEL


def optiscaler_label(value):
    if isinstance(value, dict) and valid_optiscaler_build(value):
        if value.get('channel') == OPTISCALER_NIGHTLY_CHANNEL:
            return f"OptiScaler Nightly ({value.get('version', 'latest')})"
        return value.get('label') or OPTISCALER_CHANNELS[DEFAULT_OPTISCALER_CHANNEL]['label']
    return OPTISCALER_CHANNELS[DEFAULT_OPTISCALER_CHANNEL]['label']


def verify_optiscaler_nightly_archive(unpacked_dir, release):
    unpacked_dir = Path(unpacked_dir)
    dll_path = unpacked_dir / 'OptiScaler.dll'
    ini_path = unpacked_dir / 'OptiScaler.ini'
    if not dll_path.is_file() or dll_path.is_symlink() or not ini_path.is_file() or ini_path.is_symlink():
        raise ValueError('Unexpected upstream OptiScaler Nightly archive layout')
    dll_raw = dll_path.read_bytes()
    if dll_raw[:2] != b'MZ' or len(dll_raw) < 4096 or len(dll_raw) > 256 << 20 or b'OptiScaler' not in dll_raw:
        raise ValueError('OptiScaler Nightly DLL failed identity verification')
    ini_raw = ini_path.read_bytes()
    if len(ini_raw) < 64 or len(ini_raw) > 1 << 20 or b'\x00' in ini_raw:
        raise ValueError('OptiScaler Nightly configuration is invalid or too large')
    from optiscaler_setup import parse_config
    ini_text = ini_raw.decode('utf-8-sig')
    parsed = parse_config(ini_text)
    has_ffx_path = any(parsed.has_option(s, 'FfxDx12Path') for s in parsed.sections())
    if not parsed.has_option('Upscalers', 'Dx12Upscaler') or not has_ffx_path:
        raise ValueError('OptiScaler Nightly configuration lacks required Upscalers/FfxDx12Path sections')
    dll_sha = hashlib.sha256(dll_raw).hexdigest()
    ini_sha = hashlib.sha256(ini_raw).hexdigest()
    ver = release.get('version', 'nightly')
    build = dict(
        channel=OPTISCALER_NIGHTLY_CHANNEL,
        label=f'OptiScaler Nightly ({ver})',
        version=ver,
        tag=release['tag'],
        release_sha256=release['sha256'],
        dll_sha256=dll_sha,
        ini_sha256=ini_sha,
    )
    return build, {'optiscaler/OptiScaler.dll': dll_path, 'optiscaler/OptiScaler.ini': ini_path}


def package_selection(record):
    """Path-independent identity binds model, release, recipe and output hashes."""
    fields = {k: record.get(k) for k in ('version', 'release_sha256', 'variant', 'files')}
    if isinstance(record, dict) and record.get('optiscaler_build'):
        fields['optiscaler_build'] = record['optiscaler_build']
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


def same_release(left, right):
    return all(left.get(key) == right.get(key) for key in ('version', 'sha256'))
