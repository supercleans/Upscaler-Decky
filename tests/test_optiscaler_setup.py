import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'py_modules'))
from optiscaler_setup import (
    config_generation,
    configuration,
    default_dx12_upscaler,
    migrate_config,
    override_status,
    pin_config,
    setup_report,
)


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / 'OptiScaler.ini'
        self.template = '[Upscalers]\nDx12Upscaler=auto\n[Paths]\nFfxDx12Path=auto\nFfxDx12SRPath=auto\n'
        self.settings = [('Dx12Upscaler', 'fsr31'), ('FfxDx12Path', 'Z:' + str(self.root / 'HelixSR/helixsr.dll').replace('/', '\\')),
                         ('FfxDx12SRPath', 'Z:' + str(self.root / 'HelixSR/helixsr_upscaler.dll').replace('/', '\\'))]

    def report(self):
        return setup_report(self.root, 'optiscaler', 'WINEDLLOVERRIDES="dxgi=n,b" %command%', [self.root / 'dxgi.dll'])

    def test_exact_backend_and_both_paths_required(self):
        source = pin_config(self.template, self.template, self.settings)
        self.config.write_text(source)
        self.assertTrue(self.report()['configured'])
        self.config.write_text(source.replace('Dx12Upscaler=fsr31', 'Dx12Upscaler=xess'))
        self.assertFalse(self.report()['configured'])
        self.config.write_text(source.replace('helixsr_upscaler.dll', 'other.dll'))
        self.assertFalse(self.report()['configured'])
        self.assertFalse(setup_report(self.root, 'direct', '')['configured'])

    def test_missing_input_and_custom_shortcut_are_actionable(self):
        self.config.write_text(pin_config(self.template, self.template, self.settings) +
                               '[Inputs]\nEnableDlssInputs=false\n[Nvapi]\nOverrideNvapiDll=false\nNvapiPath=custom.dll\n[Menu]\nShortcutKey=0x24\n')
        (self.root / 'nvapi64.dll').write_bytes(b'existing game file')
        report = self.report()
        text = '\n'.join(report['checks'])
        self.assertIn('DLSS input is disabled', text)
        self.assertIn('NVAPI handling is disabled', text)
        self.assertIn('existing nvapi64.dll', text)
        self.assertIn('Custom NvapiPath', text)
        self.assertIn('ShortcutKey=0x24', text)
        self.assertIn('supported FSR or XeSS input', text)
        self.assertIn('Frame generation is separate', text)
        self.assertEqual((self.root / 'nvapi64.dll').read_bytes(), b'existing game file')

    def test_override_distinguishes_missing_conflict_correct_and_unknown(self):
        for source, expected in [('', 'missing'), ('WINEDLLOVERRIDES="d3d11=n;dxgi=n,b" %command%', 'correct'),
                                 ('WINEDLLOVERRIDES="dxgi=b" %command%', 'conflict'),
                                 ('%command% WINEDLLOVERRIDES="dxgi=n,b"', 'unknown'),
                                 ('WINEDLLOVERRIDES="$RULE" %command%', 'unknown'),
                                 ('WINEDLLOVERRIDES="dxgi=n,b', 'unknown')]:
            with self.subTest(source=source):
                self.assertEqual(override_status(source), expected)

    def test_section_edits_preserve_other_bytes_and_insert_missing_keys(self):
        source = '; comment\r\n[Upscalers]\r\nDx12Upscaler=xess\r\n[Menu]\r\nShortcutKey=0x24\r\n[FrameGen]\r\nEnabled=false\r\n'
        result = pin_config(source, self.template, self.settings)
        self.assertIn('[Paths]\r\n', result)
        self.assertIn('FfxDx12Path=Z:', result.split('[Paths]\r\n')[1])
        self.assertIn('[Menu]\r\nShortcutKey=0x24\r\n[FrameGen]\r\nEnabled=false\r\n', result)
        self.assertTrue(result.startswith('; comment\r\n[Upscalers]\r\nDx12Upscaler=fsr31'))

    def test_misplaced_duplicate_and_malformed_settings_refuse(self):
        for source in ('[Other]\nDx12Upscaler=xess\n', self.template + '[Other]\nDx12Upscaler=xess\n',
                       self.template + '[Upscalers]\nDx12Upscaler=xess\n', '[broken\nDx12Upscaler=auto\n'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                pin_config(source, self.template, self.settings)

    def test_bom_commented_headers_and_colon_settings_preserve_choices(self):
        source = '\ufeff[Upscalers] ; chosen backend\r\nDx12Upscaler: xess\r\n[Paths]\r\nFfxDx12Path=auto\r\nFfxDx12SRPath=auto\r\n[Menu]\r\nShortcutKey=0x24\r\n'
        result = pin_config(source, self.template, self.settings)
        self.assertTrue(result.startswith('\ufeff[Upscalers] ; chosen backend\r\nDx12Upscaler=fsr31\r\n'))
        self.assertIn('[Menu]\r\nShortcutKey=0x24\r\n', result)

    def test_unusual_value_separators_do_not_create_phantom_lines(self):
        source = self.template + '[Menu]\nValue=hello\u2028Dx12Upscaler=keep\x0cworld\n'
        result = pin_config(source, self.template, self.settings)
        self.assertIn('Value=hello\u2028Dx12Upscaler=keep\x0cworld\n', result)

    def test_indented_key_like_continuation_is_preserved_or_refused(self):
        source = '[Upscalers]\nOther=value\n    Dx12Upscaler=continuation\n[Paths]\nFfxDx12Path=auto\nFfxDx12SRPath=auto\n'
        with self.assertRaisesRegex(ValueError, 'structure|safely'):
            pin_config(source, self.template, self.settings)

    def test_special_file_read_is_nonblocking_and_refused(self):
        self.config.write_text(self.template)
        real_open = os.open
        with patch('optiscaler_setup.os.open', wraps=real_open) as opened, patch('optiscaler_setup.stat.S_ISREG', return_value=False):
            self.assertIn('not a regular file', configuration(self.config)[1])
        if hasattr(os, 'O_NONBLOCK'):
            self.assertTrue(opened.call_args.args[1] & os.O_NONBLOCK)

    def test_duplicate_diagnostic_keys_do_not_claim_configured(self):
        self.config.write_text(self.template + '[Other]\nDx12Upscaler=fsr31\n')
        report = self.report()
        self.assertFalse(report['configured'])
        self.assertIn('Repeated setting', '\n'.join(report['checks']))

    def test_nightly_config_migration_and_bidirectional_pinning(self):
        v094_template = (
            '[Upscalers]\nDx11Upscaler=auto\nDx12Upscaler=auto\nVulkanUpscaler=auto\n'
            '[Nukems]\nMakeDepthCopy=auto\n'
            '[FSR]\nFsr4Update=auto\nFsr4ForceEnableInt8=auto\n'
            '[NvApi]\nOverrideNvapiDll=auto\nNvapiPath=auto\n'
            '[Menu]\nShortcutKey=auto\n'
            '[CAS]\nEnabled=auto\nUseDepthAwareSharpen=auto\nUseDASDepthAwareSharpen=auto\n'
            '[Paths]\nFfxDx12Path=auto\nFfxDx12SRPath=auto\nFfxDx12FGPath=auto\n'
        )
        nightly_template = (
            '[Upscalers]\nDx11Upscaler=auto\nDx12Upscaler=auto\nVulkanUpscaler=auto\n'
            '[DLSSG]\nEnabled=auto\n'
            '[NvngxFG]\nMakeDepthCopy=auto\n'
            '[FSR]\nFsr4Update=auto\nFsr4ForceModel=auto\n'
            '[fakenvapi]\nUseFakenvapi=auto\n'
            '[NvApi]\nNvapiPath=auto\n'
            '[Menu]\nShortcutKey=auto\n'
            '[Sharpness]\nOverrideSharpness=auto\nShader=auto\n'
            '[Magnifier]\nEnabled=auto\n'
            '[Paths]\nFfxDx12Path=auto\nFfxDx12SRPath=auto\nFfxDx12FGPath=auto\n'
        )
        self.assertEqual(config_generation(v094_template), '0.9.4')
        self.assertEqual(config_generation(nightly_template), 'nightly')
        self.assertEqual(default_dx12_upscaler(v094_template), 'fsr31')
        self.assertEqual(default_dx12_upscaler(nightly_template), 'ffx')

        customized_094 = (
            v094_template
            .replace('Dx11Upscaler=auto', 'Dx11Upscaler=fsr31_12')
            .replace('Dx12Upscaler=auto', 'Dx12Upscaler=fsr31')
            .replace('VulkanUpscaler=auto', 'VulkanUpscaler=fsr31')
            .replace('MakeDepthCopy=auto', 'MakeDepthCopy=true')
            .replace('Fsr4ForceEnableInt8=auto', 'Fsr4ForceEnableInt8=true')
            .replace('OverrideNvapiDll=auto', 'OverrideNvapiDll=false')
            .replace('ShortcutKey=auto', 'ShortcutKey=0x24')
            .replace('UseDepthAwareSharpen=auto', 'UseDepthAwareSharpen=true')
            .replace('UseDASDepthAwareSharpen=auto', 'UseDASDepthAwareSharpen=true')
        )
        nightly_settings = [
            ('Dx12Upscaler', default_dx12_upscaler(nightly_template)),
            ('FfxDx12Path', self.settings[1][1]),
            ('FfxDx12SRPath', self.settings[2][1]),
        ]
        pinned_nightly = pin_config(customized_094, nightly_template, nightly_settings)
        self.assertIn('Dx11Upscaler=ffx_12', pinned_nightly)
        self.assertIn('Dx12Upscaler=ffx', pinned_nightly)
        self.assertIn('VulkanUpscaler=ffx', pinned_nightly)
        self.assertIn('[NvngxFG]\nMakeDepthCopy=true', pinned_nightly)
        self.assertIn('Fsr4ForceModel=2', pinned_nightly)
        self.assertIn('[fakenvapi]\nUseFakenvapi=false', pinned_nightly)
        self.assertIn('ShortcutKey=0x24', pinned_nightly)
        self.assertIn('Shader=lcda', pinned_nightly)
        self.assertIn('[Magnifier]\nEnabled=auto', pinned_nightly)

        self.config.write_text(pinned_nightly)
        report = self.report()
        self.assertTrue(report['configured'])
        self.assertEqual(report['optiscaler_schema'], 'nightly')
        self.assertIn('Automatic fakenvapi/NVAPI handling is disabled', '\n'.join(report['checks']))
        self.assertIn('OptiScaler Nightly (v10+) configuration detected', '\n'.join(report['checks']))

        v094_settings = [
            ('Dx12Upscaler', default_dx12_upscaler(v094_template)),
            ('FfxDx12Path', self.settings[1][1]),
            ('FfxDx12SRPath', self.settings[2][1]),
        ]
        pinned_back_094 = pin_config(pinned_nightly, v094_template, v094_settings)
        self.assertIn('Dx11Upscaler=fsr31_12', pinned_back_094)
        self.assertIn('Dx12Upscaler=fsr31', pinned_back_094)
        self.assertIn('VulkanUpscaler=fsr31', pinned_back_094)
        self.assertIn('[Nukems]\nMakeDepthCopy=true', pinned_back_094)
        self.assertIn('Fsr4ForceEnableInt8=true', pinned_back_094)
        self.assertIn('[NvApi]\nOverrideNvapiDll=false', pinned_back_094)
        self.assertIn('ShortcutKey=0x24', pinned_back_094)
        self.assertIn('UseDepthAwareSharpen=true', pinned_back_094)
        self.assertIn('UseDASDepthAwareSharpen=true', pinned_back_094)


if __name__ == '__main__':
    unittest.main()
