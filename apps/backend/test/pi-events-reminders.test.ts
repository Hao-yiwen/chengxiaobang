import { describe, expect, it } from "vitest";
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
