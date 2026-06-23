import { describe, expect, it } from "vitest";
import { shouldShowSessionDebugButton } from "../src/renderer/lib/runtime-flags";

describe("renderer runtime flags", () => {
  it("shows the session debug button only in development", () => {
    expect(shouldShowSessionDebugButton({ DEV: true, PROD: false })).toBe(true);
    expect(shouldShowSessionDebugButton({ DEV: false, PROD: true })).toBe(false);
    expect(shouldShowSessionDebugButton({ DEV: true, PROD: true })).toBe(false);
  });
});
