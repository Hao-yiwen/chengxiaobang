import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@chengxiaobang/shared";
import {
  ASIDE_INLINE_LIMIT,
  chatTimeline,
  derivePlanView,
  groupTimelineItems,
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
  markdown: `# 重构 store

## Summary
整理 store 的状态边界。

## Key Changes
- 梳理依赖。
- 拆分切片。

## Test Plan
- 运行相关前端测试。

## Assumptions
- 不改后端接口。`
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

  it("keeps user messages that only contain visible attachments", () => {
    const attachmentOnly: Message = {
      ...msg("user", "2026-06-11T00:00:01.000Z", ""),
      attachments: [
        {
          id: "attachment_1",
          name: "photo.png",
          kind: "image",
          mimeType: "image/png",
          size: 100,
          path: "/tmp/cxb/photo.png"
        }
      ]
    };

    const items = timelineItems([attachmentOnly], []);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "message", message: { id: attachmentOnly.id } });
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
    for (const name of [
      "ask_user",
      "use_skill",
      "propose_plan",
      "update_plan",
      "todo_create",
      "todo_update",
      "btw"
    ]) {
      const t1 = tool("read_file", { at: "2026-06-11T00:00:01.000Z" });
      const t2 = tool(name, { at: "2026-06-11T00:00:02.000Z", args: planArgs });
      const t3 = tool("read_file", { at: "2026-06-11T00:00:03.000Z" });
      const items = groupTimelineItems(timelineItems([], [t1, t2, t3]));
      expect(items.map((item) => item.kind), name).toEqual(["tool", "tool", "tool"]);
    }
  });

  it("groups legacy create_* tools like ordinary tool rows", () => {
    const t1 = tool("read_file", { at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("create_pptx", {
      at: "2026-06-11T00:00:02.000Z",
      status: "running",
      args: { path: "deck.pptx" }
    });
    const t3 = tool("read_file", { at: "2026-06-11T00:00:03.000Z" });
    const items = groupTimelineItems(timelineItems([], [t1, t2, t3]));
    expect(items.map((item) => item.kind)).toEqual(["tool-group"]);
  });

  it("groups write_file regardless of the target extension", () => {
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
      "tool-group"
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

  it("filters update_plan rows out of the timeline because plan progress is legacy-only", () => {
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

  it("filters todo rows out of the chat timeline because the right panel owns progress", () => {
    const create = tool("todo_create", {
      args: { title: "实现进度面板", items: [{ id: "s1", title: "共享契约" }] },
      at: "2026-06-11T00:00:01.000Z"
    });
    const update = tool("todo_update", {
      args: { itemId: "s1", status: "completed" },
      at: "2026-06-11T00:00:02.000Z"
    });
    expect(chatTimeline([], [create, update])).toEqual([]);
  });

  it("renders the anchor propose_plan as a plan item with approved status", () => {
    const anchor = tool("propose_plan", { args: planArgs, status: "completed" });
    const items = chatTimeline([], [anchor]);
    const plan = items[0];
    if (plan?.kind !== "plan") {
      throw new Error("expected plan item");
    }
    expect(plan.plan.status).toBe("approved");
    expect(plan.plan.state.title).toBe("重构 store");
    expect(plan.plan.state.markdown).toContain("## Summary");
    expect(plan.plan.anchor.id).toBe(anchor.id);
  });

  it("derives approved / rejected / draft / awaiting plan statuses", () => {
    expect(
      derivePlanView([tool("propose_plan", { args: planArgs, status: "completed" })])?.status
    ).toBe("approved");
    expect(
      derivePlanView([tool("propose_plan", { args: planArgs, status: "rejected" })])?.status
    ).toBe("rejected");
    expect(
      derivePlanView(
        [
          tool("propose_plan", {
            args: planArgs,
            status: "pending_approval",
            runId: "run_live"
          })
        ],
        { activeRunId: "run_live" }
      )?.status
    ).toBe("draft");
    expect(
      derivePlanView([tool("propose_plan", { args: planArgs, status: "pending_approval" })])
        ?.status
    ).toBe("awaiting");
  });

  it("renders superseded propose_plan history as collapsed plan-history rows", () => {
    const rejected = tool("propose_plan", {
      args: {
        markdown: "# 旧计划\n\n## Summary\n旧版计划。"
      },
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

  it("keeps active pending propose_plan in the timeline even when it is also the pending tool", () => {
    const pending = tool("propose_plan", {
      args: planArgs,
      status: "pending_approval",
      id: "t_pending",
      runId: "run_live"
    });
    const items = chatTimeline([], [pending], {
      pendingToolId: "t_pending",
      activeRunId: "run_live"
    });
    expect(kinds(items)).toEqual(["plan"]);
    const plan = items[0];
    expect(plan?.kind === "plan" && plan.plan.status).toBe("draft");
  });

  it("converts legacy step plans to Markdown titles in history", () => {
    const legacy = tool("propose_plan", {
      args: {
        title: "旧计划",
        steps: [{ id: "s1", title: "第一步" }]
      },
      status: "rejected",
      at: "2026-06-11T00:00:01.000Z"
    });
    const anchor = tool("propose_plan", {
      args: planArgs,
      status: "completed",
      at: "2026-06-11T00:00:02.000Z"
    });
    const items = chatTimeline([], [legacy, anchor]);
    const history = items[0];
    expect(history?.kind === "plan-history" && history.title).toBe("旧计划");
  });

  it("skips the active pendingTool row except for propose_plan", () => {
    const pending = tool("write_file", { status: "pending_approval", id: "t_pending" });
    const items = chatTimeline([], [pending], { pendingToolId: "t_pending" });
    expect(items).toEqual([]);
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

});
