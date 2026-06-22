// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetExternalUrlBrowserCacheForTest } from "../src/renderer/components/ExternalUrlMenu";
import { BrowserPanel } from "../src/renderer/components/right-panel/BrowserPanel";
import { setupI18n } from "../src/renderer/i18n";
import { resetAppStore, useAppStore } from "../src/renderer/store";

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  resetAppStore();
  resetExternalUrlBrowserCacheForTest();
});

afterEach(() => {
  resetExternalUrlBrowserCacheForTest();
  delete (window as { chengxiaobang?: unknown }).chengxiaobang;
  vi.restoreAllMocks();
});

describe("BrowserPanel external browser menu", () => {
  it("opens an http URL with a selected browser from the right click menu", async () => {
    const openPath = vi.fn(async () => ({ ok: true as const }));
    const detectExternalBrowsers = vi.fn(async () => [
      {
        id: "chrome",
        name: "Google Chrome",
        appPath: "/Applications/Google Chrome.app"
      }
    ]);
    const openExternalUrlInBrowser = vi.fn(async () => ({ ok: true as const }));
    window.chengxiaobang = {
      openPath,
      detectExternalBrowsers,
      openExternalUrlInBrowser
    } as NonNullable<Window["chengxiaobang"]>;
    useAppStore.getState().setBrowserUrl("https://example.com/docs");

    render(<BrowserPanel />);
    fireEvent.contextMenu(screen.getByTitle("在系统中打开"));

    expect(await screen.findByText("默认浏览器")).toBeInTheDocument();
    expect(await screen.findByText("Google Chrome")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Google Chrome"));

    await waitFor(() =>
      expect(openExternalUrlInBrowser).toHaveBeenCalledWith("chrome", "https://example.com/docs")
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it("keeps file URLs on the local openPath path without showing browser choices", async () => {
    const openPath = vi.fn(async () => ({ ok: true as const }));
    const detectExternalBrowsers = vi.fn(async () => []);
    const openExternalUrlInBrowser = vi.fn(async () => ({ ok: true as const }));
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    window.chengxiaobang = {
      openPath,
      detectExternalBrowsers,
      openExternalUrlInBrowser
    } as NonNullable<Window["chengxiaobang"]>;
    useAppStore.getState().setBrowserUrl("file:///tmp/demo/page%20one.html");

    render(<BrowserPanel />);
    const button = screen.getByTitle("在系统中打开");
    fireEvent.contextMenu(button);

    expect(screen.queryByText("默认浏览器")).not.toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() => expect(openPath).toHaveBeenCalledWith("/tmp/demo/page one.html"));
    expect(openExternalUrlInBrowser).not.toHaveBeenCalled();
    expect(detectExternalBrowsers).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("stops and blanks the webview when the browser panel unmounts", () => {
    window.chengxiaobang = {
      openPath: vi.fn(async () => ({ ok: true as const })),
      detectExternalBrowsers: vi.fn(async () => []),
      openExternalUrlInBrowser: vi.fn(async () => ({ ok: true as const }))
    } as NonNullable<Window["chengxiaobang"]>;
    useAppStore.getState().setBrowserUrl("https://example.com/docs");

    const { container, unmount } = render(<BrowserPanel />);
    const view = container.querySelector("webview") as HTMLElement & {
      stop?: () => void;
      getURL?: () => string;
    };
    const stop = vi.fn();
    view.stop = stop;
    view.getURL = () => "https://example.com/docs";

    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(view.getAttribute("src")).toBeNull();
  });
});
