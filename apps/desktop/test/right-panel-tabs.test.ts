import { describe, expect, it } from "vitest";
import {
  CHAT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  closeRightPanelTab,
  maximizedRightPanelWidth,
  normalizeRightPanelSession,
  openOrFocusRightPanelTab,
  persistableRightPanelTabs
} from "../src/renderer/store/helpers/right-panel";
import type { RightPanelTab } from "../src/renderer/store/types";

function tab(id: string, kind: RightPanelTab["kind"], extra: Partial<RightPanelTab> = {}): RightPanelTab {
  return { id, kind, ...extra };
}

describe("openOrFocusRightPanelTab", () => {
  it("focuses an existing singleton tab instead of duplicating it", () => {
    const tabs = [tab("a", "changes"), tab("b", "browser")];
    const result = openOrFocusRightPanelTab(tabs, { kind: "changes" });
    expect(result.tabs).toBe(tabs); // 未变动
    expect(result.activeTabId).toBe("a");
  });

  it("updates a singleton tab title when focusing", () => {
    const tabs = [tab("a", "files", { title: "old.ts" })];
    const result = openOrFocusRightPanelTab(tabs, { kind: "files", title: "new.ts" });
    expect(result.activeTabId).toBe("a");
    expect(result.tabs.find((item) => item.id === "a")?.title).toBe("new.ts");
  });

  it("always creates a new terminal tab", () => {
    const tabs = [tab("t1", "terminal", { terminalId: "pty_1" })];
    const result = openOrFocusRightPanelTab(tabs, { kind: "terminal", terminalId: "pty_2" });
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[1].terminalId).toBe("pty_2");
    expect(result.activeTabId).toBe(result.tabs[1].id);
  });
});

describe("closeRightPanelTab", () => {
  it("moves focus to the left neighbour when closing the active tab", () => {
    const tabs = [tab("a", "changes"), tab("b", "terminal"), tab("c", "browser")];
    const result = closeRightPanelTab(tabs, "b", "b");
    expect(result.tabs.map((item) => item.id)).toEqual(["a", "c"]);
    expect(result.activeTabId).toBe("a");
    expect(result.closed?.id).toBe("b");
  });

  it("falls back to the right neighbour when closing the first tab", () => {
    const tabs = [tab("a", "changes"), tab("b", "browser")];
    const result = closeRightPanelTab(tabs, "a", "a");
    expect(result.activeTabId).toBe("b");
  });

  it("clears the active tab when the last one is closed", () => {
    const result = closeRightPanelTab([tab("a", "changes")], "a", "a");
    expect(result.tabs).toHaveLength(0);
    expect(result.activeTabId).toBeUndefined();
  });

  it("keeps the active tab untouched when closing another tab", () => {
    const tabs = [tab("a", "changes"), tab("b", "browser")];
    const result = closeRightPanelTab(tabs, "a", "b");
    expect(result.activeTabId).toBe("a");
    expect(result.tabs.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("persistableRightPanelTabs", () => {
  it("drops terminal tabs (PTY cannot survive a restart)", () => {
    const tabs = [tab("a", "changes"), tab("t", "terminal"), tab("b", "files")];
    expect(persistableRightPanelTabs(tabs).map((item) => item.kind)).toEqual(["changes", "files"]);
  });
});

describe("normalizeRightPanelSession", () => {
  it("migrates a legacy single-mode snapshot into a tab", () => {
    const normalized = normalizeRightPanelSession({
      open: true,
      mode: "browser",
      width: 520,
      browserUrl: "https://example.com"
    });
    expect(normalized.tabs).toHaveLength(1);
    expect(normalized.tabs[0].kind).toBe("browser");
    expect(normalized.activeTabId).toBe(normalized.tabs[0].id);
    expect(normalized.open).toBe(true);
  });

  it("turns a legacy floating mode into a closed empty panel", () => {
    const normalized = normalizeRightPanelSession({
      open: true,
      mode: "progress",
      width: 320,
      browserUrl: ""
    });
    expect(normalized.tabs).toHaveLength(0);
    expect(normalized.open).toBe(false);
  });

  it("drops terminal tabs and clamps activeTabId on a new-shape snapshot", () => {
    const normalized = normalizeRightPanelSession({
      open: true,
      width: 400,
      tabs: [tab("a", "changes"), tab("t", "terminal", { terminalId: "pty" })],
      activeTabId: "t",
      browserUrl: ""
    });
    expect(normalized.tabs.map((item) => item.kind)).toEqual(["changes"]);
    expect(normalized.activeTabId).toBe("a");
  });
});

describe("maximizedRightPanelWidth", () => {
  it("fills the container minus the chat minimum, beyond the normal cap", () => {
    expect(maximizedRightPanelWidth(1600)).toBe(1600 - CHAT_PANEL_MIN_WIDTH);
    expect(maximizedRightPanelWidth(1600)).toBeGreaterThan(RIGHT_PANEL_MAX_WIDTH);
  });

  it("falls back to the normal max width when the container is unknown", () => {
    expect(maximizedRightPanelWidth(undefined)).toBe(RIGHT_PANEL_MAX_WIDTH);
  });
});
