import { ButtonItem, DropdownItem, PanelSection, PanelSectionRow, TextField,
  ToggleField, ConfirmModal, showModal, staticClasses } from "@decky/ui";
import { callable, definePlugin, openFilePicker, toaster } from "@decky/api";
import { ReactNode, useEffect, useRef, useState } from "react";
import { FaAdjust } from "react-icons/fa";
import { proxyOptions } from "./launchOptions";
import { PluginInstaller, PluginArtifact } from "./pluginInstaller";
import { canRestore, gameStatus, installReadiness, nextStep } from "./gameStatus";
import { librarySelectable, libraryStatus } from "./libraryStatus";
import { koCheckLine, koGuidance, koInstallReason, koLibraryView, koStatusLabel, koStatusSummary } from "./i18nKo";
import { InstallSession, JobTracker } from "./installSession";

declare const DeckyBackend: { callable: <A extends unknown[], R>(route: string) => (...args: A) => Promise<R>;
  addEventListener?: (event: string, listener: (...args: any[]) => void) => unknown;
  removeEventListener?: (event: string, listener: (...args: any[]) => void) => void } | undefined;
type PluginUpdate = { current_version: string; latest_version: string | null; update_available: boolean;
  auto_check: boolean; checked_at: number; attempted_at: number; error: string; page: string; pending: boolean };
const pluginUpdateStatus = callable<[], PluginUpdate>("plugin_update_status");
const checkPluginUpdates = callable<[boolean], PluginUpdate>("check_plugin_updates");
const setPluginAutoCheck = callable<[boolean], PluginUpdate>("set_plugin_auto_check");
const preparePluginUpdate = callable<[], PluginArtifact>("prepare_plugin_update");
const resumePluginUpdate = callable<[], PluginArtifact>("resume_plugin_update");
const cancelPluginUpdate = callable<[], PluginUpdate>("cancel_plugin_update");
let latestPluginStatus: PluginUpdate | undefined;
let pluginUpdateTimer: ReturnType<typeof setInterval> | undefined;
let pluginUpdatePolling = false;
let notifiedPluginVersion = "";
const pluginUpdateListeners = new Set<(status: PluginUpdate) => void>();
function publishPluginStatus(status: PluginUpdate) {
  if (pluginDisposed) return;
  latestPluginStatus = status;
  pluginUpdateListeners.forEach(listener => listener(status));
  if (status.update_available && !status.error && status.latest_version !== notifiedPluginVersion) {
    notifiedPluginVersion = status.latest_version || "";
    toaster.toast({ title: "Upscaler Decky 업데이트 가능", body: `플러그인 ${status.latest_version} 버전이 준비되었습니다. '플러그인 업데이트' 섹션에서 확인하세요.`, duration: 6000 });
  }
}
function pollPluginStatus() {
  if (pluginUpdatePolling || pluginDisposed) return;
  pluginUpdatePolling = true;
  void pluginUpdateStatus().then(publishPluginStatus).catch(() => {}).finally(() => { pluginUpdatePolling = false; });
}

type FG = { source: string; key: string; value: string; enabled: boolean | null; meaning: string; path: string };
type Game = { id: string; name: string; folder: string; source: string; compatibility: string;
  installation_status?: { state: "ready" | "running" | "review" | "unsupported" | "recovery"; label: string; summary: string;
    running: boolean; selectable: boolean; can_modify: boolean; can_restore?: boolean; issues: {code: string; title: string; reason: string; steps: string[]; blocking: boolean}[] };
  appid?: string;
  reasons: string[]; route: string | null; available_routes?: string[]; inputs: string[]; managed: boolean; enabled: boolean;
  legacy: boolean; recovery_available?: boolean; installed_version?: string; package_version?: string; dx12_confirmation_needed: boolean;
  main_exe?: string; target?: string; installed_model?: string; installed_variant?: string;
  installed_optiscaler?: string; installed_optiscaler_channel?: string;
  executable_choices?: { path: string; dx12: boolean }[]; selected_executable?: string; executable_selection_needed?: boolean;
  awareness_warnings?: string[];
  awareness_deferred?: boolean;
  setup_guidance?: {action: string; headline: string; steps: string[]; notes: string[]; links: {label: string; url: string}[]};
  optiscaler: { present: boolean | null; involved: boolean; helix_configured?: boolean | null; runtime: string; dlls: string[];
    setup?: { checks: string[]; backend: string; override: string; overlay_shortcut: string; settings: Record<string, string>; guide: string } };
  framegen: FG[]; framegen_summary: string; helix_runtime: string;
  launch_options: string; logs?: { path: string; modified: number; excerpt: string }[] };
type Release = { version?: string; error?: string; checked_at?: number; page?: string };
type ModelCatalog = { variants: { id: string; label: string; source: string }[]; default: string; note: string };
type OptiScalerCatalog = { channels: { id: string; label: string; source: string }[]; default: string };
type Job = { id: string; kind: string; game: string; gid?: string; state: string; message: string; log: string };
type LauncherImport = { launcher: string; found: number; added: number; candidates: number;
  unavailable: number; game_ids: string[]; warnings: string[] };
type Library = { games: Game[]; warnings: string[]; release: Release; license_accepted: boolean; jobs: Job[];
  launcher_import?: LauncherImport; model_catalog?: ModelCatalog;
  optiscaler_catalog?: OptiScalerCatalog; optiscaler_nightly_release?: Release };
let cachedLibrary: Library | undefined;
function cacheLibrary(next: Library) { cachedLibrary = next; return next; }
type Preview = { token: string; name: string; action: string; route: string; files: string[];
  warning: string; select_upscaler: string; model?: string; variant_id?: string; release_version?: string;
  optiscaler_channel?: string; optiscaler_label?: string; optiscaler_version?: string; selected_executable?: string };
const library = callable<[], Library>("library");
const details = callable<[string, string?, string?], Game>("game_details");
const checkUpdates = callable<[boolean, string?], Release>("check_updates");
const checkOptiScalerNightlyUpdate = callable<[boolean], Release>("check_optiscaler_nightly_update");
const forgetGame = callable<[string], Library>("forget_game");
const importFolders = callable<[string[]], Library>("import_folders");
const importLauncher = callable<[string], Library>("import_launcher");
const setLicense = callable<[boolean, string?], boolean>("set_license");
const jobStatus = callable<[], Job[]>("job_status");
const cancelJob = callable<[string], boolean>("cancel_job");
const previewAction = callable<[string, string, boolean, string?, string?, string?], Preview>("preview_action");
const applyAction = callable<[string], { message: string }>("apply_action");
const previewLatest = callable<[string, boolean, string?, string?, string?, string?], Preview>("preview_latest");
const installLatest = callable<[string], Job>("install_latest");
type OverlayStatus = { enabled: boolean; game_id: string | null;
  overlay: {state: string; label: string; detail: string; responding: boolean; visible_verified: boolean};
  runtime: {state: string; label: string; detail: string; observed_at?: number; version?: string; model?: string} };
const overlayStatus = callable<[], OverlayStatus>("overlay_status");
const setStatusOverlay = callable<[string | null, boolean, string?, string?], OverlayStatus>("set_status_overlay");
let latestOverlayStatus: OverlayStatus | undefined;
let overlayTimer: ReturnType<typeof setInterval> | undefined;
let overlayPolling = false;
let overlayNotificationKey = "";
const overlayListeners = new Set<(status: OverlayStatus) => void>();
function publishOverlayStatus(status: OverlayStatus) {
  if (pluginDisposed) return;
  latestOverlayStatus = status;
  overlayListeners.forEach(listener => listener(status));
  if (!status.enabled) { overlayNotificationKey = ""; return; }
  const key = `${status.game_id}:${status.runtime.state}:${status.overlay.state}`;
  if (key !== overlayNotificationKey && (["output", "failure", "unavailable"].includes(status.runtime.state)
      || ["conflict", "unavailable", "stale"].includes(status.overlay.state))) {
    toaster.toast({ title: "업스케일러 상태", body: `${status.runtime.label}. ${status.overlay.label}.`, duration: 6000 });
  }
  overlayNotificationKey = key;
}
function pollOverlayStatus() {
  if (overlayPolling || pluginDisposed) return;
  overlayPolling = true;
  void overlayStatus().then(publishOverlayStatus).catch(() => {
    if (latestOverlayStatus?.enabled) publishOverlayStatus({ ...latestOverlayStatus,
      runtime: {state: "unavailable", label: "런타임 상태 확인 불가", detail: "백엔드 연결이 끊어졌습니다. 다시 연결된 후 스위치를 껐다 켜주세요."},
      overlay: {state: "stale", label: "오버레이 상태 미확인", detail: "백엔드 응답이 없습니다.", responding: false, visible_verified: false} });
  }).finally(() => { overlayPolling = false; });
}
type LaunchIntent = { nonce: string; before: string; after: string; restore: boolean };
const prepareLaunch = callable<[string, string, string, boolean], LaunchIntent>("prepare_launch_options");
const finalizeLaunch = callable<[string, string, string], unknown>("finalize_launch_options");
const ownedLaunch = callable<[string, string], { before: string; after: string; pending?: LaunchIntent } | null>("owned_launch_options");

async function liveLaunchOptions(appid: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { subscription?.unregister(); reject(new Error("Steam에서 실시간 시작 옵션을 가져오지 못했습니다")); }, 5000);
    let subscription: { unregister(): void } | undefined;
    subscription = SteamClient.Apps.RegisterForAppDetails(appid, detail => {
      clearTimeout(timer); subscription?.unregister(); resolve(detail.strLaunchOptions);
    });
  });
}

let lastSelected = "";
const selectionListeners = new Set<(id: string) => void>();
function chooseGame(id: string) {
  if (lastSelected !== id && latestOverlayStatus?.enabled)
    void setStatusOverlay(null, false).then(publishOverlayStatus).catch(() => {});
  lastSelected = id;
  selectionListeners.forEach(listener => listener(id));
}
// Steam can unmount the quick-access panel when a dialog opens. Keep the lock across mounts.
let interactionBusy = false;
let reviewApplying = false;
let dialogShowing = false;
let interactionAfter = 0;
const interactionListeners = new Set<() => void>();
const pluginInstaller = new PluginInstaller(async (route, ...args) => {
  if (typeof DeckyBackend === "undefined" || typeof DeckyBackend.callable !== "function")
    throw new Error("Decky 설치기를 사용할 수 없습니다. Decky 설정 → 개발자 메뉴에서 릴리즈 ZIP 파일로 설치해 주세요.");
  return DeckyBackend.callable<unknown[], unknown>(route)(...args);
}, () => interactionListeners.forEach(listener => listener()));
function nativeUpdatePrompt(name: string, version: string, requestId: string, hash: string) {
  pluginInstaller.prompt(name, version, requestId, hash);
}
function nativeUpdateStarted(name: string) {
  pluginInstaller.started(name);
}
function nativeUpdateFinished(name: string) {
  pluginInstaller.finished(name);
}
function finishInteraction() {
  if (reviewApplying) { dialogShowing = false; return; }
  interactionBusy = false; dialogShowing = false;
  interactionAfter = Date.now() + 700;
  interactionListeners.forEach(fn => fn());
}
async function interact(fn: () => Promise<void>) {
  if (interactionBusy || reviewApplying || Date.now() < interactionAfter) return;
  interactionBusy = true;
  interactionListeners.forEach(listener => listener());
  try { await fn(); }
  finally { if (!dialogShowing) finishInteraction(); }
}
function beginReview() {
  if (reviewApplying) return false;
  reviewApplying = true; interactionBusy = true;
  interactionListeners.forEach(listener => listener());
  return true;
}
function openDialog(modal: ReactNode) {
  dialogShowing = true;
  try { showModal(modal, undefined, { bNeverPopOut: true, fnOnClose: finishInteraction }); }
  catch (e) { finishInteraction(); throw e; }
}
const notifiedJobs = new Set<string>();
const jobListeners = new Set<(next: Job[], finished: boolean) => void>();
const folderListeners = new Set<(next: string[]) => void>();
let pendingFolders: string[] = [];
const launcherOptions = [
  { data: "heroic", label: "Heroic Games Launcher" },
  { data: "lutris", label: "Lutris" },
  { data: "legendary", label: "Legendary" },
  { data: "steam-shortcuts", label: "Steam 비-Steam 바로가기" },
  { data: "all-launchers", label: "지원되는 모든 런처" },
];
let selectedLauncher = "heroic";
let launcherImportMessage = "";
const launcherListeners = new Set<() => void>();
function chooseLauncher(id: string) {
  if (!launcherOptions.some(option => option.data === id)) return;
  selectedLauncher = id; launcherImportMessage = "";
  launcherListeners.forEach(listener => listener());
}
function reportLauncherImport(message: string) {
  launcherImportMessage = message;
  launcherListeners.forEach(listener => listener());
}
function queueFolders(next: string[]) {
  pendingFolders = next;
  folderListeners.forEach(listener => listener(next));
}
let watchedJobs: Job[] = [];
const jobTracker = new JobTracker();
const installSession = new InstallSession();
let jobTimer: ReturnType<typeof setInterval> | undefined;
let jobPolling = false;
let pluginDisposed = false;
function watchJobs(next: Job[], expectedRevision?: number, submittedId?: string) {
  if (pluginDisposed) return;
  if (!jobTracker.update(next, expectedRevision)) return;
  next = jobTracker.jobs;
  const finished = watchedJobs.some(old => old.state === "running" && next.some(j => j.id === old.id && j.state !== "running"))
    || next.some(j => j.id === submittedId && j.state !== "running");
  next.forEach(j => {
    if (j.state === "running" || notifiedJobs.has(j.id)) return;
    notifiedJobs.add(j.id);
    if (j.id !== submittedId && !watchedJobs.some(old => old.id === j.id && old.state === "running")) return;
    toaster.toast({ title: j.state === "completed" ? j.kind === "install_latest" ? "업스케일러 설치 완료 (HelixSR files installed)" : "업스케일러 준비 완료" : j.state === "cancelled" ? "작업이 취소됨" : "작업 실패 (HelixSR operation failed)",
      body: `${j.game}: ${j.message}${j.state === "completed" && j.kind === "install_latest" ? " 게임의 '다음 단계' 안내에 따라 시작 옵션 및 런타임 상태를 확인하세요." : ""}`, duration: 8000 });
  });
  watchedJobs = next;
  jobListeners.forEach(listener => listener(next, finished));
  if (next.some(j => j.state === "running") && !jobTimer) {
    // Notifications continue when the quick-access panel is closed.
    jobTimer = setInterval(() => {
      if (jobPolling) return;
      jobPolling = true;
      const revision = jobTracker.revision;
      void jobStatus().then(nextJobs => watchJobs(nextJobs, revision)).catch(() => {}).finally(() => { jobPolling = false; });
    }, 2000);
  } else if (!next.some(j => j.state === "running") && jobTimer) {
    clearInterval(jobTimer); jobTimer = undefined;
  }
}
function getOptionValue(option: any): string {
  if (option === null || option === undefined) return "";
  if (typeof option === "object") {
    if ("data" in option) return String(option.data ?? "");
    if ("value" in option) return String(option.value ?? "");
  }
  return String(option);
}
function Content() {
  const [submission, setSubmission] = useState(installSession.snapshot);
  const [overlay, setOverlay] = useState(latestOverlayStatus);
  const [data, setData] = useState<Library | undefined>(cachedLibrary);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [selected, select] = useState(lastSelected);
  const [game, setGame] = useState<Game>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState("");
  const [folders, setFolders] = useState<string[]>(pendingFolders);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dx12, setDx12] = useState(false);
  const [variant, setVariant] = useState<string>();
  const [optiChannel, setOptiChannel] = useState<string>();
  const userVariantSelectedRef = useRef<boolean>(false);
  const lastVariantGameIdRef = useRef<string | undefined>(undefined);
  const userOptiChannelSelectedRef = useRef<boolean>(false);
  const lastOptiChannelGameIdRef = useRef<string | undefined>(undefined);
  const lastLoadedGameIdRef = useRef<string | undefined>(undefined);
  const [diagnostics, setDiagnostics] = useState(false);
  const [discoveryNotes, setDiscoveryNotes] = useState(false);
  const [setupOptions, setSetupOptions] = useState(false);
  const [unavailableGames, setUnavailableGames] = useState(false);
  const [importOpen, setImportOpen] = useState(!!pendingFolders.length);
  const [launcher, setLauncher] = useState(selectedLauncher);
  const [importMessage, setImportMessage] = useState(launcherImportMessage);
  const [modalOpen, setModalOpen] = useState(interactionBusy || reviewApplying || pluginInstaller.locked);
  const [pluginUpdate, setPluginUpdate] = useState(latestPluginStatus);
  const [pluginInstallMessage, setPluginInstallMessage] = useState(pluginInstaller.message);
  const selectedRef = useRef(selected);
  const executableRef = useRef<string | undefined>(undefined);
  const routeRef = useRef<string | undefined>(undefined);
  selectedRef.current = selected;

  useEffect(() => installSession.subscribe(setSubmission), []);
  useEffect(() => {
    overlayListeners.add(setOverlay);
    setOverlay(latestOverlayStatus);
    pollOverlayStatus();
    return () => { overlayListeners.delete(setOverlay); };
  }, []);
  useEffect(() => {
    pluginUpdateListeners.add(setPluginUpdate);
    setPluginUpdate(latestPluginStatus);
    pollPluginStatus();
    return () => { pluginUpdateListeners.delete(setPluginUpdate); };
  }, []);

  useEffect(() => {
    const changed = () => { setModalOpen(interactionBusy || reviewApplying || pluginInstaller.locked); setPluginInstallMessage(pluginInstaller.message); };
    interactionListeners.add(changed); changed();
    return () => { interactionListeners.delete(changed); };
  }, []);
  useEffect(() => {
    const changed = (id: string) => {
      if (selectedRef.current !== id) { executableRef.current = undefined; routeRef.current = undefined; }
      selectedRef.current = id; select(id);
    };
    selectionListeners.add(changed); changed(lastSelected);
    return () => { selectionListeners.delete(changed); };
  }, []);
  useEffect(() => {
    folderListeners.add(setFolders); setFolders(pendingFolders);
    return () => { folderListeners.delete(setFolders); };
  }, []);
  useEffect(() => {
    const changed = () => { setLauncher(selectedLauncher); setImportMessage(launcherImportMessage); };
    launcherListeners.add(changed); changed();
    return () => { launcherListeners.delete(changed); };
  }, []);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError("");
    try { return await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return undefined; }
    finally { setBusy(false); }
  }
  async function refresh() {
    const jobRevision = jobTracker.revision;
    setLibraryLoading(true); setLibraryError("");
    const result = await run(async () => {
      try { return await library(); }
      catch (e) { setLibraryError(e instanceof Error ? e.message : String(e)); throw e; }
      finally { setLibraryLoading(false); }
    });
    if (result) {
      setData(cacheLibrary(result)); watchJobs(result.jobs, jobRevision);
      if (!selectedRef.current || !result.games.some(g => g.id === selectedRef.current)) {
        const first = result.games.find(g => g.recovery_available) || result.games.find(g => g.compatibility === "candidate" && g.managed) || result.games.find(g => g.compatibility === "candidate" || g.executable_selection_needed);
        if (first) chooseGame(first.id);
      }
    }
  }
  useEffect(() => {
    // A remounted panel must not insert a full discovery scan between accepting
    // the reviewed terms and starting the job: those RPCs share a backend lock.
    if (installSession.snapshot.pending) { setLibraryLoading(false); return; }
    void refresh();
  }, []);
  useEffect(() => {
    if (!data) return;
    setLibraryError("");
    if (!data.games.some(librarySelectable)) {
      setUnavailableGames(true); setDiscoveryNotes(true);
    }
  }, [data?.games]);
  useEffect(() => {
    let active = true;
    if (selected !== lastLoadedGameIdRef.current) {
      lastLoadedGameIdRef.current = selected;
      setGame(undefined); setDx12(false); setDiagnostics(false);
    }
    const current = data?.games.find(g => g.id === selected);
    if (current?.managed) routeRef.current = undefined;
    const effectiveRoute = routeRef.current || current?.route;
    if (current?.managed || effectiveRoute !== "optiscaler") executableRef.current = undefined;
    // This effect alone owns selection scans, including refreshes of the same
    // selected game. Wait for the library instead of queuing a duplicate scan.
    const requestedExecutable = executableRef.current;
    const requestedRoute = routeRef.current;
    if (current && submission.pending) { setGame(current); return () => { active = false; }; }
    if (libraryLoading) return () => { active = false; };
    if (selected && current) void run(() => requestedRoute !== undefined ? details(selected, requestedExecutable, requestedRoute) : details(selected, requestedExecutable)).then(g => {
      if (g && active && selectedRef.current === selected && executableRef.current === requestedExecutable && routeRef.current === requestedRoute) setGame(g);
    });
    return () => { active = false; };
  }, [selected, data?.games, libraryLoading, submission.pending]);
  useEffect(() => {
    if (selected !== lastVariantGameIdRef.current) {
      lastVariantGameIdRef.current = selected;
      userVariantSelectedRef.current = false;
      const cur = data?.games?.find(g => g.id === selected);
      setVariant(cur?.installed_variant || data?.model_catalog?.default);
    }
  }, [selected, data?.games, data?.model_catalog?.default]);
  useEffect(() => {
    if (game?.id === selected && game?.installed_variant && !userVariantSelectedRef.current) {
      setVariant(game.installed_variant);
    }
  }, [game?.id, game?.installed_variant, selected]);
  useEffect(() => {
    if (selected !== lastOptiChannelGameIdRef.current) {
      lastOptiChannelGameIdRef.current = selected;
      userOptiChannelSelectedRef.current = false;
      const cur = data?.games?.find(g => g.id === selected);
      setOptiChannel(cur?.installed_optiscaler_channel || data?.optiscaler_catalog?.default);
    }
  }, [selected, data?.games, data?.optiscaler_catalog?.default]);
  useEffect(() => {
    if (game?.id === selected && game?.installed_optiscaler_channel && !userOptiChannelSelectedRef.current) {
      setOptiChannel(game.installed_optiscaler_channel);
    }
  }, [game?.id, game?.installed_optiscaler_channel, selected]);
  useEffect(() => {
    const changed = (next: Job[], finished: boolean) => { setJobs(next); if (finished) void refresh(); };
    jobListeners.add(changed); setJobs(watchedJobs);
    return () => { jobListeners.delete(changed); };
  }, []);

  async function chooseRoute(nextRoute: string) {
    if (!game || game.managed || !(game.available_routes || []).includes(nextRoute)) return;
    const id = game.id;
    if (latestOverlayStatus?.enabled) {
      const stopped = await run(() => setStatusOverlay(null, false));
      if (!stopped) return;
      publishOverlayStatus(stopped);
    }
    routeRef.current = nextRoute;
    executableRef.current = undefined;
    setDx12(false);
    const updated = await run(() => details(id, undefined, nextRoute));
    if (selectedRef.current !== id || routeRef.current !== nextRoute) return;
    if (updated) setGame(updated);
    else { routeRef.current = undefined; setGame(undefined); }
  }

  async function chooseExecutable(path: string) {
    if (!game || game.managed || game.route !== "optiscaler") return;
    const id = game.id;
    if (latestOverlayStatus?.enabled) {
      const stopped = await run(() => setStatusOverlay(null, false));
      if (!stopped) return;
      publishOverlayStatus(stopped);
    }
    executableRef.current = path;
    const requestedRoute = routeRef.current;
    setDx12(false);
    const updated = await run(() => requestedRoute !== undefined ? details(id, path, requestedRoute) : details(id, path));
    if (selectedRef.current !== id || executableRef.current !== path || routeRef.current !== requestedRoute) return;
    if (updated) setGame(updated);
    else { executableRef.current = undefined; setGame(undefined); }
  }

  async function importFromLauncher() {
    const source = selectedLauncher;
    const label = launcherOptions.find(option => option.data === source)!.label;
    reportLauncherImport(`${label}에서 설치된 게임 검색 중…`);
    const result = await run(() => importLauncher(source));
    if (!result?.launcher_import) {
      reportLauncherImport("가져오기 실패. 오류 메시지를 확인하고 다시 시도해 주세요.");
      return;
    }
    setData(result); watchJobs(result.jobs);
    const report = result.launcher_import;
    const summary = report.found
      ? `${report.found}개 게임 발견 · 신규 추가 ${report.added}개 · 설치 가능 ${report.candidates}개${report.unavailable ? ` · 설치 불가 ${report.unavailable}개` : ""}`
      : `${label}에서 가져올 수 있는 설치된 게임을 찾지 못했습니다. 게임이 설치되어 있고 드라이브가 마운트되어 있는지 확인하거나, 아래 '게임 폴더 관리'에서 경로를 직접 추가하세요.`;
    const message = report.warnings.length
      ? `${summary} (${report.warnings.length}개의 검색 경고가 있습니다. 위의 '검색 참고사항'을 확인하세요.)`
      : summary;
    reportLauncherImport(message);
    // Keep the existing selection. Auto-select a candidate only when none exists.
    const current = result.games.find(g => g.id === selectedRef.current);
    if (!current || !(current.compatibility === "candidate" || current.managed || current.recovery_available)) {
      const first = result.games.find(g => report.game_ids.includes(g.id) && g.compatibility === "candidate");
      chooseGame(first?.id || "");
      setGame(undefined);
    }
    toaster.toast({ title: report.warnings.length ? "경고와 함께 게임 가져오기 완료" : "게임 가져오기 완료", body: `${label}: ${message}`, duration: 6000 });
  }

  async function installOrUpdate() {
    if (!game || installSession.snapshot.pending || watchedJobs.some(j => j.state === "running")) return;
    installSession.clearError();
    const isFsr4 = variant?.startsWith("fsr4-");
    const currentRelease = await run(() => isFsr4 ? checkUpdates(true, variant) : checkUpdates(true));
    if (!currentRelease?.version || currentRelease.error) { setError(currentRelease?.error || "최신 릴리즈를 확인하지 못했습니다. 아래 '최신 버전 확인' 버튼을 다시 시도해 주세요."); return; }
    if (!isFsr4) setData(d => d ? { ...d, release: currentRelease } : d);
    const targetRoute = !game.managed ? (routeRef.current || game.route) : game.route;
    if (targetRoute === "optiscaler" && optiChannel === "nightly") {
      const nightlyRelease = await run(() => checkOptiScalerNightlyUpdate(true));
      if (!nightlyRelease?.version || nightlyRelease.error) { setError(nightlyRelease?.error || "최신 OptiScaler Nightly 릴리즈를 확인하지 못했습니다."); return; }
      setData(d => d ? { ...d, optiscaler_nightly_release: nightlyRelease } : d);
    }
    const executable = !game.managed && targetRoute === "optiscaler" ? (game.selected_executable || undefined) : undefined;
    const requestedRoute = !game.managed ? (routeRef.current || game.route || undefined) : undefined;
    const defaultOpti = game.installed_optiscaler_channel || data?.optiscaler_catalog?.default || "bundled";
    const requestedOpti = targetRoute === "optiscaler" && optiChannel && (optiChannel !== defaultOpti || optiChannel === "nightly") ? optiChannel : undefined;
    const p = await run(() => requestedOpti !== undefined
      ? previewLatest(game.id, dx12, variant, executable, requestedRoute, requestedOpti)
      : requestedRoute !== undefined
      ? previewLatest(game.id, dx12, variant, executable, requestedRoute)
      : previewLatest(game.id, dx12, variant, executable));
    if (!p) return;
    openDialog(<ConfirmModal bDisableBackgroundDismiss strTitle={`업스케일러 ${game.managed || game.legacy ? "업데이트" : "설치"} (${currentRelease.version})`}
      strDescription={<div style={{ overflowWrap: "anywhere" }}>
        <p>{p.name}: {p.warning}</p>
        <p>선택한 모델: {p.model} · 릴리즈 버전: {p.release_version}</p>
        <p>설치 방식 (경로): {p.route === "direct" ? "네이티브 FSR 3.1 직접 교체 (Direct)" : "OptiScaler 프록시"}</p>
        {p.optiscaler_label && <p>OptiScaler 빌드: {p.optiscaler_label} ({p.optiscaler_version})</p>}
        {p.selected_executable && <p>게임 실행 파일: {p.selected_executable}</p>}
        <p>필요한 다운로드와 로컬 패키지 준비가 자동으로 진행됩니다. HelixSR 프리웨어, NVIDIA DLSS, FSR 4 셰이더 오버라이드 및 OptiScaler가 각 라이선스 조건에 따라 사용되며, 로컬에서 생성된 네트워크 파일은 이 기기 내부에만 보관됩니다.</p>
        <p>변경 대상 파일: {p.files.join(", ")}</p>
      </div>}
      strOKButtonText={data?.license_accepted ? "업스케일러 설치 / 업데이트" : "약관 동의 및 설치"}
      strCancelButtonText="취소"
      onOK={() => {
        if (!beginReview()) return;
        void installSession.start(game.id, p.name, async () => {
          toaster.toast({ title: "Starting HelixSR installation", body: `${p.name}: 시작 요청을 처리 중입니다. 잠시만 기다려 주세요. 버튼을 다시 누를 필요가 없습니다.`, duration: 6000 });
          await setLicense(true, p.token);
          const job = await installLatest(p.token);
          if (cachedLibrary) cachedLibrary = { ...cachedLibrary, license_accepted: true };
          watchJobs([...watchedJobs.filter(old => old.id !== job.id), job], undefined, job.id);
        }).then(ok => {
          if (!ok && installSession.snapshot.error && !pluginDisposed)
            toaster.toast({ title: "HelixSR installation could not start", body: installSession.snapshot.error, duration: 10000 });
        }).finally(() => { reviewApplying = false; finishInteraction(); });
      }} />);
  }

  async function action(name: string) {
    if (!game) return;
    const executable = !game.managed && game.route === "optiscaler" ? game.selected_executable : undefined;
    const requestedRoute = !game.managed ? routeRef.current : undefined;
    const p = await run(() => requestedRoute !== undefined ? previewAction(game.id, name, dx12, executable, requestedRoute) : previewAction(game.id, name, dx12, executable));
    if (!p) return;
    const actionLabel = name === "enable" ? "활성화" : name === "disable" ? "비활성화" : name === "remove" ? "제거 및 원본 복원" : name === "recover" ? "중단된 작업 복구" : name.toUpperCase();
    openDialog(<ConfirmModal bDisableBackgroundDismiss strTitle={`${actionLabel}: ${p.name}`}
      strDescription={<div style={{ overflowWrap: "anywhere" }}>
        <p>{p.warning}</p><p>적용 경로: {p.route === "direct" ? "Direct (네이티브 FSR 3.1 교체)" : p.route === "optiscaler" ? "OptiScaler 프록시" : p.route} · 게임 내 그래픽 설정: {p.select_upscaler} 선택</p>
        {p.selected_executable && <p>게임 실행 파일: {p.selected_executable}</p>}
        <p>대상 파일: {p.files.join(", ")}</p>
      </div>} strOKButtonText="검토한 변경사항 적용" strCancelButtonText="취소"
      onOK={() => { if (!beginReview()) return; void run(() => applyAction(p.token)).then(async result => {
        if (result) toaster.toast({ title: "Upscaler Decky", body: result.message });
        await refresh();
      }).finally(() => { reviewApplying = false; finishInteraction(); }); }} />);
  }
  async function launchChange(restore = false) {
    if (!game?.appid) return;
    const appid = Number(game.appid);
    const before = await run(() => liveLaunchOptions(appid));
    if (before === undefined) return;
    const receipt = await run(() => ownedLaunch(game.id, before));
    if (receipt === undefined) return;
    let after: string;
    try {
      if (receipt?.pending) {
        if (receipt.pending.restore !== restore) throw new Error("먼저 동일한 작업으로 대기 중인 시작 옵션 변경을 완료해 주세요.");
        after = receipt.pending.after;
      } else if (restore) {
        if (!receipt || receipt.after !== before) throw new Error("플러그인 외부에서 시작 옵션이 변경되었습니다. Steam 속성에서 직접 확인해 주세요.");
        after = receipt.before;
      } else {
        after = proxyOptions(before);
        if (after === before) { toaster.toast({ title: "Upscaler Decky", body: "OptiScaler 프록시 시작 옵션이 이미 설정되어 있습니다" }); return; }
      }
    } catch (e) { setError(String(e)); return; }
    openDialog(<ConfirmModal bDisableBackgroundDismiss strTitle={restore ? "이전 시작 옵션으로 복원" : "Proton OptiScaler 프록시 시작 옵션 활성화"}
      strDescription={<div style={{ overflowWrap: "anywhere" }}><p>변경 전: {before || "비어 있음"}</p><p>변경 후: {after || "비어 있음"}</p></div>}
      strOKButtonText="확인" strCancelButtonText="취소"
      onOK={() => { if (!beginReview()) return; void run(async () => {
        const current = await liveLaunchOptions(appid);
        if (current !== before) throw new Error("미리보기 이후 실시간 시작 옵션이 변경되었습니다");
        const intent = await prepareLaunch(game.id, before, after, restore);
        SteamClient.Apps.SetAppLaunchOptions(appid, after);
        const saved = await liveLaunchOptions(appid);
        if (saved !== after) throw new Error("Steam에서 저장된 시작 옵션이 확인되지 않았습니다");
        await finalizeLaunch(game.id, intent.nonce, saved);
        toaster.toast({ title: "Upscaler Decky", body: "Steam 시작 옵션이 저장 및 확인되었습니다" });
        await refresh();
      }).finally(() => { reviewApplying = false; finishInteraction(); }); }} />);
  }
  async function updatePlugin(resume = false) {
    if (typeof DeckyBackend === "undefined" || typeof DeckyBackend.callable !== "function" || !DeckyBackend.addEventListener || !DeckyBackend.removeEventListener) {
      setError("현재 Decky 버전에서 플러그인 설치 창을 열 수 없습니다. Decky 설정 → 개발자 → URL에서 플러그인 설치 메뉴로 릴리즈 ZIP을 설치해 주세요.");
      return;
    }
    await run(async () => {
      const prepared = await (resume ? resumePluginUpdate() : preparePluginUpdate());
      // Informational status failures must never prevent the native handoff.
      pollPluginStatus();
      await pluginInstaller.open(prepared);
      toaster.toast({ title: "플러그인 다운로드 완료 (설치 확인 필요)", body: "Decky 확인 창에서 'Update(업데이트)'를 눌러야 실제 설치가 완료됩니다.", duration: 10000 });
    });
  }
  async function cancelDownloadedPlugin() {
    await run(async () => {
      await pluginInstaller.cancel(async () => publishPluginStatus(await cancelPluginUpdate()));
    });
  }
  const running = jobs.some(x => x.state === "running");
  const disabled = busy || running || submission.pending || modalOpen || !!pluginUpdate?.pending;
  const libraryGames = (data?.games || []).map(g => game?.id === g.id ? game : g);
  const games = libraryGames.filter(librarySelectable);
  const unavailable = libraryGames.filter(g => !games.includes(g));
  const libraryView = koLibraryView(libraryStatus(data ? libraryGames : undefined, libraryLoading, !!libraryError));
  const selectedStatus = game ? gameStatus(game) : undefined;
  const selectedJob = jobs.find(job => job.state === "running"
    && (job.gid ? job.gid === game?.id : job.game === game?.name));
  const selectedSummary = submission.pending && submission.gid === game?.id
    ? "업스케일러 설치 시작 중… (HelixSR installation is starting…)"
    : selectedJob ? "업스케일러 설치 진행 중 (installation is in progress. Wait for completion before launching.)"
    : selectedStatus?.summary;
  const installState = game ? installReadiness(game, dx12) : undefined;
  const effectiveRoute = !game ? undefined : !game.managed ? (routeRef.current || game.route) : game.route;
  const guidance = submission.pending ? undefined : koGuidance(nextStep(game?.setup_guidance, jobs.find(job => job.state === "running")));
  const infoStyle = { fontSize: "13px", lineHeight: "1.45", overflowWrap: "anywhere" as const, whiteSpace: "pre-wrap" as const };

  return <div className="helixsr-decky">
    <style>{`.helixsr-decky{width:100%;box-sizing:border-box;margin:0 auto;padding:8px 4px;color:#e8f1fa;background:linear-gradient(180deg,rgba(50,135,160,.1),transparent 280px)}
      .helixsr-decky button{box-sizing:border-box;max-width:100%;text-align:center;justify-content:center;border-radius:7px;background-color:#30313d!important;color:#e8f1fa!important}
      .helixsr-decky .helix-installed button{background-color:#1c6048!important;color:#c6ffe1!important;border:1px solid #55cd92}
      .helixsr-decky .helix-selected button{outline:2px solid #ad8aff!important}
      .helixsr-decky .helix-primary button{background-color:#634394!important;color:#fff!important;border:1px solid #b58ae9}
      .helixsr-decky button:focus{outline:2px solid #7de1e7!important;background-color:#4d465e!important}
      .helixsr-decky button:disabled{opacity:.5}
      .helixsr-decky .helix-card{width:100%;box-sizing:border-box;padding:12px;border-left:3px solid #53c5d0;border-radius:7px;background:rgba(34,83,104,.25)}
      .helixsr-decky .helix-muted{color:#c5d1df;font-size:12px}
      .helixsr-decky .helix-status{color:#8ee8bc}`}</style>
    <PanelSection title="게임 목록">
      {submission.pending && <PanelSectionRow><div className="helix-card" style={infoStyle} role="status">
        <strong>{submission.name}: 설치 시작 중… (Starting installation…)</strong>{"\n"}{submission.message}
      </div></PanelSectionRow>}
      {!!submission.error && <PanelSectionRow><div className="helix-card" role="alert" style={{ ...infoStyle, color: "#ffb4a7" }}>
        <strong>{submission.name}: 설치를 시작할 수 없음 (Installation could not start)</strong>{"\n"}{submission.error}
      </div></PanelSectionRow>}
      <PanelSectionRow><div className="helix-card helix-muted">{libraryView.summary}</div></PanelSectionRow>
      {libraryView.hint && <PanelSectionRow><div className="helix-muted">{libraryView.hint}</div></PanelSectionRow>}
      {!!libraryError && <PanelSectionRow><div style={infoStyle}>{libraryError}</div></PanelSectionRow>}
      {(data?.warnings || []).length > 0 && <PanelSectionRow><ButtonItem layout="below" onClick={() => setDiscoveryNotes(!discoveryNotes)}>
        {discoveryNotes ? "검색 참고사항 숨기기" : `검색 참고사항 보기 (${data!.warnings.length})`}</ButtonItem></PanelSectionRow>}
      {discoveryNotes && !!data?.warnings.length && <PanelSectionRow><div style={infoStyle}>{data.warnings.join("\n")}</div></PanelSectionRow>}
      <div className={`${selectedStatus?.installed ? "helix-installed" : ""} helix-selected`}><PanelSectionRow>
        <DropdownItem layout="below" label="게임 선택" menuLabel="감지된 게임" selectedOption={selected}
          strDefaultLabel={games.length ? "게임을 선택하세요" : libraryGames.length ? "아래 설치 불가 게임을 확인하세요" : "선택 가능한 게임이 없습니다"} disabled={busy || modalOpen || !games.length}
          rgOptions={games.map(g => ({ data: g.id, label: <span style={{ borderLeft: `3px solid ${gameStatus(g).color}`, paddingLeft: 8 }}>{g.name} · {koStatusLabel(gameStatus(g).label)}</span> }))}
          onChange={option => chooseGame(getOptionValue(option))} />
      </PanelSectionRow></div>
      {game && <>
        {!submission.pending && <PanelSectionRow><div className="helix-muted" style={{ color: selectedStatus?.color }}>{koStatusSummary(selectedSummary || "")}</div></PanelSectionRow>}
        {guidance && <PanelSectionRow><div className="helix-card" style={infoStyle}>
          <strong>다음 단계: {guidance.headline}</strong>
          {guidance.steps.length > 0 && <div style={{ marginTop: 4 }}>{guidance.steps.join("\n")}</div>}
        </div></PanelSectionRow>}
        {guidance?.links.map(link => <PanelSectionRow key={link.url}><ButtonItem layout="below" disabled={modalOpen}
          onClick={() => SteamClient.System.OpenInSystemBrowser(link.url)}>{link.label}</ButtonItem></PanelSectionRow>)}
        {game.installation_status?.issues.map((issue, index) => <PanelSectionRow key={`${issue.code}-${index}`}><div className="helix-card" style={{ ...infoStyle, borderLeftColor: issue.blocking ? "#f1ca7e" : "#53c5d0" }}>
          <strong>{issue.title}</strong>{"\n"}{issue.reason}{"\n"}조치 방법: {issue.steps.join(" ")}
        </div></PanelSectionRow>)}
        {game.route && <PanelSectionRow>
          <DropdownItem layout="below" label="설치 방식 (경로)" menuLabel="설치 방식 선택"
            selectedOption={routeRef.current || game.route || "direct"} strDefaultLabel="설치 방식 선택"
            disabled={disabled || !!game.managed || (game.available_routes?.length || 0) <= 1}
            rgOptions={
              game.managed
                ? [{ data: game.route, label: game.route === "direct" ? "Direct (네이티브 FSR 3.1 직접 교체)" : "OptiScaler 프록시 (인게임 실시간 전환)" }]
                : (game.available_routes?.length || 0) > 1
                  ? game.available_routes!.map(r => ({
                      data: r,
                      label: r === "direct" ? "Direct (네이티브 FSR 3.1 직접 교체)" : "OptiScaler 프록시 (DLSS/XeSS 경유 · 실시간 전환)"
                    }))
                  : [{
                      data: game.route,
                      label: game.route === "direct" ? "Direct (네이티브 FSR 3.1 직접 교체 · 단일 지원)" : "OptiScaler 프록시 (DLSS/XeSS 경유 · 단일 지원)"
                    }]
            }
            onChange={option => void chooseRoute(getOptionValue(option))} />
        </PanelSectionRow>}
        {!!data?.model_catalog?.variants.length && <PanelSectionRow>
          <DropdownItem layout="below" label="업스케일러 모델" menuLabel="업스케일러 모델 선택"
            selectedOption={variant || data.model_catalog.default} disabled={disabled}
            rgOptions={data.model_catalog.variants.map(v => ({
              data: v.id,
              label: `${v.label} · ${v.id.startsWith("fsr4-") ? (v.id.includes("exact") ? "화질 우선" : "성능 우선") : "HelixSR 신경망"}`
            }))}
            onChange={option => {
              const val = getOptionValue(option);
              if (val) {
                userVariantSelectedRef.current = true;
                setVariant(val);
              }
            }} />
        </PanelSectionRow>}
        {effectiveRoute === "optiscaler" && !!data?.optiscaler_catalog?.channels.length && <PanelSectionRow>
          <DropdownItem layout="below" label="OptiScaler 빌드" menuLabel="OptiScaler 빌드 선택"
            selectedOption={optiChannel || data.optiscaler_catalog.default} disabled={disabled}
            rgOptions={data.optiscaler_catalog.channels.map(c => ({
              data: c.id,
              label: c.id === "bundled" ? "OptiScaler 0.9.4 (안정 번들)" : "OptiScaler Nightly (최신 공식)"
            }))}
            onChange={option => {
              const val = getOptionValue(option);
              if (val) {
                userOptiChannelSelectedRef.current = true;
                setOptiChannel(val);
              }
            }} />
        </PanelSectionRow>}
        {!game.managed && effectiveRoute === "optiscaler" && !!game.executable_choices?.length && (game.executable_choices.length > 1 || !game.executable_choices.some(choice => choice.path === game.selected_executable)) && <PanelSectionRow>
          <DropdownItem layout="below" label="게임 실행 파일" menuLabel="실제 실행되는 실행 파일 선택"
            selectedOption={game.selected_executable} strDefaultLabel="게임 실행 파일 선택" disabled={disabled}
            rgOptions={game.executable_choices!.map(choice => ({ data: choice.path, label: `${choice.path} · ${choice.dx12 ? "DX12 감지됨" : "DX12 확인 필요"}` }))}
            onChange={option => void chooseExecutable(getOptionValue(option))} />
        </PanelSectionRow>}
        {game.dx12_confirmation_needed && <PanelSectionRow><ToggleField label="게임이 DirectX 12로 설정됨"
          description="게임 내 그래픽 설정에서 렌더러가 DirectX 12로 선택되어 있음을 확인합니다." checked={dx12} onChange={setDx12} disabled={disabled} /></PanelSectionRow>}
        {installState?.reason && <PanelSectionRow><div role="status" style={infoStyle}>{koInstallReason(installState.reason)}</div></PanelSectionRow>}
        {!!pluginUpdate?.pending && <PanelSectionRow><div style={infoStyle}>게임 파일을 설치하기 전에 아래 '플러그인 업데이트'에서 다운로드된 플러그인 업데이트를 완료하거나 취소해 주세요.</div></PanelSectionRow>}
        <div className="helix-primary"><PanelSectionRow><ButtonItem layout="below" disabled={disabled || !installState?.allowed}
          onClick={() => void interact(installOrUpdate)}>{submission.pending ? "설치 시작 중… (Starting installation…)" : game.managed || game.legacy ? "이 게임의 업스케일러 업데이트 / 모델 변경" : "이 게임에 업스케일러 설치 (Install HelixSR for this game)"}</ButtonItem></PanelSectionRow></div>
        {game.managed && !game.enabled && <PanelSectionRow><ButtonItem layout="below" disabled={disabled || game.compatibility !== "candidate" || game.installation_status?.can_modify === false}
          onClick={() => void interact(() => action("enable"))}>업스케일러 활성화</ButtonItem></PanelSectionRow>}
        {game.managed && game.enabled && game.route === "optiscaler" && game.appid && <PanelSectionRow><ButtonItem layout="below" disabled={disabled}
          onClick={() => void interact(() => launchChange())}>Proton 프록시 시작 옵션 설정</ButtonItem></PanelSectionRow>}
      </>}
      {jobs.slice().reverse().map(job => <PanelSectionRow key={job.id}><div className="helix-card" style={infoStyle} role="status">
        <strong>{job.game}: {job.state === "running" ? "업스케일러 준비 및 설치 중…" : job.state}</strong>{"\n"}{job.message}
        {job.state === "running" && <ButtonItem layout="below" disabled={busy || modalOpen} onClick={() => void interact(async () => openDialog(<ConfirmModal bDisableBackgroundDismiss strTitle="준비 작업을 취소할까요?"
          strDescription="준비 단계 중에는 게임 파일이 변경되지 않으며, 임시 빌드 파일만 정리됩니다."
          strOKButtonText="작업 취소" strCancelButtonText="닫기"
          onOK={() => void run(() => cancelJob(job.id))} />))}>준비 작업 취소</ButtonItem>}
        {diagnostics && <pre style={{ ...infoStyle, fontSize: "11px" }}>{job.log}</pre>}
      </div></PanelSectionRow>)}
      <PanelSectionRow><ButtonItem layout="below" onClick={() => void refresh()} disabled={busy || modalOpen}>라이브러리 및 상태 새로고침</ButtonItem></PanelSectionRow>
      {!!unavailable.length && <PanelSectionRow><ButtonItem layout="below" onClick={() => setUnavailableGames(!unavailableGames)}>{unavailableGames ? "설치 불가 게임 숨기기" : `설치 불가 게임 (${unavailable.length})`}</ButtonItem></PanelSectionRow>}
      {unavailableGames && unavailable.map(g => <PanelSectionRow key={g.id}><div className="helix-card helix-muted">{g.name}{"\n"}{g.installation_status?.issues.map(i => `${i.title}: ${i.reason}\n조치: ${i.steps.join(" ")}`).join("\n\n") || g.reasons.join("\n") || "지원되는 업스케일러가 감지되지 않았습니다"}</div></PanelSectionRow>)}
      {error && <PanelSectionRow><div role="alert" style={{ ...infoStyle, color: "#ffb4a7" }}>{error}</div></PanelSectionRow>}
    </PanelSection>
    {game && <PanelSection title="상태 오버레이">
      <PanelSectionRow><ToggleField label="업스케일러 상태 오버레이 표시 (실험적)"
        description="HUD 헬퍼 및 새 세션 로그 이벤트를 모니터링합니다. 게임을 실행하기 전에 켜세요."
        checked={!!overlay?.enabled && overlay.game_id === game.id} disabled={busy || modalOpen}
        onChange={enabled => void run(() => routeRef.current !== undefined ? setStatusOverlay(game.id, enabled, executableRef.current, routeRef.current) : setStatusOverlay(game.id, enabled, executableRef.current)).then(value => { if (value) publishOverlayStatus(value); })} /></PanelSectionRow>
      {!!overlay?.enabled && overlay.game_id === game.id && <PanelSectionRow><div className="helix-card" style={infoStyle}>
        {overlay.overlay.label}{"\n"}{overlay.overlay.detail}{"\n\n"}
        {overlay.runtime.label}{"\n"}{overlay.runtime.detail}
      </div></PanelSectionRow>}
    </PanelSection>}
    {game && <PanelSection title={game.name}>
      <PanelSectionRow><div className="helix-card" style={infoStyle}>
        출처: {game.source} · 호환성: {game.compatibility === "candidate" ? "설치 가능 (candidate)" : game.compatibility}{"\n"}
        {game.managed ? "설치된 경로" : "감지된 경로"}: {game.route === "direct" ? "네이티브 FSR 3.1 직접 교체 (Direct)" : game.route === "optiscaler" ? "OptiScaler 프록시" : "감지되지 않음"}{"\n"}
        {koStatusSummary(selectedStatus?.summary || "")}{"\n"}
        드라이브 준비 버전: {game.package_version || "이 드라이브에 준비된 패키지 없음"}{"\n"}
        설치된 모델: {game.installed_model || "미설치"}{"\n"}
        {game.route === "optiscaler" && game.installed_optiscaler ? `설치된 OptiScaler: ${game.installed_optiscaler}\n` : ""}
        {game.reasons.join("\n")}
      </div></PanelSectionRow>
      {game.managed && <>
        {game.enabled && <PanelSectionRow><ButtonItem layout="below" disabled={disabled || !canRestore(game)}
          onClick={() => void interact(() => action("disable"))}>업스케일러 비활성화</ButtonItem></PanelSectionRow>}
        <PanelSectionRow><ButtonItem layout="below" disabled={disabled || !canRestore(game)} onClick={() => void interact(() => action("remove"))}>제거 및 원본 파일 복원</ButtonItem></PanelSectionRow>
      </>}
      {game.recovery_available && <PanelSectionRow><ButtonItem layout="below" disabled={disabled || !!game.installation_status?.running} onClick={() => void interact(() => action("recover"))}>중단된 파일 작업 복구</ButtonItem></PanelSectionRow>}
      {game.source === "Imported" && <PanelSectionRow><ButtonItem layout="below" disabled={disabled || game.managed}
        onClick={() => void run(() => forgetGame(game.id)).then(result => { if (result) { setData(cacheLibrary(result)); chooseGame(""); } })}>가져온 게임 폴더 목록에서 제외</ButtonItem></PanelSectionRow>}
    </PanelSection>}
    {game && <PanelSection title="OptiScaler 및 프레임 생성">
      <PanelSectionRow><div style={infoStyle}>
        OptiScaler 설치 여부: {game.optiscaler.present === null ? "미검사" : game.optiscaler.present ? "설치됨" : "감지된 파일 없음"}{"\n"}
        OptiScaler 경로 설정 여부: {game.optiscaler.helix_configured ? "설정됨" : "미설정"}{"\n"}
        OptiScaler 런타임: {game.optiscaler.runtime}{"\n"}
        업스케일러 런타임: {game.helix_runtime}{"\n"}
        프레임 생성(FG): {game.framegen_summary}{"\n"}
        {game.framegen.map(f => `${f.source} · ${f.key}: ${f.value} (${f.meaning})`).join("\n")}
      </div></PanelSectionRow>
      {game.route === "optiscaler" && <PanelSectionRow><div style={infoStyle}>
        대상 실행 파일: {game.main_exe || game.target || "미확인"}{"\n"}
        {(game.optiscaler.setup?.checks || []).map(koCheckLine).join("\n\n")}
      </div></PanelSectionRow>}
      {game.route === "optiscaler" && game.appid && <>
        {!(game.managed && game.enabled) && <PanelSectionRow><ButtonItem layout="below" disabled={disabled} onClick={() => void interact(() => launchChange())}>Proton 프록시 시작 옵션 설정</ButtonItem></PanelSectionRow>}
        <PanelSectionRow><ButtonItem layout="below" disabled={disabled} onClick={() => void interact(() => launchChange(true))}>플러그인 시작 옵션 변경 복원</ButtonItem></PanelSectionRow>
      </>}
      <PanelSectionRow><ButtonItem layout="below" onClick={() => setDiagnostics(!diagnostics)}>{diagnostics ? "진단 및 로그 숨기기" : "진단 및 로그 보기"}</ButtonItem></PanelSectionRow>
      {diagnostics && <PanelSectionRow><div style={infoStyle}>
        폴더: {game.folder}{"\n"}시작 옵션: {game.launch_options || "감지되지 않음"}{"\n"}
        {(game.awareness_warnings || []).join("\n")}{"\n"}
        {Object.entries(game.optiscaler.setup?.settings || {}).map(([key, value]) => `${key}=${value}`).join("\n")}{"\n"}
        {(game.logs || []).map(l => `${l.path}\n${new Date(l.modified * 1000).toLocaleString()}\n${l.excerpt}`).join("\n\n") || "지원되는 로그 파일 없음"}
      </div></PanelSectionRow>}
    </PanelSection>}
    <PanelSection title="플러그인 업데이트">
      <PanelSectionRow><div className="helix-card" style={{ ...infoStyle, borderLeftColor: pluginUpdate?.update_available ? "#ad8aff" : "#55cd92" }}>
        현재 플러그인 버전: {pluginUpdate?.current_version || "불러오는 중…"}{"\n"}
        최신 플러그인 버전: {pluginUpdate?.latest_version || "확인 필요"}{"\n"}
        {pluginUpdate?.error ? "업데이트를 확인하지 못했습니다" : pluginUpdate?.pending ? "다운로드 완료. Decky 확인 창에서 Update를 눌러 설치하세요." : pluginUpdate?.update_available ? "새 플러그인 업데이트가 있습니다" : pluginUpdate?.checked_at ? "최신 버전입니다" : pluginUpdate?.auto_check === false ? "자동 업데이트 확인 꺼짐" : "잠시 후 자동 확인이 실행됩니다"}
      </div></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={busy || modalOpen || !!pluginUpdate?.pending}
        onClick={() => void run(() => checkPluginUpdates(true)).then(r => { if (r) publishPluginStatus(r); })}>플러그인 업데이트 확인</ButtonItem></PanelSectionRow>
      <ToggleField label="플러그인 업데이트 자동 확인" description="시작 시 및 하루 1회 업데이트를 확인합니다. 실제 설치는 직접 승인할 때만 진행됩니다."
        checked={pluginUpdate?.auto_check ?? true} disabled={busy || modalOpen || !!pluginUpdate?.pending}
        onChange={enabled => void run(() => setPluginAutoCheck(enabled)).then(r => { if (r) publishPluginStatus(r); })} />
      {pluginUpdate?.update_available && !pluginUpdate.pending && <div className="helix-primary"><PanelSectionRow><ButtonItem layout="below"
        disabled={disabled} onClick={() => void interact(() => updatePlugin())}>플러그인 업데이트 다운로드</ButtonItem></PanelSectionRow></div>}
      {pluginUpdate?.pending && <div className="helix-primary"><PanelSectionRow><ButtonItem layout="below" disabled={busy || modalOpen}
        onClick={() => void interact(() => updatePlugin(true))}>업데이트 확인 창 열기</ButtonItem></PanelSectionRow></div>}
      {pluginUpdate?.pending && <PanelSectionRow><ButtonItem layout="below" disabled={busy || modalOpen}
        onClick={() => void interact(cancelDownloadedPlugin)}>다운로드한 업데이트 취소</ButtonItem></PanelSectionRow>}
      {pluginUpdate?.pending && <PanelSectionRow><div className="helix-muted">{pluginInstallMessage || "Decky 확인 창에서 Update를 눌러 설치를 완료하세요."}</div></PanelSectionRow>}
      {pluginUpdate?.error && <PanelSectionRow><div className="helix-muted">{pluginUpdate.error}</div></PanelSectionRow>}
    </PanelSection>
    <PanelSection title="업스케일러 버전 및 가이드">
      <PanelSectionRow><div className="helix-card" style={infoStyle}>현재 설치된 버전: {game?.installed_version || "미설치"}{"\n"}
        최신 HelixSR 버전: {data?.release?.version || "확인 필요"}</div></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={busy || modalOpen} onClick={() => void run(() => checkUpdates(true)).then(r => { if (r) setData(d => d ? { ...d, release: r } : d); })}>최신 HelixSR 버전 확인</ButtonItem></PanelSectionRow>
      {data?.release?.error && <PanelSectionRow><div className="helix-muted">{data.release.error}</div></PanelSectionRow>}
      <PanelSectionRow><ButtonItem layout="below" onClick={() => setSetupOptions(!setupOptions)}>{setupOptions ? "로컬 준비 설정 숨기기" : "로컬 준비 및 라이선스 설정"}</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={modalOpen} onClick={() => void interact(async () => openDialog(<ConfirmModal bDisableBackgroundDismiss strTitle="설치 및 사용 가이드" strOKButtonText="확인"
        strDescription={<div><p>1. '게임 선택' 드롭다운에서 게임을 선택하세요. 초록색 테두리는 업스케일러가 설치된 게임이며, 보라색 버튼으로 설치/업데이트를 진행합니다.</p>
          <p>2. 원하는 설치 방식(Direct 또는 OptiScaler), 업스케일러 모델(HelixSR Model E, FSR 4.1.1 iGPU Exact / Lossy), OptiScaler 빌드(0.9.4 / Nightly)를 선택한 뒤 '설치 / 업데이트'를 누르세요.</p>
          <p>3. 작업이 완료되면 게임을 DirectX 12 모드로 실행하세요. Direct 경로는 게임 설정에서 AMD FSR을, OptiScaler 경로는 DLSS(또는 XeSS/FSR 입력)를 선택합니다.</p>
          <p>4. OptiScaler 경로로 FSR 4를 설치한 경우, 게임 중 Insert 키를 눌러 Upscaling → Upscalers → FFX Upscaler에서 HelixSR과 FSR 4를 실시간으로 전환하며 비교할 수 있습니다.</p>
          <p>5. Steam의 OptiScaler 게임은 'Proton 프록시 시작 옵션 설정' 버튼을 눌러 기존 옵션을 유지하면서 WINEDLLOVERRIDES를 자동으로 추가하세요.</p>
          <p>6. 비활성화 및 제거 버튼을 누르면 언제든 백업된 원본 게임 파일로 안전하게 복원됩니다.</p></div>} />))}>
        설치 및 사용 가이드</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={modalOpen} onClick={() => SteamClient.System.OpenInSystemBrowser("https://github.com/supercleans/Upscaler-Decky/blob/main/INSTALL_GUIDE.md")}>전체 가이드 열기</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={modalOpen} onClick={() => SteamClient.System.OpenInSystemBrowser("https://github.com/supercleans/Upscaler-Decky/issues")}>문제 신고하기</ButtonItem></PanelSectionRow>
      {setupOptions && <>
      <PanelSectionRow><ToggleField label="로컬 패키지 준비 약관 동의" checked={!!data?.license_accepted}
        description="공식 HelixSR 프리웨어 릴리즈, NVIDIA DLSS(NVIDIA 라이선스), FSR 4 셰이더 오버라이드, 포터블 Python, numpy 및 DXC를 사용합니다. 생성된 네트워크 파일은 이 기기 내부에만 유지됩니다."
        onChange={accepted => void run(() => setLicense(accepted)).then(ok => setData(d => d ? { ...d, license_accepted: !!ok } : d))} /></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={() => SteamClient.System.OpenInSystemBrowser("https://github.com/lonewolf0622/HelixSR/blob/main/LICENSE")}>HelixSR 라이선스 보기</ButtonItem></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" onClick={() => SteamClient.System.OpenInSystemBrowser("https://github.com/NVIDIA/DLSS/blob/v310.7.0/LICENSE.txt")}>NVIDIA DLSS 라이선스 보기</ButtonItem></PanelSectionRow>
      </>}
    </PanelSection>
    <PanelSection title="게임 가져오기">
      <PanelSectionRow><DropdownItem layout="below" label="가져올 런처 선택" menuLabel="가져올 런처 선택"
        selectedOption={launcher} disabled={disabled} rgOptions={launcherOptions}
        onChange={option => chooseLauncher(getOptionValue(option))} /></PanelSectionRow>
      <div className="helix-primary"><PanelSectionRow><ButtonItem layout="below" disabled={disabled}
        onClick={() => void interact(importFromLauncher)}>지금 가져오기</ButtonItem></PanelSectionRow></div>
      <PanelSectionRow><div className="helix-muted">선택한 런처에 설치된 게임을 검색하고 업스케일러 호환성을 진단합니다.</div></PanelSectionRow>
      {!!importMessage && <PanelSectionRow><div className="helix-card helix-muted" style={infoStyle}>{importMessage}</div></PanelSectionRow>}
      <PanelSectionRow><ButtonItem layout="below" disabled={disabled} onClick={() => { if (!interactionBusy && Date.now() >= interactionAfter) setImportOpen(!importOpen); }}>{importOpen ? "게임 폴더 관리 숨기기" : "게임 폴더 직접 관리"}</ButtonItem></PanelSectionRow>
      {importOpen && <>
      <PanelSectionRow><div className="helix-muted">Steam, Heroic, Legendary, Lutris 외의 사용자 지정 게임 폴더를 아래에서 직접 추가할 수 있습니다.</div></PanelSectionRow>
      <PanelSectionRow><TextField label="게임 폴더 경로" value={folder} disabled={disabled} onChange={e => setFolder(e.target.value)} /></PanelSectionRow>
      <PanelSectionRow><ButtonItem layout="below" disabled={disabled} onClick={() => void interact(async () => { await run(async () => {
        const pick = await openFilePicker(1, folder || "/home/deck", false, true);
        queueFolders([...new Set([...pendingFolders, pick.realpath])]);
      }); })}>파일 탐색기로 폴더 추가</ButtonItem></PanelSectionRow>
      {!!folder && <PanelSectionRow><ButtonItem layout="below" disabled={disabled} onClick={() => { if (interactionBusy || Date.now() < interactionAfter) return; queueFolders([...new Set([...pendingFolders, folder])]); setFolder(""); }}>입력한 경로 추가</ButtonItem></PanelSectionRow>}
      {!!folders.length && <PanelSectionRow><div className="helix-card helix-muted">{folders.join("\n")}</div></PanelSectionRow>}
      {folders.map(path => <PanelSectionRow key={path}><ButtonItem layout="below" disabled={disabled}
        onClick={() => queueFolders(pendingFolders.filter(p => p !== path))}>폴더 제외: {path.split("/").filter(Boolean).pop()}</ButtonItem></PanelSectionRow>)}
      {!!folders.length && <PanelSectionRow><ButtonItem layout="below" disabled={disabled}
        onClick={() => queueFolders([])}>선택한 폴더 모두 비우기</ButtonItem></PanelSectionRow>}
      <PanelSectionRow><ButtonItem layout="below" disabled={disabled || !folders.length} onClick={() => void run(() => importFolders(folders)).then(result => {
        if (result) { setData(cacheLibrary(result)); queueFolders([]); }
      })}>선택한 폴더 가져오기 ({folders.length})</ButtonItem></PanelSectionRow>
      </>}
    </PanelSection>
  </div>;
}

export default definePlugin(() => {
  pluginDisposed = false;
  if (pluginUpdateTimer) clearInterval(pluginUpdateTimer);
  pollPluginStatus();
  pluginUpdateTimer = setInterval(pollPluginStatus, 60000);
  if (overlayTimer) clearInterval(overlayTimer);
  pollOverlayStatus();
  overlayTimer = setInterval(pollOverlayStatus, 2000);
  if (typeof DeckyBackend !== "undefined" && DeckyBackend.addEventListener && DeckyBackend.removeEventListener) {
    DeckyBackend.addEventListener("loader/add_plugin_install_prompt", nativeUpdatePrompt);
    DeckyBackend.addEventListener("loader/plugin_download_start", nativeUpdateStarted);
    DeckyBackend.addEventListener("loader/plugin_download_finish", nativeUpdateFinished);
  }
  return ({
  name: "Upscaler Decky", titleView: <div className={staticClasses.Title}>Upscaler Decky</div>,
  content: <Content />, icon: <FaAdjust />, onDismount() {
    pluginDisposed = true;
    if (overlayTimer) clearInterval(overlayTimer);
    overlayTimer = undefined;
    void setStatusOverlay(null, false).catch(() => {});
    latestOverlayStatus = undefined;
    pluginInstaller.dispose();
    if (pluginUpdateTimer) clearInterval(pluginUpdateTimer);
    pluginUpdateTimer = undefined;
    if (typeof DeckyBackend !== "undefined" && DeckyBackend.removeEventListener) {
      DeckyBackend.removeEventListener("loader/add_plugin_install_prompt", nativeUpdatePrompt);
      DeckyBackend.removeEventListener("loader/plugin_download_start", nativeUpdateStarted);
      DeckyBackend.removeEventListener("loader/plugin_download_finish", nativeUpdateFinished);
    }
    if (jobTimer) clearInterval(jobTimer);
    jobTimer = undefined;
  },
  });
});
