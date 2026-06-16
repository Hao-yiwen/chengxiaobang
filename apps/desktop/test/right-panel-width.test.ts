import { describe, expect, it } from "vitest";
import {
  CHAT_PANEL_MIN_WIDTH,
  DEFAULT_RIGHT_PANEL_WIDTH,
  RIGHT_PANEL_FILE_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_REVIEW_WIDTH,
  clampRightPanelWidth,
  rightPanelMaxWidthForContainer,
  rightPanelWidthForOpen,
  visibleRightPanelWidth,
  sanitizePersistedAppState
} from "../src/renderer/store/helpers/right-panel";
import { initialState } from "../src/renderer/store/initial-state";

describe("right panel width defaults", () => {
  it("uses the compact right panel width for fresh state", () => {
    expect(DEFAULT_RIGHT_PANEL_WIDTH).toBe(320);
    expect(initialState.rightPanelWidth).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
  });

  it("uses smaller defaults for wide panel modes", () => {
    expect(RIGHT_PANEL_REVIEW_WIDTH).toBe(640);
    expect(RIGHT_PANEL_FILE_WIDTH).toBe(640);
  });

  it("migrates old default widths and caps oversized custom widths", () => {
    const migrated = sanitizePersistedAppState({
      view: "chat",
      rightPanelWidth: 340,
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
        },
        oversizedWidth: {
          open: true,
          mode: "browser",
          width: 1200,
          browserUrl: ""
        }
      }
    });

    expect(migrated.rightPanelWidth).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
    expect(migrated.rightPanelBySession?.defaultWidth?.width).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
    expect(migrated.rightPanelBySession?.customWidth?.width).toBe(420);
    expect(migrated.rightPanelBySession?.oversizedWidth?.width).toBe(RIGHT_PANEL_MAX_WIDTH);
  });

  it("opens from a compact default but keeps current width while already open", () => {
    expect(rightPanelWidthForOpen(700, false)).toBe(DEFAULT_RIGHT_PANEL_WIDTH);
    expect(rightPanelWidthForOpen(700, false, RIGHT_PANEL_FILE_WIDTH)).toBe(
      RIGHT_PANEL_FILE_WIDTH
    );
    expect(rightPanelWidthForOpen(700, true)).toBe(700);
  });

  it("uses the file preview target width as the first visible panel width", () => {
    const width = rightPanelWidthForOpen(
      DEFAULT_RIGHT_PANEL_WIDTH,
      false,
      RIGHT_PANEL_FILE_WIDTH
    );

    expect(width).toBe(RIGHT_PANEL_FILE_WIDTH);
    expect(visibleRightPanelWidth(width, CHAT_PANEL_MIN_WIDTH + RIGHT_PANEL_FILE_WIDTH)).toBe(
      RIGHT_PANEL_FILE_WIDTH
    );
  });

  it("clamps saved and visible widths so chat keeps a minimum workspace", () => {
    const narrowContainer = CHAT_PANEL_MIN_WIDTH + 420;

    expect(clampRightPanelWidth(5000)).toBe(RIGHT_PANEL_MAX_WIDTH);
    expect(rightPanelMaxWidthForContainer(narrowContainer)).toBe(420);
    expect(visibleRightPanelWidth(RIGHT_PANEL_MAX_WIDTH, narrowContainer)).toBe(420);
    expect(visibleRightPanelWidth(RIGHT_PANEL_MAX_WIDTH, CHAT_PANEL_MIN_WIDTH - 1)).toBe(0);
  });
});
