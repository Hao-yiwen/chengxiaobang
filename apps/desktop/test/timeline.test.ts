import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@chengxiaobang/shared";
import {
  chatViewTimelineItems,
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
  plan: `# 重构 store

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
    const tool1 = tool("Skill", { at: "2026-06-11T00:00:03.000Z", args: { skill: "excel" } });

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
    const t1 = tool("Shell", { at });
    const t2 = tool("Read", { at });
    const items = timelineItems([m1, m2], [t1, t2]);
    expect(
      items.map((item) => (item.kind === "message" ? item.message.id : item.toolCall.id))
    ).toEqual([m1.id, m2.id, t1.id, t2.id]);
  });
});

describe("groupTimelineItems", () => {
  it("folds consecutive groupable tools into one tool-group anchored at the first call", () => {
    const t1 = tool("Read", { at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("Grep", { at: "2026-06-11T00:00:02.000Z" });
    const t3 = tool("Shell", { at: "2026-06-11T00:00:03.000Z" });
    const items = groupTimelineItems(timelineItems([], [t1, t2, t3]));
    expect(items).toEqual([
      { kind: "tool-group", at: t1.updatedAt, toolCalls: [t1, t2, t3] }
    ]);
  });

  it("breaks groups on any message", () => {
    const t1 = tool("Read", { at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("Read", { at: "2026-06-11T00:00:02.000Z" });
    const a1 = msg("assistant", "2026-06-11T00:00:03.000Z");
    const t3 = tool("Shell", { at: "2026-06-11T00:00:04.000Z" });
    const t4 = tool("Shell", { at: "2026-06-11T00:00:05.000Z" });
    const items = groupTimelineItems(timelineItems([a1], [t1, t2, t3, t4]));
    expect(items.map((item) => item.kind)).toEqual(["tool-group", "message", "tool-group"]);
  });

  it("keeps specially-rendered tools out of groups and breaks runs on them", () => {
    for (const name of [
      "AskUserQuestion",
      "Skill",
      "ExitPlanMode",
      "ExitPlanMode",
      "TodoWrite",
      "TodoWrite"
    ]) {
      const t1 = tool("Read", { at: "2026-06-11T00:00:01.000Z" });
      const t2 = tool(name, { at: "2026-06-11T00:00:02.000Z", args: planArgs });
      const t3 = tool("Read", { at: "2026-06-11T00:00:03.000Z" });
      const items = groupTimelineItems(timelineItems([], [t1, t2, t3]));
      expect(items.map((item) => item.kind), name).toEqual(["tool", "tool", "tool"]);
    }
  });

  it("groups unknown tools like ordinary tool rows", () => {
    const t1 = tool("Read", { at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("UnknownTool", {
      at: "2026-06-11T00:00:02.000Z",
      status: "running",
      args: { target: "deck.pptx" }
    });
    const t3 = tool("Read", { at: "2026-06-11T00:00:03.000Z" });
    const items = groupTimelineItems(timelineItems([], [t1, t2, t3]));
    expect(items.map((item) => item.kind)).toEqual(["tool-group"]);
  });

  it("groups Write regardless of the target extension", () => {
    const code = tool("Write", {
      at: "2026-06-11T00:00:01.000Z",
      args: { file_path: "src/app.ts", content: "x" }
    });
    const read = tool("Read", { at: "2026-06-11T00:00:02.000Z" });
    expect(groupTimelineItems(timelineItems([], [code, read])).map((item) => item.kind)).toEqual([
      "tool-group"
    ]);

    const doc = tool("Write", {
      at: "2026-06-11T00:00:01.000Z",
      args: { file_path: "notes.md", content: "x" }
    });
    const read2 = tool("Read", { at: "2026-06-11T00:00:02.000Z" });
    expect(groupTimelineItems(timelineItems([], [doc, read2])).map((item) => item.kind)).toEqual([
      "tool-group"
    ]);
  });

  it("degrades a run of one back to a plain tool item", () => {
    const t1 = tool("Shell", { at: "2026-06-11T00:00:01.000Z" });
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
    const t1 = tool("Read", { runId: "run_1", at: "2026-06-11T00:00:01.000Z" });
    const t2 = tool("Shell", { runId: "run_1", at: "2026-06-11T00:00:02.000Z" });
    const t3 = tool("Shell", { runId: "run_2", at: "2026-06-11T00:00:03.000Z" });
    const items = chatTimeline([], [t1, t2, t3]);
    const indices = items.map((item) => (item.kind === "tool" ? item.index : -1));
    expect(indices).toEqual([1, 2, 1]);
  });

  it("keeps only the latest ExitPlanMode as the active plan", () => {
    const anchor = tool("ExitPlanMode", {
      args: planArgs,
      status: "completed",
      at: "2026-06-11T00:00:01.000Z"
    });
    const next = tool("ExitPlanMode", {
      args: { plan: "# 新计划\n\n## Summary\n新版计划。" },
      status: "completed",
      at: "2026-06-11T00:00:02.000Z"
    });
    const items = chatTimeline([], [anchor, next]);
    expect(kinds(items)).toEqual(["plan-history", "plan"]);
  });

  it("filters todo rows out of the chat timeline because the right panel owns progress", () => {
    const read = tool("TodoRead", {
      at: "2026-06-11T00:00:01.000Z"
    });
    const write = tool("TodoWrite", {
      args: { todos: [{ content: "共享契约", status: "completed", priority: "medium" }] },
      at: "2026-06-11T00:00:02.000Z"
    });
    expect(chatTimeline([], [read, write])).toEqual([]);
  });

  it("renders the anchor ExitPlanMode as a plan item with approved status", () => {
    const anchor = tool("ExitPlanMode", { args: planArgs, status: "completed" });
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
      derivePlanView([tool("ExitPlanMode", { args: planArgs, status: "completed" })])?.status
    ).toBe("approved");
    expect(
      derivePlanView([tool("ExitPlanMode", { args: planArgs, status: "rejected" })])?.status
    ).toBe("rejected");
    expect(
      derivePlanView(
        [
          tool("ExitPlanMode", {
            args: planArgs,
            status: "pending_approval",
            runId: "run_live"
          })
        ],
        { activeRunId: "run_live" }
      )?.status
    ).toBe("draft");
    expect(
      derivePlanView([tool("ExitPlanMode", { args: planArgs, status: "pending_approval" })])
        ?.status
    ).toBe("awaiting");
  });

  it("renders superseded ExitPlanMode history as collapsed plan-history rows", () => {
    const rejected = tool("ExitPlanMode", {
      args: {
        plan: "# 旧计划\n\n## Summary\n旧版计划。"
      },
      status: "rejected",
      at: "2026-06-11T00:00:01.000Z"
    });
    const anchor = tool("ExitPlanMode", {
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

  it("keeps active pending ExitPlanMode in the timeline even when it is also the pending tool", () => {
    const pending = tool("ExitPlanMode", {
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

  it("renders rejected ExitPlanMode history by Markdown title", () => {
    const rejected = tool("ExitPlanMode", {
      args: {
        plan: "# 旧计划\n\n## Summary\n第一步。"
      },
      status: "rejected",
      at: "2026-06-11T00:00:01.000Z"
    });
    const anchor = tool("ExitPlanMode", {
      args: planArgs,
      status: "completed",
      at: "2026-06-11T00:00:02.000Z"
    });
    const items = chatTimeline([], [rejected, anchor]);
    const history = items[0];
    expect(history?.kind === "plan-history" && history.title).toBe("旧计划");
  });

  it("skips the active pendingTool row except for ExitPlanMode", () => {
    const pending = tool("Write", { status: "pending_approval", id: "t_pending" });
    const items = chatTimeline([], [pending], { pendingToolId: "t_pending" });
    expect(items).toEqual([]);
  });

  it("flags residual pending_approval rows from non-active runs", () => {
    const stale = tool("Shell", {
      status: "pending_approval",
      runId: "run_old",
      at: "2026-06-11T00:00:01.000Z"
    });
    const fresh = tool("Shell", {
      status: "pending_approval",
      runId: "run_live",
      at: "2026-06-11T00:00:02.000Z"
    });
    const items = chatTimeline([], [stale, fresh], { activeRunId: "run_live" });
    const flags = items.map((item) => (item.kind === "tool" ? item.residualPending : undefined));
    expect(flags).toEqual([true, false]);
  });

  it("keeps active running tools from the active run timeline", () => {
    const calls = [
      tool("WebSearch", {
        id: "search",
        runId: "run_live",
        status: "running",
        args: { query: "发布信息" }
      }),
      tool("Shell", {
        id: "bash",
        runId: "run_live",
        status: "pending_smart_approval",
        args: { command: "pnpm test" }
      }),
      tool("Read", {
        id: "read",
        runId: "run_live",
        status: "running",
        args: { file_path: "src/app.ts" }
      }),
      tool("Skill", {
        id: "skill",
        runId: "run_live",
        status: "running",
        args: { skill: "excel" }
      }),
      tool("WebFetch", {
        id: "fetch",
        runId: "run_live",
        status: "running",
        args: { url: "https://example.com" }
      })
    ];

    const items = chatTimeline([], calls, { activeRunId: "run_live" });

    expect(items.map((item) => (item.kind === "tool" ? item.toolCall.name : item.kind))).toEqual([
      "WebSearch",
      "Shell",
      "Read",
      "Skill",
      "WebFetch"
    ]);
  });

  it("does not hide residual active-looking tools from older runs", () => {
    const stale = tool("WebSearch", {
      runId: "run_old",
      status: "running",
      args: { query: "旧查询" }
    });

    const items = chatTimeline([], [stale], { activeRunId: "run_live" });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind === "tool" && items[0].toolCall.id).toBe(stale.id);
  });

  it("keeps completed tool history visible for parameterized tools", () => {
    const fetch = tool("WebFetch", {
      runId: "run_live",
      status: "completed",
      args: { url: "https://example.com" }
    });
    const search = tool("WebSearch", {
      runId: "run_live",
      status: "completed",
      args: { query: "发布信息" },
      at: "2026-06-11T00:00:06.000Z"
    });
    const bash = tool("Shell", {
      runId: "run_live",
      status: "completed",
      args: { command: "pnpm test" },
      at: "2026-06-11T00:00:07.000Z"
    });

    const items = chatTimeline([], [fetch, search, bash], { activeRunId: "run_live" });

    expect(items.map((item) => (item.kind === "tool" ? item.toolCall.name : item.kind))).toEqual([
      "WebFetch",
      "WebSearch",
      "Shell"
    ]);
  });

  it("keeps active tools before ChatView grouping", () => {
    const completedFetches = [1, 2, 3, 4].map((index) =>
      tool("WebFetch", {
        id: `fetch_${index}`,
        runId: "run_live",
        status: "completed",
        args: { url: `https://example-${index}.com` },
        at: `2026-06-11T00:00:0${index}.000Z`
      })
    );
    const runningSearch = tool("WebSearch", {
      id: "search_running",
      runId: "run_live",
      status: "running",
      args: { query: "继续搜索" },
      at: "2026-06-11T00:00:05.000Z"
    });

    const items = chatViewTimelineItems([], [...completedFetches, runningSearch], [], "run_live");

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("tool-group");
    expect(
      items[0]?.kind === "tool-group" ? items[0].toolCalls.map((call) => call.id) : []
    ).toEqual(["fetch_1", "fetch_2", "fetch_3", "fetch_4", "search_running"]);
  });
});
