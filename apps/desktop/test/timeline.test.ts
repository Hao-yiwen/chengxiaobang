import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@chengxiaobang/shared";
import {
  ASIDE_INLINE_LIMIT,
  chatTimeline,
  derivePlanView,
  groupTimelineItems,
  planCurrentStep,
  timelineItems,
  type ChatTimelineItem
} from "../src/renderer/lib/timeline";

let counter = 0;

function msg(role: Message["role"], createdAt: string, content = "…"): Message {
  counter += 1;
  return { id: `m${counter}`, sessionId: "s1", role, content, createdAt };
}

function tool(
  name: ToolCall["name"],
  overrides: Partial<ToolCall> & { at?: string } = {}
): ToolCall {
  counter += 1;
  const at = overrides.at ?? "2026-06-11T00:00:05.000Z";
  return {
    id: overrides.id ?? `t${counter}`,
    runId: overrides.runId ?? "run_1",
    name,
    args: overrides.args ?? {},
    status: overrides.status ?? "completed",
    result: overrides.result,
    createdAt: overrides.createdAt ?? at,
    updatedAt: overrides.updatedAt ?? at
  };
}

const planArgs = {
  title: "重构 store",
  steps: [
    { id: "s1", title: "梳理依赖", status: "completed" },
    { id: "s2", title: "拆分切片", status: "in_progress" },
    { id: "s3", title: "迁移订阅", status: "pending" }
  ]
};

function kinds(items: ChatTimelineItem[]): string[] {
  return items.map((item) => item.kind);
}

describe("timelineItems", () => {
  it("keeps reasoning-only assistant turns but drops truly empty ones", () => {
    const reasoningOnly: Message = {
      ...msg("assistant", "2026-06-11T00:00:01.000Z", ""),
      reasoning: "先想清楚",
      reasoningMs: 12000
    };
    const empty = msg("assistant", "2026-06-11T00:00:02.000Z", "  ");
    const tool1 = tool("use_skill", { at: "2026-06-11T00:00:03.000Z", args: { name: "excel" } });

    const items = timelineItems([reasoningOnly, empty], [tool1]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "message", message: { id: reasoningOnly.id } });
    // 思考先于工具发生，时间线保持这个顺序。
    expect(items[1]).toMatchObject({ kind: "tool" });
  });

  it("breaks createdAt ties deterministically: messages before tools, each in source order", () => {
    const at = "2026-06-11T00:00:00.000Z";
    const m1 = msg("user", at);
    const m2 = msg("assistant", at);
    const t1 = tool("shell", { at });
    const t2 = tool("read_file", { at });
    const items = timelineItems([m1, m2], [t1, t2]);
    expect(
      items.map((item) => (item.kind === "message" ? item.message.id : item.toolCall.id))
    ).toEqual([m1.id, m2.id, t1.id, t2.id]);
  });
});

describe("groupTimelineItems", () => {
  it("folds consecutive groupable tools into one tool-group anchored at the first call", () => {
    const t1 = tool("read_file", { at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("search", { at: "2026-06-11T00:00:02.000Z" });
    const t3 = tool("shell", { at: "2026-06-11T00:00:03.000Z" });
    const items = groupTimelineItems(timelineItems([], [t1, t2, t3]));
    expect(items).toEqual([
      { kind: "tool-group", at: t1.updatedAt, toolCalls: [t1, t2, t3] }
    ]);
  });

  it("breaks groups on any message", () => {
    const t1 = tool("read_file", { at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("read_file", { at: "2026-06-11T00:00:02.000Z" });
    const a1 = msg("assistant", "2026-06-11T00:00:03.000Z");
    const t3 = tool("shell", { at: "2026-06-11T00:00:04.000Z" });
    const t4 = tool("shell", { at: "2026-06-11T00:00:05.000Z" });
    const items = groupTimelineItems(timelineItems([a1], [t1, t2, t3, t4]));
    expect(items.map((item) => item.kind)).toEqual(["tool-group", "message", "tool-group"]);
  });

  it("keeps specially-rendered tools out of groups and breaks runs on them", () => {
    for (const name of ["ask_user", "use_skill", "propose_plan", "update_plan", "btw"]) {
      const t1 = tool("read_file", { at: "2026-06-11T00:00:01.000Z" });
      const t2 = tool(name, { at: "2026-06-11T00:00:02.000Z", args: planArgs });
      const t3 = tool("read_file", { at: "2026-06-11T00:00:03.000Z" });
      const items = groupTimelineItems(timelineItems([], [t1, t2, t3]));
      expect(items.map((item) => item.kind), name).toEqual(["tool", "tool", "tool"]);
    }
  });

  it("keeps deliverable tools standalone regardless of status", () => {
    const t1 = tool("read_file", { at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("create_pptx", {
      at: "2026-06-11T00:00:02.000Z",
      status: "running",
      args: { path: "deck.pptx" }
    });
    const t3 = tool("read_file", { at: "2026-06-11T00:00:03.000Z" });
    const items = groupTimelineItems(timelineItems([], [t1, t2, t3]));
    expect(items.map((item) => item.kind)).toEqual(["tool", "tool", "tool"]);
  });

  it("groups write_file for code paths but not for deliverable paths", () => {
    const code = tool("write_file", {
      at: "2026-06-11T00:00:01.000Z",
      args: { path: "src/app.ts", content: "x" }
    });
    const read = tool("read_file", { at: "2026-06-11T00:00:02.000Z" });
    expect(groupTimelineItems(timelineItems([], [code, read])).map((item) => item.kind)).toEqual([
      "tool-group"
    ]);

    const doc = tool("write_file", {
      at: "2026-06-11T00:00:01.000Z",
      args: { path: "notes.md", content: "x" }
    });
    const read2 = tool("read_file", { at: "2026-06-11T00:00:02.000Z" });
    expect(groupTimelineItems(timelineItems([], [doc, read2])).map((item) => item.kind)).toEqual([
      "tool",
      "tool"
    ]);
  });

  it("degrades a run of one back to a plain tool item", () => {
    const t1 = tool("shell", { at: "2026-06-11T00:00:01.000Z" });
    const items = groupTimelineItems(timelineItems([], [t1]));
    expect(items).toEqual([{ kind: "tool", at: t1.updatedAt, toolCall: t1 }]);
  });
});

describe("chatTimeline", () => {
  it("inserts a run separator before each user message except the first item", () => {
    const u1 = msg("user", "2026-06-11T00:00:00.000Z");
    const a1 = msg("assistant", "2026-06-11T00:00:01.000Z");
    const u2 = msg("user", "2026-06-11T00:00:02.000Z");
    const items = chatTimeline([u1, a1, u2], []);
    expect(kinds(items)).toEqual(["message", "message", "separator", "message"]);
  });

  it("marks turnStart only on the first assistant message of a turn", () => {
    const u1 = msg("user", "2026-06-11T00:00:00.000Z");
    const a1 = msg("assistant", "2026-06-11T00:00:01.000Z");
    const a2 = msg("assistant", "2026-06-11T00:00:02.000Z");
    const items = chatTimeline([u1, a1, a2], []);
    const flags = items
      .filter((item) => item.kind === "message")
      .map((item) => (item.kind === "message" ? item.turnStart : false));
    expect(flags).toEqual([false, true, false]);
  });

  it("numbers tool rows 1-based per run and keeps runs independent", () => {
    const t1 = tool("read_file", { runId: "run_1", at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("shell", { runId: "run_1", at: "2026-06-11T00:00:02.000Z" });
    const t3 = tool("shell", { runId: "run_2", at: "2026-06-11T00:00:03.000Z" });
    const items = chatTimeline([], [t1, t2, t3]);
    const indices = items.map((item) => (item.kind === "tool" ? item.index : -1));
    expect(indices).toEqual([1, 2, 1]);
  });

  it("filters update_plan rows out of the timeline (they fold into the plan card)", () => {
    const anchor = tool("propose_plan", {
      args: planArgs,
      status: "completed",
      at: "2026-06-11T00:00:01.000Z"
    });
    const upd = tool("update_plan", {
      args: { stepId: "s1", status: "completed" },
      at: "2026-06-11T00:00:02.000Z"
    });
    const items = chatTimeline([], [anchor, upd]);
    expect(kinds(items)).toEqual(["plan"]);
  });

  it("renders the anchor propose_plan as a plan item with executing status", () => {
    const anchor = tool("propose_plan", { args: planArgs, status: "completed" });
    const items = chatTimeline([], [anchor]);
    const plan = items[0];
    if (plan?.kind !== "plan") {
      throw new Error("expected plan item");
    }
    expect(plan.plan.status).toBe("executing");
    expect(plan.plan.state.title).toBe("重构 store");
    expect(plan.plan.anchor.id).toBe(anchor.id);
  });

  it("derives completed / rejected / awaiting plan statuses", () => {
    const finished = {
      ...planArgs,
      steps: planArgs.steps.map((step) => ({ ...step, status: "completed" }))
    };
    expect(derivePlanView([tool("propose_plan", { args: finished, status: "completed" })])?.status).toBe(
      "completed"
    );
    expect(derivePlanView([tool("propose_plan", { args: planArgs, status: "rejected" })])?.status).toBe(
      "rejected"
    );
    // 残留 pending（运行已结束）→ awaiting，不可交互（ARCH 评委修正 6）。
    expect(
      derivePlanView([tool("propose_plan", { args: planArgs, status: "pending_approval" })])?.status
    ).toBe("awaiting");
  });

  it("renders superseded propose_plan history as collapsed plan-history rows", () => {
    const rejected = tool("propose_plan", {
      args: { ...planArgs, title: "旧计划" },
      status: "rejected",
      at: "2026-06-11T00:00:01.000Z"
    });
    const anchor = tool("propose_plan", {
      args: planArgs,
      status: "completed",
      at: "2026-06-11T00:00:02.000Z"
    });
    const items = chatTimeline([], [rejected, anchor]);
    expect(kinds(items)).toEqual(["plan-history", "plan"]);
    const history = items[0];
    if (history?.kind !== "plan-history") {
      throw new Error("expected plan-history item");
    }
    expect(history.title).toBe("旧计划");
  });

  it("aggregates btw asides from the third note of a run onward", () => {
    const at = (n: number) => `2026-06-11T00:00:0${n}.000Z`;
    const notes = [1, 2, 3, 4].map((n) =>
      tool("btw", { args: { note: `旁注${n}` }, at: at(n), runId: "run_1" })
    );
    const items = chatTimeline([], notes);
    expect(kinds(items)).toEqual(["aside", "aside", "aside-group"]);
    const group = items[2];
    if (group?.kind !== "aside-group") {
      throw new Error("expected aside-group item");
    }
    expect(group.toolCalls.map((tc) => tc.args.note)).toEqual(["旁注3", "旁注4"]);
    expect(ASIDE_INLINE_LIMIT).toBe(2);
  });

  it("does not aggregate btw asides across different runs", () => {
    const at = (n: number) => `2026-06-11T00:00:0${n}.000Z`;
    const notes = [
      tool("btw", { args: { note: "a" }, runId: "run_1", at: at(1) }),
      tool("btw", { args: { note: "b" }, runId: "run_1", at: at(2) }),
      tool("btw", { args: { note: "c" }, runId: "run_2", at: at(3) })
    ];
    expect(kinds(chatTimeline([], notes))).toEqual(["aside", "aside", "aside"]);
  });

  it("flags residual pending_approval rows from non-active runs", () => {
    const stale = tool("shell", {
      status: "pending_approval",
      runId: "run_old",
      at: "2026-06-11T00:00:01.000Z"
    });
    const fresh = tool("shell", {
      status: "pending_approval",
      runId: "run_live",
      at: "2026-06-11T00:00:02.000Z"
    });
    const items = chatTimeline([], [stale, fresh], { activeRunId: "run_live" });
    const flags = items.map((item) => (item.kind === "tool" ? item.residualPending : undefined));
    expect(flags).toEqual([true, false]);
  });

  it("skips the active pendingTool row (rendered separately by ChatView)", () => {
    const pending = tool("write_file", { status: "pending_approval", id: "t_pending" });
    const items = chatTimeline([], [pending], { pendingToolId: "t_pending" });
    expect(items).toEqual([]);
  });
});

describe("planCurrentStep", () => {
  it("prefers the in_progress step, 1-based", () => {
    const view = derivePlanView([tool("propose_plan", { args: planArgs, status: "completed" })]);
    expect(planCurrentStep(view!.state)).toEqual({ index: 2, total: 3, title: "拆分切片" });
  });

  it("falls back to the first pending step, then the last step", () => {
    const pendingOnly = {
      ...planArgs,
      steps: [
        { id: "s1", title: "甲", status: "completed" },
        { id: "s2", title: "乙", status: "pending" }
      ]
    };
    const v1 = derivePlanView([tool("propose_plan", { args: pendingOnly, status: "completed" })]);
    expect(planCurrentStep(v1!.state)).toEqual({ index: 2, total: 2, title: "乙" });

    const allDone = {
      ...planArgs,
      steps: [
        { id: "s1", title: "甲", status: "completed" },
        { id: "s2", title: "乙", status: "skipped" }
      ]
    };
    const v2 = derivePlanView([tool("propose_plan", { args: allDone, status: "completed" })]);
    expect(planCurrentStep(v2!.state)).toEqual({ index: 2, total: 2, title: "乙" });
  });
});
