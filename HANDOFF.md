# Upscaler-Decky 작업 인수인계 문서 (HANDOFF)

다른 PC에서 작업을 이어갈 때 새 대화창에 `@HANDOFF.md`를 멘션하면 지금까지의 모든 설계 및 구현 맥락을 바로 불러올 수 있습니다.

---

## 1. 프로젝트 개요 및 베이스라인

- **플러그인 명칭**: `Upscaler-Decky` (`package.json`: `upscaler-decky`, 버전 `0.1.29`)
- **업스트림 베이스**: `dawoodtogoo2020-code/HelixSR-Decky` `v0.1.23` (`4564805`) 병합 완료
  - **HelixSR 1.8.1 공식 교체 레시피 검증**: 업스트림에서 갱신된 HelixSR 1.8.1 릴리즈 아카이브의 변경된 변환 스크립트 해시(`93930e...`)를 검증 테이블에 추가하여 설치 중단 에러 방지
  - **Steam 시작 옵션 콜백 멈춤 해결 (`src/launchDetails.ts`)**: OptiScaler 시작 옵션 등록 시 Steam 클라이언트의 비동기 콜백 누락/지연으로 인한 UI 무한 대기 버그 해결 (타임아웃 및 안전 구독 해제)
  - **Decky 플러그인 안전 종료 및 4초 예산 준수 (`py_modules/plugin_shutdown.py`)**: 언로드 시 Decky의 5초 강제 종료 데드라인 이전에 컴파일러 세션(`killpg`) 및 모니터를 4초 이내로 안전 정리하여 프로세스 및 파일 손상 방지
- **핵심 확장 목표**:
  1. **UI 레이아웃 대폭 간소화 및 불필요한 메뉴 정리 (`src/index.tsx`)**:
     - 사용자 피드백을 반영하여 불필요한 3개 메뉴 섹션(`게임 가져오기`, `고급 옵션 및 세부 진단`, `업스케일러 버전 및 가이드`)을 완전 제거
     - 플러그인 UI를 오직 핵심인 **게임 목록 / 업스케일러 설정**과 **플러그인 업데이트** 2개 패널 섹션으로 집중 구성
     - OptiScaler 게임의 필수 기능인 `Proton 프록시 시작 옵션 설정` 및 `플러그인 시작 옵션 변경 복원` 버튼은 메인 섹션의 게임 관리 영역으로 통합 유지
  2. **설치 불가/지원 제외 게임 드롭다운 선택 및 한국어 상세 원인 진단 지원 (`src/index.tsx`, `src/i18nKo.ts`)**:
     - 기존에는 지원 가능한 게임만 드롭다운에 표시되어 설치 불가능한 게임은 목록에서 아예 보이지 않던 문제를 해결
     - 설치 가능 게임뿐만 아니라 감지된 모든 게임을 드롭다운에 표시(`[설치 불가]` 태그 및 빨간색 상태선으로 구분)
     - 설치 불가 게임을 선택했을 때, 왜 설치가 불가능한지(DirectX 11 전용, 지원되는 업스케일러 DLL 부재, 안티치트 차단, 게임 실행 중, 다운로드 미완료 등)에 대한 구체적인 원인과 조치 방법을 친절한 한국어 안내 카드로 제공
     - 설치 불가능한 상태에서는 설치 버튼 및 하위 드롭다운을 안전하게 잠금 처리하여 오작동 방지
  3. **Steam Deck 드롭다운 선택 값 유지 및 재마운트 초기화 완벽 해결 (`src/index.tsx`)**:
     - Steam Deck QAM 특성상 드롭다운 팝업 모달이 열리고 닫힐 때 패널 컴포넌트(`Content`)가 언마운트 및 재마운트되는데, 이 과정에서 `useState`가 초기화되어 첫 번째 항목으로 되돌아가던 버그 해결
     - 모듈 스코프의 `savedGameSettings` 영구 저장소를 도입하여 게임별 `variant`, `optiChannel`, `route`, `executable` 선택값을 저장 및 유지
  4. **OptiScaler + FSR 4 실시간 연동 정상화 (`py_modules/manager.py`, `py_modules/optiscaler_setup.py`)**:
     - FSR 4 선택 시 `OptiScaler.ini`의 `FfxDx12Path` 및 `FfxDx12SRPath`를 `HelixSR/my-fsr/amd_fidelityfx_upscaler_dx12.dll`로 직접 연결하여 OptiScaler에서 선택한 FSR 4가 실제로 동작하도록 수정
     - `setup_report`에서 HelixSR 및 FSR 4 제공자 경로를 모두 유효한 설정으로 검증
  5. **HelixSR + FSR 4 모델 선택 및 동시 준비 지원**:
     - 기존 HelixSR 모델 외에 `FSR 4.1.1 iGPU Exact` 및 `Lossy` 2종 선택 지원
     - FSR 4 패키지 준비 시 Exact와 Lossy를 동시 빌드·캐싱하여 즉시 전환 지원
  4. **적용 방식(Integration Route) 사용자 선택 지원**:
     - `direct`(직접 교체) 및 `optiscaler`(OptiScaler 프록시) 선택 지원
  5. **OptiScaler 빌드 채널 선택 지원 (`0.9.4 Bundled` vs `Nightly Official`)**:
     - `0.9.4`와 `Nightly (v10+)` 간 전환/업데이트 시 `OptiScaler.ini` 양방향 자동 마이그레이션
  6. **Decky 패널 재마운트 시 설치 세션/작업 추적 보존 (`src/installSession.ts`)**:
     - 업스트림 `v0.1.21`의 `InstallSession` 및 `JobTracker` 도입으로 패널 재마운트 시 상태 손실 및 중복 설치 방지
  7. **Decky 플러그인 한국어 UI 현지화 (`src/index.tsx`, `src/i18nKo.ts`)**:
     - Decky 플러그인의 모든 UI 텍스트, 모달, 토스트 알림을 한국어로 현지화

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
- 플러그인 폴더명 및 릴리즈 아티팩트 명칭: `Upscaler-Decky` (`Upscaler-Decky-0.1.24.zip`)

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
- 생성 위치: 상위 폴더(`../Upscaler-Decky-0.1.25.zip`) 및 `release/Upscaler-Decky-0.1.25.zip`
