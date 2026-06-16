import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "@chengxiaobang/shared";
import {
  chatViewTimelineItems,
  groupTurns,
  type FailedRunNotice,
  type GroupTurnsContext,
  type StandaloneBlock,
  type TurnBlock
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
    startedAt: overrides.startedAt,
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

## Test Plan
- 运行相关前端测试。

## Assumptions
- 不改后端接口。`
};

function ctx(overrides: Partial<GroupTurnsContext> = {}): GroupTurnsContext {
  return {
    isRunning: false,
    activeRunAssistantIds: new Set<string>(),
    nowMs: Date.parse("2026-06-11T00:01:00.000Z"),
    ...overrides
  };
}

function turns(blocks: ReturnType<typeof groupTurns>): TurnBlock[] {
  return blocks.filter((block): block is TurnBlock => block.kind === "turn");
}

describe("groupTurns", () => {
  it("单 user + 单句答复：无中间过程，settled 计时", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "你好");
    const a = msg("assistant", "2026-06-11T00:00:03.000Z", "你好，有什么可以帮你？");
    const blocks = groupTurns(chatViewTimelineItems([u, a], [], []), ctx());

    expect(blocks).toHaveLength(1);
    const turn = blocks[0] as TurnBlock;
    expect(turn.kind).toBe("turn");
    expect(turn.user?.item.message.id).toBe(u.id);
    expect(turn.answer?.item.message.id).toBe(a.id);
    expect(turn.intermediate).toHaveLength(0);
    expect(turn.active).toBe(false);
    expect(turn.timing).toEqual({ mode: "settled", durationMs: 3000 });
  });

  it("reasoning-only + 工具 + 答复：中间过程进折叠体，耗时=答复−user", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "建个页面");
    const reasoning: Message = {
      ...msg("assistant", "2026-06-11T00:00:01.000Z", ""),
      reasoning: "先想想",
      reasoningMs: 1000
    };
    const t = tool("Write", { at: "2026-06-11T00:00:02.000Z" });
    const a = msg("assistant", "2026-06-11T00:00:05.000Z", "已生成");
    const blocks = groupTurns(chatViewTimelineItems([u, reasoning, a], [t], []), ctx());

    const turn = blocks[0] as TurnBlock;
    expect(turn.answer?.item.message.id).toBe(a.id);
    expect(turn.intermediate.map((m) => m.item.kind)).toEqual(["message", "tool"]);
    expect(turn.timing).toEqual({ mode: "settled", durationMs: 5000 });
  });

  it("多 assistant 交替：仅最后一条有内容进 answer，叙述进 intermediate", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "建页面");
    const narration = msg("assistant", "2026-06-11T00:00:01.000Z", "我来创建");
    const t = tool("Write", { at: "2026-06-11T00:00:02.000Z" });
    const answer = msg("assistant", "2026-06-11T00:00:05.000Z", "已完成");
    const blocks = groupTurns(chatViewTimelineItems([u, narration, answer], [t], []), ctx());

    const turn = blocks[0] as TurnBlock;
    expect(turn.answer?.item.message.id).toBe(answer.id);
    expect(
      turn.intermediate.some(
        (m) => m.item.kind === "message" && m.item.message.id === narration.id
      )
    ).toBe(true);
    expect(turn.intermediate.map((m) => m.item.kind)).toEqual(["message", "tool"]);
  });

  it("开头非 user：孤立轮，user 缺省，timing unknown", () => {
    const a = msg("assistant", "2026-06-11T00:00:01.000Z", "孤立回答");
    const blocks = groupTurns(chatViewTimelineItems([a], [], []), ctx());

    const turn = blocks[0] as TurnBlock;
    expect(turn.user).toBeUndefined();
    expect(turn.answer?.item.message.id).toBe(a.id);
    expect(turn.timing).toEqual({ mode: "unknown" });
    expect(turn.key).toBe(`turn-orphan-${a.id}`);
  });

  it("compaction 摘要切断轮次并独立成块", () => {
    const u1 = msg("user", "2026-06-11T00:00:00.000Z", "q1");
    const a1 = msg("assistant", "2026-06-11T00:00:01.000Z", "a1");
    const compaction: Message = {
      ...msg("assistant", "2026-06-11T00:00:02.000Z", "summary"),
      kind: "compaction_summary"
    };
    const u2 = msg("user", "2026-06-11T00:00:03.000Z", "q2");
    const a2 = msg("assistant", "2026-06-11T00:00:04.000Z", "a2");
    const blocks = groupTurns(
      chatViewTimelineItems([u1, a1, compaction, u2, a2], [], []),
      ctx()
    );

    expect(blocks.map((b) => b.kind)).toEqual(["turn", "standalone", "turn"]);
    expect((blocks[1] as StandaloneBlock).item.kind).toBe("message");
    expect((blocks[0] as TurnBlock).answer?.item.message.id).toBe(a1.id);
    expect((blocks[2] as TurnBlock).answer?.item.message.id).toBe(a2.id);
  });

  it("system 消息独立成块", () => {
    const sys = msg("system", "2026-06-11T00:00:00.000Z", "系统提示");
    const blocks = groupTurns(chatViewTimelineItems([sys], [], []), ctx());

    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("standalone");
  });

  it("失败轮：红色错误提示独立显示，耗时用失败时间兜底", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "q");
    const t = tool("Bash", { at: "2026-06-11T00:00:02.000Z", status: "failed" });
    const notices: FailedRunNotice[] = [
      { id: "run_1", message: "boom", at: "2026-06-11T00:00:03.000Z", persisted: true }
    ];
    const blocks = groupTurns(chatViewTimelineItems([u], [t], notices), ctx());

    expect(blocks.map((block) => block.kind)).toEqual(["turn", "standalone"]);
    const turn = blocks[0] as TurnBlock;
    expect(turn.answer).toBeUndefined();
    expect(turn.intermediate.some((m) => m.item.kind === "run-error")).toBe(false);
    expect((blocks[1] as StandaloneBlock).item.kind).toBe("run-error");
    expect(turn.timing.mode).toBe("settled");
    if (turn.timing.mode === "settled") {
      expect(turn.timing.durationMs).toBe(3000);
    }
  });

  it("中止轮：保留部分答复，非活跃，settled", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "q");
    const t = tool("Bash", { at: "2026-06-11T00:00:01.000Z" });
    const partial = msg("assistant", "2026-06-11T00:00:02.000Z", "部分回答");
    const blocks = groupTurns(chatViewTimelineItems([u, partial], [t], []), ctx());

    const turn = blocks[0] as TurnBlock;
    expect(turn.answer?.item.message.id).toBe(partial.id);
    expect(turn.active).toBe(false);
    expect(turn.timing).toEqual({ mode: "settled", durationMs: 2000 });
  });

  it("活跃轮：全部成员进折叠体，answer 留空，running 计时取 activeRunStartedAt", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "建页面");
    const narration = msg("assistant", "2026-06-11T00:00:01.000Z", "我来创建");
    const t = tool("Write", { at: "2026-06-11T00:00:02.000Z", status: "running" });
    const startedAt = Date.parse("2026-06-11T00:00:00.000Z");
    const blocks = groupTurns(
      chatViewTimelineItems([u, narration], [t], [], "run_1"),
      ctx({
        isRunning: true,
        activeRunId: "run_1",
        activeRunAssistantIds: new Set([narration.id]),
        activeRunStartedAt: startedAt
      })
    );

    const turn = blocks[0] as TurnBlock;
    expect(turn.active).toBe(true);
    expect(turn.answer).toBeUndefined();
    expect(
      turn.intermediate.some(
        (m) => m.item.kind === "message" && m.item.message.id === narration.id
      )
    ).toBe(true);
    expect(turn.timing).toEqual({ mode: "running", startedAt });
  });

  it("活跃轮但 AI 还没落消息：末轮判定为活跃，可承载临时块", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "q");
    const startedAt = Date.parse("2026-06-11T00:00:00.000Z");
    const blocks = groupTurns(
      chatViewTimelineItems([u], [], [], "run_1"),
      ctx({
        isRunning: true,
        activeRunId: "run_1",
        activeRunAssistantIds: new Set(),
        activeRunStartedAt: startedAt
      })
    );

    const turn = blocks[0] as TurnBlock;
    expect(turn.active).toBe(true);
    expect(turn.intermediate).toHaveLength(0);
    expect(turn.timing).toEqual({ mode: "running", startedAt });
  });

  it("活跃轮缺 activeRunStartedAt 时回退到 user.createdAt", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "q");
    const blocks = groupTurns(
      chatViewTimelineItems([u], [], [], "run_1"),
      ctx({
        isRunning: true,
        activeRunId: "run_1",
        activeRunAssistantIds: new Set(),
        activeRunStartedAt: undefined
      })
    );

    const turn = blocks[0] as TurnBlock;
    expect(turn.timing).toEqual({
      mode: "running",
      startedAt: Date.parse("2026-06-11T00:00:00.000Z")
    });
  });

  it("连发两条 user：切成两轮，前一轮无答复", () => {
    const u1 = msg("user", "2026-06-11T00:00:00.000Z", "q1");
    const u2 = msg("user", "2026-06-11T00:00:01.000Z", "q2");
    const a = msg("assistant", "2026-06-11T00:00:02.000Z", "a");
    const blocks = groupTurns(chatViewTimelineItems([u1, u2, a], [], []), ctx());

    expect(blocks.map((b) => b.kind)).toEqual(["turn", "turn"]);
    const [first, second] = turns(blocks);
    expect(first.answer).toBeUndefined();
    expect(first.intermediate).toHaveLength(0);
    expect(first.timing).toEqual({ mode: "unknown" });
    expect(second.answer?.item.message.id).toBe(a.id);
    expect(second.timing).toEqual({ mode: "settled", durationMs: 1000 });
  });

  it("轮次 key 在成员增减时保持稳定", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "q");
    const a1 = msg("assistant", "2026-06-11T00:00:01.000Z", "a1");
    const blocks1 = groupTurns(chatViewTimelineItems([u, a1], [], []), ctx());
    const t2 = tool("Read", { at: "2026-06-11T00:00:02.000Z" });
    const blocks2 = groupTurns(chatViewTimelineItems([u, a1], [t2], []), ctx());

    expect((blocks1[0] as TurnBlock).key).toBe(`turn-${u.id}`);
    expect((blocks1[0] as TurnBlock).key).toBe((blocks2[0] as TurnBlock).key);
  });

  it("计划卡归入所在轮的折叠体", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "做计划");
    const planTool = tool("ExitPlanMode", {
      at: "2026-06-11T00:00:01.000Z",
      args: planArgs,
      status: "completed"
    });
    const a = msg("assistant", "2026-06-11T00:00:03.000Z", "计划完成");
    const blocks = groupTurns(chatViewTimelineItems([u, a], [planTool], []), ctx());

    const turn = blocks[0] as TurnBlock;
    expect(turn.intermediate.some((m) => m.item.kind === "plan")).toBe(true);
    expect(turn.answer?.item.message.id).toBe(a.id);
  });

  it("transfers the global index onto每个 intermediate 成员", () => {
    const u = msg("user", "2026-06-11T00:00:00.000Z", "q");
    const t = tool("Read", { at: "2026-06-11T00:00:01.000Z" });
    const a = msg("assistant", "2026-06-11T00:00:02.000Z", "done");
    const items = chatViewTimelineItems([u, a], [t], []);
    const blocks = groupTurns(items, ctx());

    const turn = blocks[0] as TurnBlock;
    // 折叠体里的 tool 应当指回它在扁平 items 中的真实下标。
    const toolMember = turn.intermediate.find((m) => m.item.kind === "tool");
    expect(toolMember).toBeDefined();
    expect(items[toolMember!.index]).toBe(toolMember!.item);
  });
});
