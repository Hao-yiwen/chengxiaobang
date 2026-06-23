import { describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@chengxiaobang/shared";
import { RunEventTranslator } from "../src/agent/pi-events";
import { TODO_IDLE_REMINDER } from "../src/agent/system-reminders";
import type { AsyncEventQueue } from "../src/agent/async-queue";
import type { ApprovalQueue } from "../src/agent/approval-queue";
import type { ProjectApprovalTrustService } from "../src/agent/project-approval-trust";
import type { StateStore } from "../src/repository/state-store";

/** 最小依赖构造 translator：只读工具走 running 路径，不触发审批/落库逻辑。 */
function makeTranslator(maxToolIterations = 10): RunEventTranslator {
  const store = {
    insertToolCall: async () => {},
    updateToolCall: async (toolCall: unknown) => toolCall
  } as unknown as StateStore;
  const queue = { push: () => {} } as unknown as AsyncEventQueue<StreamEvent>;
  const approvals = {} as unknown as ApprovalQueue;
  const trust = { isTrusted: async () => false } as unknown as ProjectApprovalTrustService;
  return new RunEventTranslator({
    store,
    queue,
    approvals,
    runId: "run_test",
    sessionId: "sess_test",
    projectId: null,
    workspacePath: "/w",
    accessMode: "full_access",
    projectApprovalTrustService: trust,
    signal: new AbortController().signal,
    model: "test-model",
    maxToolIterations
  });
}

async function startTool(
  translator: RunEventTranslator,
  toolCallId: string,
  toolName: string,
  args: unknown
): Promise<void> {
  await translator.emit({ type: "tool_execution_start", toolCallId, toolName, args } as never);
}

async function endTurn(translator: RunEventTranslator): Promise<void> {
  await translator.emit({ type: "turn_end" } as never);
}

describe("RunEventTranslator 动态软提醒", () => {
  it("连续相同参数调用同一工具触发重复提醒", async () => {
    const translator = makeTranslator();
    for (let i = 0; i < 3; i++) {
      await startTool(translator, `tc${i}`, "Read", { file_path: "/w/a.ts" });
    }
    const reminders = translator.collectReminders();
    expect(reminders.some((r) => r.includes("连续调用了") && r.includes("Read"))).toBe(true);
  });

  it("不同参数不触发重复提醒", async () => {
    const translator = makeTranslator();
    for (let i = 0; i < 3; i++) {
      await startTool(translator, `tc${i}`, "Read", { file_path: `/w/f${i}.ts` });
    }
    expect(translator.collectReminders().some((r) => r.includes("连续调用了"))).toBe(false);
  });

  it("工具调用数达到阈值触发过载提醒", async () => {
    const translator = makeTranslator(10); // overloadAt = round(7) = 7
    for (let i = 0; i < 7; i++) {
      await startTool(translator, `o${i}`, "Read", { file_path: `/w/f${i}.ts` });
    }
    expect(translator.collectReminders().some((r) => r.includes("已经发起了"))).toBe(true);
  });

  it("有未完成 todo 且多轮未更新触发空闲提醒", async () => {
    const translator = makeTranslator();
    await startTool(translator, "todo1", "TodoWrite", { todos: [{ status: "in_progress" }] });
    for (let i = 0; i < 6; i++) {
      await endTurn(translator);
    }
    expect(translator.collectReminders()).toContain(TODO_IDLE_REMINDER);
  });

  it("todo 全部完成不触发空闲提醒", async () => {
    const translator = makeTranslator();
    await startTool(translator, "todo1", "TodoWrite", { todos: [{ status: "completed" }] });
    for (let i = 0; i < 6; i++) {
      await endTurn(translator);
    }
    expect(translator.collectReminders()).not.toContain(TODO_IDLE_REMINDER);
  });

  it("collectReminders 取走后清空，不重复发", async () => {
    const translator = makeTranslator();
    for (let i = 0; i < 3; i++) {
      await startTool(translator, `tc${i}`, "Read", { file_path: "/w/a.ts" });
    }
    expect(translator.collectReminders().length).toBeGreaterThan(0);
    expect(translator.collectReminders().length).toBe(0);
  });
});

describe("RunEventTranslator reasoning 计时", () => {
  it("没有 thinking_end 时遇到工具参数流就收口 reasoning 时长", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    try {
      const persistedMessages: Array<Record<string, unknown>> = [];
      const pushedEvents: StreamEvent[] = [];
      const store = {
        insertToolCall: async () => {},
        updateToolCall: async (toolCall: unknown) => toolCall,
        addMessage: async (message: Record<string, unknown>) => {
          const persisted = {
            id: `msg_${persistedMessages.length + 1}`,
            createdAt: new Date().toISOString(),
            ...message
          };
          persistedMessages.push(persisted);
          return persisted;
        }
      } as unknown as StateStore;
      const queue = {
        push: (event: StreamEvent) => {
          pushedEvents.push(event);
        }
      } as unknown as AsyncEventQueue<StreamEvent>;
      const translator = new RunEventTranslator({
        store,
        queue,
        approvals: {} as unknown as ApprovalQueue,
        runId: "run_reasoning",
        sessionId: "sess_reasoning",
        projectId: null,
        workspacePath: "/w",
        accessMode: "full_access",
        projectApprovalTrustService: {
          isTrusted: async () => false
        } as unknown as ProjectApprovalTrustService,
        signal: new AbortController().signal,
        model: "test-model",
        maxToolIterations: 10
      });

      await translator.emit({ type: "message_start", message: { role: "assistant" } } as never);
      await translator.emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_delta",
          contentIndex: 0,
          delta: "先想清楚",
          partial: { content: [{ type: "thinking", thinking: "先想清楚" }] }
        }
      } as never);
      vi.advanceTimersByTime(4000);
      await translator.emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 1,
          partial: {
            content: [
              { type: "thinking", thinking: "先想清楚" },
              { type: "toolCall", id: "call_1", name: "Write", arguments: {} }
            ]
          }
        }
      } as never);
      await translator.emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 1,
          delta: "{\"file_path\":\"out.txt\"",
          partial: {
            content: [
              { type: "thinking", thinking: "先想清楚" },
              { type: "toolCall", id: "call_1", name: "Write", arguments: { file_path: "out.txt" } }
            ]
          }
        }
      } as never);
      vi.advanceTimersByTime(30000);
      await translator.emit({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "先想清楚" },
            {
              type: "toolCall",
              id: "call_1",
              name: "Write",
              arguments: { file_path: "out.txt", content: "完整内容" }
            }
          ],
          api: "openai-completions",
          provider: "test",
          model: "test-model",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: "toolUse",
          timestamp: Date.now()
        }
      } as never);

      expect(persistedMessages[0]).toMatchObject({
        role: "assistant",
        reasoning: "先想清楚",
        reasoningMs: 4000
      });
      expect(
        pushedEvents.some((event) => event.type === "tool_activity" && event.activity.name === "Write")
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("RunEventTranslator 计划流式预览", () => {
  it("从 ExitPlanMode 的未闭合 JSON 参数中流式提取计划文本", async () => {
    const pushedEvents: StreamEvent[] = [];
    const translator = new RunEventTranslator({
      store: {
        insertToolCall: async () => {},
        updateToolCall: async (toolCall: unknown) => toolCall
      } as unknown as StateStore,
      queue: {
        push: (event: StreamEvent) => {
          pushedEvents.push(event);
        }
      } as unknown as AsyncEventQueue<StreamEvent>,
      approvals: {} as unknown as ApprovalQueue,
      runId: "run_plan",
      sessionId: "sess_plan",
      projectId: null,
      workspacePath: "/w",
      accessMode: "approval",
      projectApprovalTrustService: {
        isTrusted: async () => false
      } as unknown as ProjectApprovalTrustService,
      signal: new AbortController().signal,
      model: "test-model",
      maxToolIterations: 10
    });

    await translator.emit({ type: "message_start", message: { role: "assistant" } } as never);
    await translator.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: "{\"plan\":\"# 示例计划",
        partial: {
          content: [
            {
              type: "toolCall",
              id: "plan_call",
              name: "ExitPlanMode",
              arguments: "{\"plan\":\"# 示例计划\\n\\n## Summary\\n先"
            }
          ]
        }
      }
    } as never);
    await translator.emit({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: "做验证",
        partial: {
          content: [
            {
              type: "toolCall",
              id: "plan_call",
              name: "ExitPlanMode",
              arguments: "{\"plan\":\"# 示例计划\\n\\n## Summary\\n先做验证"
            }
          ]
        }
      }
    } as never);

    const planEvents = pushedEvents.filter((event) => event.type === "plan_delta");
    expect(planEvents).toHaveLength(2);
    expect(planEvents[0]).toMatchObject({
      type: "plan_delta",
      runId: "run_plan",
      markdown: "# 示例计划\n\n## Summary\n先"
    });
    expect(planEvents[0]?.delta).toBe(planEvents[0]?.markdown);
    expect(planEvents[1]).toMatchObject({
      type: "plan_delta",
      runId: "run_plan",
      markdown: "# 示例计划\n\n## Summary\n先做验证",
      delta: "做验证"
    });
  });
});
