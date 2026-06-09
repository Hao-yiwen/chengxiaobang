import { describe, expect, it } from "vitest";
import { thinkingSeconds } from "../src/renderer/lib/reasoning";

describe("thinkingSeconds", () => {
  it("floors while live so the timer ticks up", () => {
    expect(thinkingSeconds(2750, true)).toBe(2);
    expect(thinkingSeconds(500, true)).toBe(0);
  });

  it("rounds and clamps to at least one second once settled", () => {
    expect(thinkingSeconds(2750)).toBe(3);
    expect(thinkingSeconds(200)).toBe(1);
    expect(thinkingSeconds(0)).toBe(1);
  });
});
