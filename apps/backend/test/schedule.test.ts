import { describe, expect, it } from "vitest";
import { computeNextRunAt, validateCron } from "../src/tasks/schedule";

describe("validateCron", () => {
  it("accepts standard 5-field expressions", () => {
    expect(validateCron("0 9 * * *")).toBeUndefined();
    expect(validateCron("*/5 * * * *")).toBeUndefined();
    expect(validateCron("30 8 * * 1-5")).toBeUndefined();
  });

  it("rejects 6-field (seconds) expressions to lock the 5-field contract", () => {
    expect(validateCron("0 0 9 * * *")).toContain("5 个字段");
  });

  it("rejects malformed expressions with a friendly message", () => {
    expect(validateCron("not a cron at all")).toContain("cron 表达式无效");
    expect(validateCron("99 9 * * *")).toContain("cron 表达式无效");
  });
});

describe("computeNextRunAt", () => {
  it("computes the next trigger strictly after `from`", () => {
    // 本地时区无关的写法：每 5 分钟触发，from 在分钟中点。
    const from = new Date("2026-06-13T10:02:30.000Z");
    const next = new Date(computeNextRunAt("*/5 * * * *", from));
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(next.getUTCMinutes() % 5).toBe(0);
    expect(next.getTime() - from.getTime()).toBeLessThanOrEqual(5 * 60_000);
  });

  it("advances from `from`, not from epoch history (catch-up semantics)", () => {
    const from = new Date("2026-06-13T10:00:00.000Z");
    const next = new Date(computeNextRunAt("* * * * *", from));
    // 下一分钟，而不是过去某次错过的时间点
    expect(next.getTime()).toBe(new Date("2026-06-13T10:01:00.000Z").getTime());
  });

  it("throws on invalid expressions", () => {
    expect(() => computeNextRunAt("bad", new Date())).toThrow();
  });
});
