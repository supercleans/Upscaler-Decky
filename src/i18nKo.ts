export function koStatusLabel(label: string): string {
  const map: Record<string, string> = {
    "Enabled": "활성화됨",
    "Disabled": "비활성화됨",
    "Not installed": "미설치",
    "Existing HelixSR": "기존 설치됨",
    "Needs review": "점검 필요",
    "Recovery needed": "복구 필요",
    "Choose executable": "실행 파일 선택 필요",
    "Game running": "게임 실행 중",
    "Unsupported": "지원되지 않음",
    "Ready": "설치 가능",
  };
  return map[label] || label;
}

export function koStatusSummary(summary: string): string {
  if (!summary) return summary;
  return summary
    .replace("HelixSR is not installed for this game", "이 게임에 업스케일러가 아직 설치되지 않았습니다")
    .replace("Existing HelixSR installation", "기존 HelixSR 설치가 감지되었습니다")
    .replace(/HelixSR enabled · /g, "업스케일러 활성화됨 · ")
    .replace(/HelixSR disabled · /g, "업스케일러 비활성화됨 · ")
    .replace(/Recorded as enabled · /g, "기록된 상태: 활성화됨 · ")
    .replace(/Recorded as disabled · /g, "기록된 상태: 비활성화됨 · ")
    .replace(/unknown version/g, "버전 미확인")
    .replace(/Needs review:/g, "점검 필요:")
    .replace(/Recovery needed:/g, "복구 필요:")
    .replace(/Unsupported:/g, "지원되지 않음:")
    .replace(/Game running/g, "게임 실행 중")
    .replace("File changes paused until the game closes.", "게임이 종료될 때까지 파일 변경이 일시 중지됩니다.");
}

export function koLibraryView(view: { summary: string; hint: string }): { summary: string; hint: string } {
  let summary = view.summary;
  if (summary === "Library scan failed") summary = "라이브러리 스캔 실패";
  else if (summary === "Refreshing library…") summary = "라이브러리 새로고침 중…";
  else if (summary === "Detecting installed games…") summary = "설치된 게임 검색 중…";
  else {
    const m = summary.match(/^(\d+) games found · (\d+) installation candidates · (\d+) unavailable$/);
    if (m) {
      summary = `감지된 게임 ${m[1]}개 · 설치 가능 ${m[2]}개 · 설치 불가 ${m[3]}개`;
    }
  }

  let hint = view.hint;
  if (hint.startsWith("Showing the previous scan")) {
    const m = hint.match(/\((\d+) games\)/);
    hint = `이전 스캔 결과(${m ? m[1] : ""}개 게임)를 표시 중입니다. 아래 오류를 확인한 뒤 새로고침하세요.`;
  } else if (hint === "The library could not be read. Fix the error below, then refresh the library.") {
    hint = "라이브러리를 읽을 수 없습니다. 아래 오류를 확인한 뒤 새로고침하세요.";
  } else if (hint.startsWith("No installed game folders were found.")) {
    hint = "설치된 게임 폴더를 찾지 못했습니다. Steam 라이브러리 드라이브가 마운트되어 있는지 확인 후 새로고침하거나, 아래 '게임 가져오기'에서 런처/폴더를 추가하세요.";
  } else if (hint.startsWith("Your games were found, but none can be selected")) {
    hint = "게임이 검색되었으나 현재 바로 설치 가능한 게임이 없습니다. 아래 '설치 불가 게임' 목록에서 원인과 해결 방법을 확인하세요.";
  } else if (hint.startsWith("Some games are unavailable.")) {
    hint = "일부 게임은 현재 설치할 수 없습니다. 아래 '설치 불가 게임' 버튼을 눌러 사유를 확인하세요.";
  }
  return { summary, hint };
}

export function koInstallReason(reason: string): string {
  if (!reason) return reason;
  if (reason === "Wait for this game's details to finish loading.") {
    return "게임 상세 정보를 불러오는 중입니다. 잠시만 기다려 주세요.";
  }
  if (reason === "Resolve this game's review reasons, then refresh.") {
    return "위 점검 필요 사유를 먼저 해결한 후 새로고침해 주세요.";
  }
  if (reason.startsWith("Confirm DirectX 12 above before installing.")) {
    return "설치 전에 위의 '게임이 DirectX 12로 설정됨' 스위치를 켜서 확인해 주세요. (플러그인이 게임 내 렌더러 설정을 대신 변경하지는 않습니다.)";
  }
  return koStatusSummary(reason);
}

export function koGuidance(
  guidance: { headline: string; steps: string[]; notes: string[]; links: { label: string; url: string }[] } | undefined
) {
  if (!guidance) return undefined;
  let headline = guidance.headline
    .replace(": Installing / preparing HelixSR…", ": 업스케일러 준비 및 설치 중…")
    .replace("Not installed", "미설치 — 설치 준비 완료")
    .replace("Ready to install", "설치 가능")
    .replace("Finish Proton launch setup", "Proton 시작 옵션 설정 필요")
    .replace("Ready to launch", "게임 실행 준비 완료")
    .replace("Disabled", "비활성화됨");

  const steps = guidance.steps.map(s =>
    s
      .replace(
        "Wait for completion. Progress and cancellation are below; game files cannot be changed during this operation.",
        "완료될 때까지 기다려 주세요. 아래에서 진행 상황 확인 및 취소가 가능하며, 작업 중에는 게임 파일을 변경할 수 없습니다."
      )
      .replace(
        /Choose Install HelixSR for this game\./g,
        "'이 게임에 업스케일러 설치' 버튼을 누르세요."
      )
      .replace(
        /Launch the game with DirectX 12 and select AMD FSR in game graphics settings\./g,
        "게임을 DirectX 12 모드로 실행한 뒤 게임 내 그래픽 설정에서 AMD FSR을 선택하세요."
      )
      .replace(
        /Use Review Proton proxy launch option so Proton loads dxgi\.dll\./g,
        "'Proton 프록시 시작 옵션 설정' 버튼을 눌러 Proton이 dxgi.dll을 로드하도록 설정하세요."
      )
      .replace(
        /Launch the game with DirectX 12 and enable DLSS \(or XeSS\/FSR input\) in game settings\./g,
        "게임을 DirectX 12로 실행하고 그래픽 설정에서 DLSS(또는 XeSS/FSR 입력)를 켜세요. 인게임 Insert 키로 OptiScaler 메뉴를 열어 HelixSR과 FSR 4를 실시간 전환할 수 있습니다."
      )
  );

  const notes = guidance.notes.map(n =>
    n
      .replace(
        /HelixSR does not include frame generation\./g,
        "HelixSR 자체에는 프레임 생성(FG)이 포함되지 않으며, 원본 게임 또는 OptiScaler의 FG 설정은 그대로 유지됩니다."
      )
  );

  return { ...guidance, headline, steps, notes };
}

export function koModelNote(note: string): string {
  if (!note) return note;
  if (note.includes("Choose HelixSR Model E")) {
    return "HelixSR Model E (NVIDIA DLSS 310.7.0) 또는 FSR 4.1.1 iGPU (Exact / Lossy) 모델을 선택할 수 있습니다. Direct 경로는 선택한 업스케일러 DLL을 직접 교체하며, OptiScaler 경로는 HelixSR과 함께 HelixSR/my-fsr에 선택한 FSR 4를 설치하여 게임 중 Insert 메뉴(Upscaling → Upscalers → FFX Upscaler)에서 실시간으로 비교·전환할 수 있습니다. (FSR 4 다운로드 시 Exact와 Lossy가 동시에 준비되어 이후 즉시 전환됩니다.)";
  }
  return note;
}

export function koCheckLine(line: string): string {
  return line
    .replace(
      "FSR 4 is installed in HelixSR/my-fsr (iGPU Exact); press Insert in-game and use Upscaling -> Upscalers -> FFX Upscaler to switch between HelixSR and FSR 4 in real time",
      "HelixSR/my-fsr에 FSR 4 (iGPU Exact)가 함께 설치되어 있습니다. 게임 중 Insert 키를 눌러 Upscaling -> Upscalers -> FFX Upscaler 메뉴에서 HelixSR과 FSR 4를 실시간으로 전환할 수 있습니다."
    )
    .replace(
      "FSR 4 is installed in HelixSR/my-fsr (iGPU Lossy); press Insert in-game and use Upscaling -> Upscalers -> FFX Upscaler to switch between HelixSR and FSR 4 in real time",
      "HelixSR/my-fsr에 FSR 4 (iGPU Lossy)가 함께 설치되어 있습니다. 게임 중 Insert 키를 눌러 Upscaling -> Upscalers -> FFX Upscaler 메뉴에서 HelixSR과 FSR 4를 실시간으로 전환할 수 있습니다."
    )
    .replace(
      "FSR 4 is installed in HelixSR/my-fsr; press Insert in-game and use Upscaling -> Upscalers -> FFX Upscaler to switch between HelixSR and FSR 4 in real time",
      "HelixSR/my-fsr에 FSR 4가 함께 설치되어 있습니다. 게임 중 Insert 키를 눌러 Upscaling -> Upscalers -> FFX Upscaler 메뉴에서 HelixSR과 FSR 4를 실시간으로 전환할 수 있습니다."
    );
}

export function koIssueTitle(title: string): string {
  const map: Record<string, string> = {
    "DirectX 11 is unsupported": "DirectX 11 미지원",
    "Game running": "게임 실행 중",
    "Anti-cheat restriction": "안티치트 보안 차단",
    "Steam update in progress": "Steam 업데이트/다운로드 진행 중",
    "Managed files changed": "설치된 파일 외부 변경됨",
    "Original file restored": "원본 파일 복원됨",
    "Installed file missing": "설치된 파일 누락됨",
    "Steam build changed": "Steam 게임 빌드 변경됨",
    "Existing injector or configuration": "기존 외부 모드/인젝터 파일 충돌",
    "Unmanaged original DLL backup": "기존 원본 백업 파일 충돌",
    "Existing HelixSR installation": "기존 HelixSR 설치 감지됨",
    "Executable needs review": "실행 파일 선택 필요",
    "DX12 needs confirmation": "DirectX 12 확인 필요",
    "Supported route unavailable": "지원되는 업스케일러 경로 없음",
    "Recovery needed": "복구 작업 필요",
  };
  return map[title] || title;
}

export function koReason(reason: string): string {
  if (!reason) return "";
  if (reason.includes("uses DirectX 11 only")) {
    return "이 게임은 DirectX 11 전용으로 구동됩니다. HelixSR 및 FSR 4는 DirectX 12(DX12)가 필수이며, 플러그인이 게임 자체의 렌더러를 변경할 수는 없습니다.";
  }
  if (reason.includes("No supported DLSS, XeSS, FSR 2 or native FSR 3.1")) {
    return "게임 폴더 내에 교체 가능한 DLSS, XeSS, FSR 2/3 또는 네이티브 FSR 3.1 DLL 파일이 감지되지 않았습니다. 자체 그래픽 엔진을 사용하거나 업스케일러가 탑재되지 않은 게임입니다.";
  }
  if (reason.includes("Anti-cheat files detected")) {
    return "안티치트(EasyAntiCheat, BattlEye 등) 보안 프로그램이 감지되었습니다. 게임 계정 제재(밴)를 방지하기 위해 파일 주입이 차단되었습니다.";
  }
  if (reason === "Game is running; close it before any file changes") {
    return "게임이 현재 실행 중입니다. 파일 손상을 방지하기 위해 게임을 완전히 종료한 후 다시 시도해 주세요.";
  }
  if (reason.includes("StateFlags must be 4") || reason.includes("Steam download staging exists")) {
    return "Steam에서 게임 다운로드 또는 업데이트가 아직 완료되지 않았습니다. 다운로드가 끝난 후 새로고침해 주세요.";
  }
  if (reason.includes("Main executable is not x64")) {
    return "64비트(x64) Windows 실행 파일이 아닙니다. (32비트 구형 게임 또는 네이티브 리눅스 게임)";
  }
  if (reason.includes("Existing unmanaged injector/configuration")) {
    return "외부에서 이미 수동으로 복사해 둔 인젝터 파일(dxgi.dll, OptiScaler.ini 등)이 존재합니다. 충돌을 방지하려면 기존 모드 파일을 먼저 삭제해 주세요.";
  }
  if (reason.includes("Unmanaged original DLL backup exists")) {
    return "관리되지 않은 원본 백업 파일(*.original.dll)이 이미 존재합니다.";
  }
  if (reason.includes("Managed files changed")) {
    return "설치된 업스케일러 파일이 게임 무결성 검사 또는 외부 패치로 인해 변경되었습니다. 원본 복원 후 재설치를 권장합니다.";
  }
  if (reason.includes("Steam build changed")) {
    return "Steam 게임 빌드가 업데이트되어 파일 점검이 필요합니다.";
  }
  if (reason.includes("HelixSR requires an x86_64 host")) {
    return "x86_64 시스템 환경이 필요합니다.";
  }
  if (reason.includes("DX12 is not confirmed by executable imports")) {
    return "실행 파일에서 DX12가 즉시 확인되지 않았습니다. 인게임 그래픽 설정에서 렌더러가 DirectX 12로 설정되어 있는지 확인해 주세요.";
  }
  return reason;
}

export function koIssueStep(step: string): string {
  if (!step) return "";
  if (step.includes("Close the game normally")) {
    return "게임을 완전히 종료한 후 상태를 새로고침하세요.";
  }
  if (step.includes("Keep HelixSR installation blocked")) {
    return "계정 보호를 위해 이 게임에는 업스케일러 설치가 제한됩니다.";
  }
  if (step.includes("Let Steam finish the installation or update")) {
    return "Steam 업데이트가 완료될 때까지 기다린 후 새로고침하세요.";
  }
  if (step.includes("Use the game's built-in upscaling instead")) {
    return "게임 내 자체 업스케일러(FSR 1 등) 또는 해상도 스케일을 사용하세요.";
  }
  if (step.includes("Review the named files with the tool that installed them")) {
    return "기존 모드 파일을 게임 폴더에서 수동으로 제거해 주세요.";
  }
  if (step.includes("Choose the x64 Windows game executable")) {
    return "게임이 실제로 실행하는 64비트 메인 exe 파일을 선택하세요.";
  }
  return step;
}

export function koGameUnavailableExplanation(game: any): string {
  if (!game) return "";
  const reasons: string[] = game.installation_status?.issues?.map((i: any) => i.reason) || game.reasons || [];
  for (const r of reasons) {
    if (r.includes("uses DirectX 11 only") || game.renderer_unsupported) {
      return "이 게임은 DirectX 11 전용으로 구동됩니다. HelixSR 및 FSR 4는 DirectX 12(DX12)가 필수이며, 플러그인이 게임 자체의 렌더러를 DirectX 12로 바꿀 수는 없습니다. 게임 내 자체 그래픽 설정을 사용해 주세요.";
    }
    if (r.includes("No supported DLSS, XeSS, FSR 2 or native FSR 3.1")) {
      return "게임 폴더 내에 교체 가능한 DLSS, XeSS, FSR 2/3 또는 네이티브 FSR 3.1 DLL 파일이 감지되지 않았습니다. 자체 그래픽 엔진을 사용하거나 지원되는 업스케일러 기술이 탑재되지 않은 게임입니다.";
    }
    if (r.includes("Anti-cheat files detected")) {
      return "안티치트(EasyAntiCheat, BattlEye 등) 보안 프로그램이 감지되었습니다. 게임 계정 제재(밴)를 방지하기 위해 파일 주입이 자동으로 차단되었습니다.";
    }
    if (r.includes("Game is running")) {
      return "게임이 현재 실행 중입니다. 파일 손상을 방지하기 위해 게임을 완전히 종료한 후 다시 확인해 주세요.";
    }
    if (r.includes("Main executable is not x64")) {
      return "64비트(x64) Windows 실행 파일이 아닙니다. 32비트 구형 게임이거나 네이티브 리눅스 바이너리 게임입니다.";
    }
    if (r.includes("StateFlags must be 4") || r.includes("Steam download staging exists")) {
      return "Steam에서 게임 다운로드 또는 업데이트가 아직 완료되지 않았습니다. 다운로드가 완료된 후 다시 확인해 주세요.";
    }
    if (r.includes("Existing unmanaged injector/configuration")) {
      return "외부에서 수동으로 복사해 둔 인젝터 파일(dxgi.dll, OptiScaler.ini 등)이 이미 존재합니다. 충돌을 방지하려면 기존 모드 파일을 먼저 삭제해 주세요.";
    }
  }
  if (reasons.length) {
    return reasons.map(koReason).join("\n");
  }
  return "이 게임은 현재 환경에서 지원되는 업스케일러 구성이 감지되지 않았습니다.";
}
