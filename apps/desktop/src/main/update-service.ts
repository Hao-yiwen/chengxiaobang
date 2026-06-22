import { BrowserWindow } from "electron";
import { normalizeErrorMessage } from "@chengxiaobang/shared";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { DesktopUpdateState } from "../common/update";
import type { TrustedIpcRegistrar } from "./trusted-ipc";

export interface DesktopUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "checking-for-update", listener: () => void): this;
  on(event: "update-available", listener: (info: UpdateInfo) => void): this;
  on(event: "update-not-available", listener: (info: UpdateInfo) => void): this;
  on(event: "download-progress", listener: (progress: ProgressInfo) => void): this;
  on(event: "update-downloaded", listener: (info: UpdateInfo) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface DesktopUpdateServiceOptions {
  currentVersion: string;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  updater?: DesktopUpdater;
  updaterUnavailableReason?: string;
  now?: () => Date;
}

export class DesktopUpdateService {
  private readonly isEnabled: boolean;
  private readonly now: () => Date;
  private readonly updater?: DesktopUpdater;
  private state: DesktopUpdateState;
  private autoCheckTimer: NodeJS.Timeout | undefined;
  private currentCheckManual = false;

  constructor(options: DesktopUpdateServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.updater = options.updater;
    this.isEnabled = options.isPackaged && options.platform === "darwin" && Boolean(options.updater);
    this.state = this.isEnabled
      ? { status: "idle", currentVersion: options.currentVersion }
      : {
          status: "disabled",
          currentVersion: options.currentVersion,
          error: options.isPackaged
            ? (options.updaterUnavailableReason ?? "当前平台暂不支持自动更新")
            : "开发模式不启用自动更新"
        };

    if (this.isEnabled && this.updater) {
      this.configureUpdater(this.updater);
    }
  }

  getState(): DesktopUpdateState {
    return { ...this.state, progress: this.state.progress ? { ...this.state.progress } : undefined };
  }

  startAutoChecks(intervalMs = 60 * 60 * 1000): void {
    if (this.autoCheckTimer) {
      console.debug("[update] 自动更新检查已启动，跳过重复启动");
      return;
    }
    if (!this.isEnabled) {
      console.info("[update] 自动更新未启动：当前运行环境不可用", {
        status: this.state.status,
        reason: this.state.error
      });
      return;
    }
    console.info("[update] 启动自动更新检查", { intervalMs });
    void this.checkForUpdates({ manual: false });
    this.autoCheckTimer = setInterval(() => {
      void this.checkForUpdates({ manual: false });
    }, intervalMs);
  }

  stopAutoChecks(): void {
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer);
      this.autoCheckTimer = undefined;
      console.info("[update] 已停止自动更新检查");
    }
  }

  async checkForUpdates(options: { manual?: boolean } = {}): Promise<DesktopUpdateState> {
    const manual = Boolean(options.manual);
    if (!this.isEnabled || !this.updater) {
      console.info("[update] 跳过更新检查：更新能力不可用", {
        manual,
        reason: this.state.error
      });
      this.setState({ ...this.state, isManualCheck: manual });
      return this.getState();
    }
    if (this.state.status === "checking" || this.state.status === "downloading") {
      console.info("[update] 跳过重复更新检查", {
        manual,
        status: this.state.status
      });
      return this.getState();
    }

    this.currentCheckManual = manual;
    this.setState({
      status: "checking",
      currentVersion: this.state.currentVersion,
      lastCheckedAt: this.now().toISOString(),
      isManualCheck: manual
    });
    console.info("[update] 开始检查更新", {
      manual,
      currentVersion: this.state.currentVersion
    });

    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.handleError(error, manual);
    }
    return this.getState();
  }

  async downloadUpdate(): Promise<DesktopUpdateState> {
    if (!this.isEnabled || !this.updater) {
      console.warn("[update] 下载更新失败：更新能力不可用", { reason: this.state.error });
      this.setState({ ...this.state, status: "disabled", isManualCheck: true });
      return this.getState();
    }
    if (this.state.status !== "available" && this.state.status !== "error") {
      console.info("[update] 忽略下载更新请求：当前状态不可下载", {
        status: this.state.status
      });
      return this.getState();
    }

    this.setState({
      ...this.state,
      status: "downloading",
      progress: { percent: 0 },
      error: undefined,
      isManualCheck: true
    });
    console.info("[update] 开始下载更新", {
      currentVersion: this.state.currentVersion,
      availableVersion: this.state.availableVersion
    });

    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.handleError(error, true);
    }
    return this.getState();
  }

  installUpdate(): DesktopUpdateState {
    if (!this.isEnabled || !this.updater) {
      console.warn("[update] 安装更新失败：更新能力不可用", { reason: this.state.error });
      this.setState({ ...this.state, status: "disabled", isManualCheck: true });
      return this.getState();
    }
    if (this.state.status !== "downloaded") {
      console.info("[update] 忽略安装更新请求：更新尚未下载完成", {
        status: this.state.status
      });
      return this.getState();
    }
    console.info("[update] 触发重启安装更新", {
      currentVersion: this.state.currentVersion,
      availableVersion: this.state.availableVersion
    });
    this.updater.quitAndInstall(false, true);
    return this.getState();
  }

  private configureUpdater(updater: DesktopUpdater): void {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on("checking-for-update", () => {
      console.debug("[update] electron-updater 已进入检查状态");
    });
    updater.on("update-available", (info) => {
      const availableVersion = info.version;
      console.info("[update] 发现可用更新", {
        currentVersion: this.state.currentVersion,
        availableVersion,
        releaseDate: info.releaseDate
      });
      this.setState({
        status: "available",
        currentVersion: this.state.currentVersion,
        availableVersion,
        releaseName: info.releaseName,
        releaseDate: info.releaseDate,
        releaseNotes: releaseNotesToText(info.releaseNotes),
        lastCheckedAt: this.state.lastCheckedAt,
        isManualCheck: this.currentCheckManual
      });
    });
    updater.on("update-not-available", (info) => {
      console.info("[update] 当前已是最新版本", {
        currentVersion: this.state.currentVersion,
        checkedVersion: info.version,
        manual: this.currentCheckManual
      });
      this.setState({
        status: "not_available",
        currentVersion: this.state.currentVersion,
        availableVersion: info.version,
        releaseDate: info.releaseDate,
        lastCheckedAt: this.state.lastCheckedAt,
        isManualCheck: this.currentCheckManual
      });
    });
    updater.on("download-progress", (progress) => {
      const percent = clampPercent(progress.percent);
      console.debug("[update] 更新下载进度", {
        percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      });
      this.setState({
        ...this.state,
        status: "downloading",
        progress: {
          percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond
        },
        isManualCheck: true
      });
    });
    updater.on("update-downloaded", (info) => {
      console.info("[update] 更新下载完成", {
        currentVersion: this.state.currentVersion,
        availableVersion: info.version
      });
      this.setState({
        ...this.state,
        status: "downloaded",
        availableVersion: info.version,
        releaseName: info.releaseName,
        releaseDate: info.releaseDate,
        releaseNotes: releaseNotesToText(info.releaseNotes) ?? this.state.releaseNotes,
        progress: { ...(this.state.progress ?? {}), percent: 100 },
        error: undefined,
        isManualCheck: true
      });
    });
    updater.on("error", (error) => {
      this.handleError(error, this.currentCheckManual);
    });
  }

  private handleError(error: unknown, manual: boolean): void {
    const message = messageFromError(error);
    console.error("[update] 更新流程失败", {
      manual,
      status: this.state.status,
      error: message
    });
    this.setState({
      ...this.state,
      status: "error",
      // 完整错误已写日志,UI 只展示归一化后的精简文案,避免 electron-updater 的长错误撑满更新中心面板。
      error: normalizeErrorMessage(error),
      progress: undefined,
      isManualCheck: manual
    });
  }

  private setState(next: DesktopUpdateState): void {
    this.state = next;
    broadcastUpdateState(this.getState());
  }
}

export function registerUpdateIpc(ipcMain: TrustedIpcRegistrar, service: DesktopUpdateService): void {
  ipcMain.handle("update:get-state", () => service.getState());
  ipcMain.handle("update:check", (_event, input: unknown) =>
    service.checkForUpdates({ manual: readManualFlag(input) })
  );
  ipcMain.handle("update:download", () => service.downloadUpdate());
  ipcMain.handle("update:install", () => service.installUpdate());
}

function broadcastUpdateState(state: DesktopUpdateState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("update:state", state);
  }
}

function readManualFlag(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return true;
  }
  return (input as { manual?: unknown }).manual !== false;
}

function releaseNotesToText(notes: UpdateInfo["releaseNotes"]): string | undefined {
  if (!notes) {
    return undefined;
  }
  if (typeof notes === "string") {
    return notes;
  }
  return notes
    .map((note) => note.note)
    .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
    .join("\n\n");
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, percent));
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
