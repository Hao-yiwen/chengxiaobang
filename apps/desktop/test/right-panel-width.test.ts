import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIGHT_PANEL_WIDTH,
  sanitizePersistedAppState
} from "../src/renderer/store/helpers/right-panel";
import { initialState } from "../src/renderer/store/initial-state";

describe("right panel width defaults", () => {
  it("uses the compact right panel width for fresh state", () => {
    expect(initialState.rightPanelWidth).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
  });

  it("migrates the old default width without changing custom widths", () => {
    const migrated = sanitizePersistedAppState({
      view: "chat",
      rightPanelWidth: 380,
      rightPanelBySession: {
        defaultWidth: {
          open: true,
          mode: null,
          width: 380,
          browserUrl: ""
        },
        customWidth: {
          open: true,
          mode: "terminal",
          width: 420,
          browserUrl: ""
        }
      }
    });

    expect(migrated.rightPanelWidth).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
    expect(migrated.rightPanelBySession?.defaultWidth?.width).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
    expect(migrated.rightPanelBySession?.customWidth?.width).toBe(420);
  });
});
