// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopUpdateState } from "../src/common/update";
import "../src/renderer/i18n";
import { UpdateCenter } from "../src/renderer/components/UpdateCenter";

beforeEach(() => {
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
});

describe("UpdateCenter", () => {
  it("shows an available update and starts the download", async () => {
    const bridge = installUpdateBridge({
      status: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0"
    });

    render(<UpdateCenter />);

    expect(await screen.findByText("发现新版本 0.2.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载更新" }));

    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows download progress without an action button", async () => {
    installUpdateBridge({
      status: "downloading",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      progress: { percent: 55 }
    });

    render(<UpdateCenter />);

    expect(await screen.findByText("正在下载更新")).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载更新" })).not.toBeInTheDocument();
  });

  it("shows a downloaded update and installs it", async () => {
    const bridge = installUpdateBridge({
      status: "downloaded",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0"
    });

    render(<UpdateCenter />);

    expect(await screen.findByText("更新已下载")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重启安装" }));

    expect(bridge.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows manual errors and retries the check", async () => {
    const bridge = installUpdateBridge({
      status: "error",
      currentVersion: "0.1.0",
      error: "network unavailable",
      isManualCheck: true
    });

    render(<UpdateCenter />);

    expect(await screen.findByText("更新失败")).toBeInTheDocument();
    expect(screen.getByText("network unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(bridge.checkForUpdates).toHaveBeenCalledWith({ manual: true });
  });

  it("keeps automatic no-update checks silent", async () => {
    installUpdateBridge({
      status: "not_available",
      currentVersion: "0.1.0",
      isManualCheck: false
    });

    render(<UpdateCenter />);

    await waitFor(() => {
      expect(screen.queryByText("当前已是最新版本")).not.toBeInTheDocument();
    });
  });
});

function installUpdateBridge(initialState: DesktopUpdateState) {
  const listeners = new Set<(state: DesktopUpdateState) => void>();
  const bridge = {
    getUpdateState: vi.fn(async () => initialState),
    checkForUpdates: vi.fn(async () => initialState),
    downloadUpdate: vi.fn(async () => initialState),
    installUpdate: vi.fn(async () => initialState),
    onUpdateState: vi.fn((listener: (state: DesktopUpdateState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(next: DesktopUpdateState) {
      for (const listener of listeners) {
        listener(next);
      }
    }
  };
  window.chengxiaobang = bridge as NonNullable<Window["chengxiaobang"]>;
  return bridge;
}
