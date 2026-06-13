import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { DesktopUpdateService, type DesktopUpdater } from "../src/main/update-service";

const getAllWindows = vi.hoisted(() => vi.fn(() => []));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows
  }
}));

class FakeUpdater extends EventEmitter implements DesktopUpdater {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checks = 0;
  downloads = 0;
  installed = false;
  nextCheck?: () => void;
  nextDownload?: () => void;

  override on(event: "checking-for-update", listener: () => void): this;
  override on(event: "update-available", listener: (info: UpdateInfo) => void): this;
  override on(event: "update-not-available", listener: (info: UpdateInfo) => void): this;
  override on(event: "download-progress", listener: (progress: ProgressInfo) => void): this;
  override on(event: "update-downloaded", listener: (info: UpdateInfo) => void): this;
  override on(event: "error", listener: (error: Error) => void): this;
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  async checkForUpdates(): Promise<void> {
    this.checks += 1;
    this.nextCheck?.();
  }

  async downloadUpdate(): Promise<void> {
    this.downloads += 1;
    this.nextDownload?.();
  }

  quitAndInstall(): void {
    this.installed = true;
  }

  emitAvailable(info: Partial<UpdateInfo> = {}): void {
    this.emit("update-available", updateInfo(info));
  }

  emitNotAvailable(info: Partial<UpdateInfo> = {}): void {
    this.emit("update-not-available", updateInfo(info));
  }

  emitProgress(progress: Partial<ProgressInfo> = {}): void {
    this.emit("download-progress", {
      percent: 42,
      transferred: 420,
      total: 1000,
      bytesPerSecond: 100,
      ...progress
    });
  }

  emitDownloaded(info: Partial<UpdateInfo> = {}): void {
    this.emit("update-downloaded", updateInfo(info));
  }

  emitError(error: Error): void {
    this.emit("error", error);
  }
}

beforeEach(() => {
  getAllWindows.mockReturnValue([]);
});

describe("DesktopUpdateService", () => {
  it("returns disabled state in development", async () => {
    const service = new DesktopUpdateService({
      currentVersion: "0.1.0",
      isPackaged: false,
      platform: "darwin"
    });

    const state = await service.checkForUpdates({ manual: true });

    expect(state.status).toBe("disabled");
    expect(state.isManualCheck).toBe(true);
    expect(state.error).toContain("开发模式");
  });

  it("checks for updates without auto downloading", async () => {
    const updater = new FakeUpdater();
    updater.nextCheck = () => updater.emitAvailable({ version: "0.2.0" });
    const service = packagedService(updater);

    const state = await service.checkForUpdates({ manual: true });

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.checks).toBe(1);
    expect(state.status).toBe("available");
    expect(state.availableVersion).toBe("0.2.0");
    expect(state.isManualCheck).toBe(true);
  });

  it("tracks download progress and marks the update downloaded", async () => {
    const updater = new FakeUpdater();
    const service = packagedService(updater);
    updater.emitAvailable({ version: "0.2.0" });
    updater.nextDownload = () => {
      updater.emitProgress({ percent: 55 });
      updater.emitDownloaded({ version: "0.2.0" });
    };

    const state = await service.downloadUpdate();

    expect(updater.downloads).toBe(1);
    expect(state.status).toBe("downloaded");
    expect(state.availableVersion).toBe("0.2.0");
    expect(state.progress?.percent).toBe(100);
  });

  it("records updater errors with the triggering source", async () => {
    const updater = new FakeUpdater();
    updater.nextCheck = () => updater.emitError(new Error("network unavailable"));
    const service = packagedService(updater);

    const state = await service.checkForUpdates({ manual: true });

    expect(state.status).toBe("error");
    expect(state.error).toBe("network unavailable");
    expect(state.isManualCheck).toBe(true);
  });

  it("quits and installs only after the update is downloaded", () => {
    const updater = new FakeUpdater();
    const service = packagedService(updater);
    updater.emitDownloaded({ version: "0.2.0" });

    const state = service.installUpdate();

    expect(state.status).toBe("downloaded");
    expect(updater.installed).toBe(true);
  });
});

function packagedService(updater: FakeUpdater): DesktopUpdateService {
  return new DesktopUpdateService({
    currentVersion: "0.1.0",
    isPackaged: true,
    platform: "darwin",
    updater
  });
}

function updateInfo(info: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: "0.1.0",
    files: [],
    path: "",
    sha512: "",
    releaseDate: "2026-06-13T00:00:00.000Z",
    ...info
  };
}
