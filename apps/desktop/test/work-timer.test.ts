import { describe, expect, it } from "vitest";
import { workedParts } from "../src/renderer/lib/work-timer";

describe("workedParts", () => {
  it("settled: rounds and clamps a sub-second turn up to 1s", () => {
    expect(workedParts(400, false)).toEqual({ minutes: 0, seconds: 1 });
    expect(workedParts(500, false)).toEqual({ minutes: 0, seconds: 1 });
  });

  it("settled: rounds to whole seconds", () => {
    expect(workedParts(8000, false)).toEqual({ minutes: 0, seconds: 8 });
    expect(workedParts(8400, false)).toEqual({ minutes: 0, seconds: 8 });
  });

  it("settled: splits minutes and seconds", () => {
    expect(workedParts(71000, false)).toEqual({ minutes: 1, seconds: 11 });
    expect(workedParts(60000, false)).toEqual({ minutes: 1, seconds: 0 });
  });

  it("live: floors (ticking counter) and never clamps up", () => {
    expect(workedParts(71999, true)).toEqual({ minutes: 1, seconds: 11 });
    expect(workedParts(500, true)).toEqual({ minutes: 0, seconds: 0 });
    expect(workedParts(0, true)).toEqual({ minutes: 0, seconds: 0 });
  });

  it("collapses non-finite or negative input to zero", () => {
    expect(workedParts(Number.NaN, false)).toEqual({ minutes: 0, seconds: 0 });
    expect(workedParts(-5, false)).toEqual({ minutes: 0, seconds: 0 });
    expect(workedParts(Number.POSITIVE_INFINITY, false)).toEqual({ minutes: 0, seconds: 0 });
  });
});
