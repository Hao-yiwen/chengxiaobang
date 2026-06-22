import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalDecision } from "@chengxiaobang/shared";
import { ApprovalQueue, normalizeDecision } from "../src/agent/approval-queue";

afterEach(() => {
  vi.useRealTimers();
});

describe("ApprovalQueue（泛化决议）", () => {
  it("wait→decide 携带 payload round-trip", async () => {
    const queue = new ApprovalQueue();
    const controller = new AbortController();
    const pending = queue.wait("tool_1", controller.signal);

    const decision: ApprovalDecision = {
      approved: true,
      answer: { answers: [{ optionLabel: "方案 A" }] }
    };
    expect(queue.decide("tool_1", decision)).toBe(true);
    await expect(pending).resolves.toEqual(decision);
  });

  it("earlyDecision 带 payload 不丢", async () => {
    const queue = new ApprovalQueue();
    const controller = new AbortController();
    const decision: ApprovalDecision = {
      approved: true,
      editedSteps: [{ id: "s1", title: "第一步", status: "pending" }]
    };
    // decide 先于 wait 到达。
    expect(queue.decide("tool_2", decision)).toBe(true);
    await expect(queue.wait("tool_2", controller.signal)).resolves.toEqual(decision);
  });

  it("abort 时 resolve {approved:false}", async () => {
    const queue = new ApprovalQueue();
    const controller = new AbortController();
    const pending = queue.wait("tool_3", controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual({ approved: false });
  });

  it("信号已中止时 wait 立即 resolve {approved:false}（pending 事件与 wait 注册之间的中止竞态）", async () => {
    const queue = new ApprovalQueue();
    const controller = new AbortController();
    controller.abort();
    await expect(queue.wait("tool_pre_aborted", controller.signal)).resolves.toEqual({
      approved: false
    });
  });

  it("decide 后 pending 清空（重复 decide 变为下一次 wait 的早到决议）", async () => {
    const queue = new ApprovalQueue();
    const controller = new AbortController();
    const first = queue.wait("tool_4", controller.signal);
    queue.decide("tool_4", { approved: true });
    await expect(first).resolves.toEqual({ approved: true });

    // pending 已清空：再次 decide 进入 earlyDecisions，被下一次 wait 消费。
    queue.decide("tool_4", { approved: false });
    await expect(queue.wait("tool_4", controller.signal)).resolves.toEqual({
      approved: false
    });
  });

  it("过期早到决议被 TTL 回收，不被后续 wait 消费（防误发/重复 decide 无界堆积）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const queue = new ApprovalQueue();
    // decide 先于 wait 到达，暂存为早到决议。
    expect(queue.decide("tool_ttl", { approved: true })).toBe(true);
    // 超过 TTL（60s）后再 wait：早到决议应已被清理。
    vi.setSystemTime(61_000);
    const controller = new AbortController();
    const pending = queue.wait("tool_ttl", controller.signal);
    controller.abort();
    // 若早到决议未被回收，这里会立即 resolve 成 {approved:true};被回收后走 abort 路径返回拒绝。
    await expect(pending).resolves.toEqual({ approved: false });
  });
});

describe("normalizeDecision（按工具名裁决 payload）", () => {
  it("AskUserQuestion approved 缺 answer 视为拒绝", () => {
    expect(normalizeDecision("AskUserQuestion", { approved: true })).toEqual({ approved: false });
  });

  it("AskUserQuestion approved 带 answer 原样保留", () => {
    expect(
      normalizeDecision("AskUserQuestion", {
        approved: true,
        answer: { answers: [{ optionLabel: "方案 A" }] }
      })
    ).toEqual({ approved: true, answer: { answers: [{ optionLabel: "方案 A" }] } });
  });

  it("AskUserQuestion 拒绝时不要求 answer", () => {
    expect(normalizeDecision("AskUserQuestion", { approved: false })).toEqual({
      approved: false,
      answer: undefined
    });
  });

  it("ExitPlanMode 保留调整意见与 legacy editedSteps", () => {
    const steps = [{ id: "s1", title: "第一步", status: "pending" as const }];
    expect(
      normalizeDecision("ExitPlanMode", {
        approved: false,
        answer: { answers: [{ text: "请先补充测试计划" }] },
        editedSteps: steps
      })
    ).toEqual({
      approved: false,
      answer: { answers: [{ text: "请先补充测试计划" }] },
      editedSteps: steps
    });
    // AskUserQuestion 决议中的 editedSteps 被裁掉。
    const askResult = normalizeDecision("AskUserQuestion", {
      approved: true,
      answer: { answers: [{ optionLabel: "好" }] },
      editedSteps: steps
    });
    expect(askResult.editedSteps).toBeUndefined();
  });

  it("普通工具多余 payload 被剥除", () => {
    expect(
      normalizeDecision("Write", {
        approved: true,
        answer: { answers: [{ text: "无关" }] },
        editedSteps: [{ id: "s1", title: "x", status: "pending" }]
      })
    ).toEqual({ approved: true });
  });
});
