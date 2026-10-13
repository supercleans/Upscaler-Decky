# Upscaler-Decky 작업 인수인계 문서 (HANDOFF)

다른 PC에서 작업을 이어갈 때 새 대화창에 `@HANDOFF.md`를 멘션하면 지금까지의 모든 설계 및 구현 맥락을 바로 불러올 수 있습니다.

---

## 1. 프로젝트 개요 및 베이스라인

- **플러그인 명칭**: `Upscaler-Decky` (`package.json`: `upscaler-decky`, 버전 `0.1.23`)
- **업스트림 베이스**: `dawoodtogoo2020-code/HelixSR-Decky` `v0.1.21` (`a3c0d21`) 병합 완료 (패널 재마운트 시 설치 확인 및 진행 상태 보존)
- **핵심 확장 목표**:
  1. **HelixSR + FSR 4 모델 선택 및 동시 준비 지원**:
     - 기존 HelixSR 모델 4종(`default`, `quality-6b`, `balanced-2b`, `speed-2b`) 외에
     - `zgauthier2000/fsr4-shader-performance-overrides` 저장소의 공식 릴리즈(`fsr4.1.1-igpu-cyboman.zip`)에서 제공하는 **FSR 4.1.1 iGPU 셰이더 오버라이드 2종**(`fsr4-igpu-exact`, `fsr4-igpu-lossy`)을 선택하여 다운로드 및 적용 가능
     - `fsr4.1.1-igpu-cyboman.zip` 준비 시 **`Exact`와 `Lossy` 두 가지 패키지를 동시에 빌드·캐싱**하여 재다운로드 없이 즉시 교체 가능
  2. **적용 방식(Integration Route) 사용자 선택 지원**:
     - 네이티브 FidelityFX DX12 업스케일러 DLL을 보유한 게임에서도 사용자가 **`direct`(직접 DLL 교체)** 또는 **`optiscaler`(OptiScaler 프록시 경유)** 방식을 직접 선택 가능
     - `direct` 경로 + FSR 4 선택 시: 게임의 `amd_fidelityfx_upscaler_dx12.dll`을 선택한 FSR 4 DLL로 백업 후 직접 교체
     - `optiscaler` 경로 + FSR 4 선택 시: HelixSR과 함께 `HelixSR/my-fsr/amd_fidelityfx_upscaler_dx12.dll`에 선택한 FSR 4 DLL(`Exact` 또는 `Lossy`)을 배치하고 인게임 `Insert` 메뉴(`Upscaling → Upscalers → FFX Upscaler`)에서 HelixSR과 FSR 4를 실시간으로 전환 가능
  3. **OptiScaler 빌드 채널 선택 지원 (`0.9.4 Bundled` vs `Nightly Official`)**:
     - `optiscaler` 경로 사용 시, HelixSR 패키지에 번들된 **OptiScaler 0.9.4 (`bundled`)**와 공식 나이틀리 저장소(`optiscaler/OptiScaler-nightly`)에서 최신 `.7z` 릴리즈를 받아오는 **OptiScaler Nightly (`nightly`, v10.0.0-pre1+)** 중 선택 가능
     - **OptiScaler.ini 양방향 자동 마이그레이션**: `0.9.4`와 `Nightly (v10+)` 간 전환/업데이트 시 사용자의 기존 커스텀 설정을 보존하면서 바뀐 섹션·키·값을 자동 변환
  4. **Decky 패널 재마운트 시 설치 세션/작업 추적 보존 (`src/installSession.ts`)**:
     - 업스트림 `v0.1.21`의 `InstallSession` 및 `JobTracker`를 도입하여 Steam Deck QAM 메뉴가 닫혔다 다시 열려도 설치 진행 상태와 피드백을 유지하고 중복 클릭 및 경쟁 상태 방지
  5. **Decky 플러그인 한국어 UI 현지화 (`src/index.tsx`, `src/i18nKo.ts`)**:
     - Decky 플러그인의 모든 섹션, 버튼, 드롭다운, 모달, 토스트 알림 및 상태/가이드 메시지를 한국어로 현지화

---

## 2. 주요 아키텍처 및 수정된 파일 목록

### A. 업스케일러 모델 & OptiScaler 채널 정의 (`py_modules/model_variants.py`)
- **FSR 4 Variant 상수 및 검증**:
  - `FSR4_IGPU_EXACT = 'fsr4-igpu-exact'`, `FSR4_IGPU_LOSSY = 'fsr4-igpu-lossy'`
  - `is_fsr4_variant(variant_id)`: 선택된 모델이 FSR 4인지 판별
  - `verify_fsr4_archive(archive_path, release, variant_id)` / `verify_fsr4_outputs(package_dir)`
- **OptiScaler 빌드 채널 상수 및 검증**:
  - `DEFAULT_OPTISCALER_CHANNEL = 'bundled'`, `OPTISCALER_NIGHTLY_CHANNEL = 'nightly'`
  - `OPTISCALER_CHANNELS`, `select_optiscaler_channel`, `optiscaler_catalog`, `valid_optiscaler_build`, `optiscaler_channel_of`, `optiscaler_label`
  - `verify_optiscaler_nightly_archive(unpacked_dir, release)`: 추출된 Nightly `.7z` 내 `OptiScaler.dll` (PE 헤더 및 서명) 및 `OptiScaler.ini` 섹션 검증

### B. GitHub 릴리즈 메타데이터 조회 (`py_modules/github_release.py`)
- **HelixSR**: `lonewolf0622/HelixSR` (`web_latest_release`)
- **FSR 4**: `zgauthier2000/fsr4-shader-performance-overrides` (`web_latest_fsr4_release`, 태그 `dll-YYYY-MM-DD`, 에셋 `fsr4.1.1-igpu-cyboman.zip`)
- **OptiScaler Nightly**: `optiscaler/OptiScaler-nightly` (`web_latest_optiscaler_nightly_release`, 태그 `nightly-YYYYMMDD`, 에셋 `OptiScaler_v*_YYYYMMDD.7z`)
- GitHub API 호출 제한(Rate Limit 403/429) 발생 시 HTML `releases` 및 `expanded_assets` 파싱 + `HEAD` 요청으로 SHA256 및 파일 크기를 안전하게 검증

### C. `OptiScaler.ini` 세대 감지 및 양방향 마이그레이션 (`py_modules/optiscaler_setup.py`)
- `config_generation(source)`:
  - `'nightly'`: `[fakenvapi]`의 `UseFakenvapi`, `[Sharpness]`의 `Shader`, `[Magnifier]`, `[DLSSG]` 등으로 v10+ 스키마 감지
  - `'0.9.4'`: `[NvApi]`의 `OverrideNvapiDll`, `[CAS]`의 `UseDepthAwareSharpen`, `[Nukems]` 등으로 0.9.4 스키마 감지
- `default_dx12_upscaler(template)`:
  - `0.9.4` 템플릿은 `Dx12Upscaler=fsr31`, `nightly` 템플릿은 `Dx12Upscaler=ffx` 반환
- `migrate_config(source, template)` & `pin_config(source, template, settings)`:
  - `0.9.4` ↔ `nightly` 간 변경된 주요 설정 자동 매핑:
    - `[Upscalers] Dx11Upscaler`: `fsr31_12` ↔ `ffx_12`
    - `[Upscalers] Dx12Upscaler`: `fsr31` ↔ `ffx`
    - `[Upscalers] VulkanUpscaler`: `fsr31` / `fsr31_12` ↔ `ffx` / `ffx_12`
    - `[NvApi] OverrideNvapiDll` ↔ `[fakenvapi] UseFakenvapi`
    - `[Nukems] MakeDepthCopy` ↔ `[NvngxFG] MakeDepthCopy`
    - `[FSR] Fsr4ForceEnableInt8=true` ↔ `[FSR] Fsr4ForceModel=2`
    - `[CAS] UseDepthAwareSharpen` / `UseDASDepthAwareSharpen` ↔ `[Sharpness] Shader` (`da`/`dascas`, `lcda`)
- `setup_report`:
  - `Dx12Upscaler`가 `fsr31` 또는 `ffx`일 때 모두 정상 설정으로 인정하며 `optiscaler_schema` 필드를 반환하고, `HelixSR/my-fsr` 내 FSR 4가 `iGPU Exact`인지 `iGPU Lossy`인지 구분하여 표시

### D. 패키지 준비 및 설치 매니저 (`py_modules/manager.py`)
- **릴리즈 확인 메서드**:
  - `check_update(force=False)` (HelixSR)
  - `check_fsr4_update(force=False)` (FSR 4)
  - `check_optiscaler_nightly_update(force=False)` (OptiScaler Nightly)
  - `check_variant_update(variant_id=None, force=False)`
- **패키지 준비 흐름 (`start_job` / `prepare`)**:
  - `route` (`direct` | `optiscaler`), `variant_id`, `optiscaler_channel` (`bundled` | `nightly`) 조합을 지원
  - `_prepare_fsr4`: FSR 4 `.zip` 1회 다운로드·검증 시 `fsr4-igpu-exact`와 `fsr4-igpu-lossy` 두 패키지를 동시에 생성 및 캐싱 (필요 시 `optiscaler` 베이스 패키지 준비 포함)
  - `_prepare_optiscaler_nightly`: `safe_extract_7z` (`7z` / `7zz` / `7za` / `bsdtar` 지원)로 Nightly `.7z` 압축 해제 및 검증 후 베이스 패키지의 `optiscaler/OptiScaler.dll`, `optiscaler/OptiScaler.ini`를 교체한 파생 패키지 생성 (FSR 4 형제 패키지도 함께 Nightly 파생 패키지 생성)
- **게임 상태 진단 및 적용 (`assess`, `preview_latest`, `preview`, `mutate`, `install_payload`)**:
  - 게임별로 `available_routes`, `route`, `installed_variant`, `installed_optiscaler`, `installed_optiscaler_channel` 반환
  - `install_payload`에서 `OptiScaler.ini` 핀닝 시 템플릿 세대에 맞춰 `default_dx12_upscaler(template)` 적용

### E. 백엔드 브리지 및 프론트엔드/데스크톱 UI
- `main.py` & `desktop/backend.py`:
  - `check_fsr4_update`, `check_optiscaler_nightly_update` 노출
  - `preview_latest`, `preview_action`, `prepare`에 `variant_id`, `route`, `optiscaler_channel` 전달
- `src/index.tsx` & `src/i18nKo.ts` (Decky 플러그인 한국어 React UI) & `desktop/app.py` (데스크톱 PySide6 UI):
  - **설치 방식 (경로)** 선택 드롭다운 (`네이티브 FSR 3.1 DLL 직접 교체 (Direct)` / `OptiScaler 프록시 (DLSS/XeSS/FSR2 경유)`)
  - **업스케일러 모델** 선택 드롭다운 (HelixSR + FSR 4 2종)
  - **OptiScaler 빌드** 선택 드롭다운 (`route === 'optiscaler'`일 때 표시: `OptiScaler 0.9.4 (Bundled)` / `OptiScaler Nightly (Official)`)
  - 게임 상세 정보에 `설치된 모델`, `설치된 OptiScaler` 및 한국어 가이드 표시

### F. 브랜딩 및 패키징 (`package.json`, `plugin.json`, `py_modules/plugin_updates.py`, `scripts/package.py`)
- 플러그인 폴더명 및 릴리즈 아티팩트 명칭: `Upscaler-Decky` (`Upscaler-Decky-0.1.23.zip`)

---

## 3. 빌드 및 테스트 명령어

### Python 단위 테스트 실행
> `tests/` 폴더 내부 모듈 간 상대 임포트가 있으므로 반드시 `-s tests` 옵션을 사용합니다.

```powershell
# 전체 테스트 실행
py -m unittest discover -s tests -p "test_*.py"

# OptiScaler 설정 및 마이그레이션 테스트만 빠르게 실행
py -m unittest discover -s tests -p "test_optiscaler_setup.py"

# 모델 Variant / FSR 4 / OptiScaler Nightly 테스트 실행
py -m unittest discover -s tests -p "test_model_variants.py"
```

### 프론트엔드 타입 체크, 빌드 및 테스트
```powershell
npm run typecheck
npm run build
npm run test:frontend
```

### Decky 설치용 릴리즈 ZIP 패키징
```powershell
py scripts/package.py
```
- 생성 위치: 상위 폴더(`../Upscaler-Decky-0.1.23.zip`) 및 `release/Upscaler-Decky-0.1.23.zip`
