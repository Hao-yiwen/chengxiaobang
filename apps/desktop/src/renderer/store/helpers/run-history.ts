import {
  todoWriteArgsSchema,
  type ActiveRunSnapshot,
  type Message,
  type ReasoningMode,
  type RunRecord,
  type StreamEvent,
  type ToolCall
} from "@chengxiaobang/shared";
import type { AppState, SessionRunHistory, View } from "../types";
import {
  composerDraftScopeForView,
  sessionComposerDraftScope,
  switchComposerDraftScope
} from "./composer-drafts";
import { pauseRunQueue } from "./queues";
import { clearSessionRunTracking, markRunRunning } from "./running";
import { upsertRunHistory } from "./run-records";

const INTERRUPTED_RUN_ERROR =
  "运行进程已重启，无法继续等待审批或工具结果。请重新发起本次请求。";

export function runModelFromStarted(
  event: Extract<StreamEvent, { type: "run_started" }>
): { providerId?: string; model: string; reasoningMode?: ReasoningMode } | undefined {
  if (!event.model) {
    return undefined;
  }
  return {
    providerId: event.providerId,
    model: event.model,
    reasoningMode: event.reasoningMode
  };
}

export function logRecoveredFailedRuns(sessionId: string, runs: RunRecord[], source: string): void {
  const failedRuns = runs.filter((run) => run.status === "failed");
  if (failedRuns.length === 0) {
    return;
  }
  console.info("[store] 已恢复失败运行提示", {
    sessionId,
    source,
    runIds: failedRuns.map((run) => run.id)
  });
}

export function settleInterruptedRunHistory(
  sessionId: string,
  history: SessionRunHistory,
  source: string
): {
  history: SessionRunHistory;
  interruptedRunIds: string[];
  interruptedToolCallIds: string[];
} {
  const interruptedRunIds = history.runs
    .filter((run) => run.status === "running")
    .map((run) => run.id);
  if (interruptedRunIds.length === 0) {
    return { history, interruptedRunIds: [], interruptedToolCallIds: [] };
  }

  const timestamp = new Date().toISOString();
  const interruptedRunIdSet = new Set(interruptedRunIds);
  const interruptedToolCallIds: string[] = [];
  const settledHistory = {
    runs: history.runs.map((run) =>
      interruptedRunIdSet.has(run.id)
        ? {
            ...run,
            status: "failed" as const,
            error: INTERRUPTED_RUN_ERROR,
            updatedAt: timestamp
          }
        : run
    ),
    toolCalls: history.toolCalls.map((toolCall) => {
      if (
        !interruptedRunIdSet.has(toolCall.runId) ||
        (toolCall.status !== "pending_smart_approval" &&
          toolCall.status !== "pending_approval" &&
          toolCall.status !== "running")
      ) {
        return toolCall;
      }
      interruptedToolCallIds.push(toolCall.id);
      return {
        ...toolCall,
        status: "failed" as const,
        result: INTERRUPTED_RUN_ERROR,
        updatedAt: timestamp
      };
    })
  };

  console.warn("[store] 已收敛无后端活跃快照的历史运行", {
    sessionId,
    source,
    runIds: interruptedRunIds,
    toolCallIds: interruptedToolCallIds,
    reason: INTERRUPTED_RUN_ERROR
  });

  return { history: settledHistory, interruptedRunIds, interruptedToolCallIds };
}

export function settledSessionHistoryPatch(
  state: AppState,
  sessionId: string,
  messages: Message[],
  history: SessionRunHistory,
  view?: View,
  settleRunId?: string
): Partial<AppState> {
  // 收尾写回(run_end 后的异步刷新)期间若同一会话已起新 run(activeRunId 变了),整体跳过,
  // 避免用过期的后端读覆盖新 run 的 messages / 运行态。仅在显式传入 settleRunId 时启用该守卫,
  // 其他调用方(切换会话等)行为不变。
  if (
    settleRunId !== undefined &&
    state.activeSessionId === sessionId &&
    state.isRunning &&
    state.activeRunId !== undefined &&
    state.activeRunId !== settleRunId
  ) {
    return {};
  }
  const shouldClearCurrentRun = state.activeSessionId === sessionId && state.isRunning;
  const targetScope = view ? composerDraftScopeForView(view, sessionId) : undefined;
  return {
    messages,
    toolHistory: history.toolCalls,
    runHistory: history.runs,
    ...(view ? { view } : {}),
    ...(targetScope ? switchComposerDraftScope(state, targetScope, "settledSessionHistory") : {}),
    ...(shouldClearCurrentRun
      ? {
          isRunning: false,
          activeRunId: undefined,
          activeRunClientRequestId: undefined,
          activeRunModel: undefined,
          activeRunLastAssistant: undefined,
          pendingTool: undefined,
          runningTool: undefined,
          toolActivity: undefined,
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          thinkingDurationMs: undefined,
          activeRunStartedAt: undefined,
          events: [],
          ...pauseRunQueue(state, sessionId),
          ...clearSessionRunTracking(state, sessionId)
        }
      : {})
  };
}


export function activeRunRecoveryPatch(
  state: AppState,
  snapshot: ActiveRunSnapshot,
  history: SessionRunHistory,
  source: string
): Partial<AppState> {
  const activeToolCalls = snapshot.toolCalls.length > 0
    ? snapshot.toolCalls
    : history.toolCalls.filter((toolCall) => toolCall.runId === snapshot.run.id);
  const pendingTool = [...activeToolCalls]
    .reverse()
    .find((toolCall) => toolCall.status === "pending_approval");
  const runningTool = [...activeToolCalls]
    .reverse()
    .find(
      (toolCall) =>
        toolCall.status === "running" || toolCall.status === "pending_smart_approval"
    );

  console.info("[store] 恢复后端活跃 run 快照", {
    source,
    sessionId: snapshot.run.sessionId,
    runId: snapshot.run.id,
    pendingToolId: pendingTool?.id,
    runningToolId: runningTool?.id,
    toolCallCount: activeToolCalls.length
  });

  return {
    toolHistory: pendingTool
      ? history.toolCalls.filter((toolCall) => toolCall.id !== pendingTool.id)
      : history.toolCalls,
    runHistory: upsertRunHistory(history.runs, snapshot.run),
    pendingTool,
    runningTool: pendingTool ? undefined : runningTool,
    isRunning: true,
    activeRunId: snapshot.run.id,
    activeRunClientRequestId: undefined,
    activeRunModel: state.activeRunId === snapshot.run.id ? state.activeRunModel : undefined,
    activeRunLastAssistant:
      state.activeRunId === snapshot.run.id ? state.activeRunLastAssistant : undefined,
    // 同 run 恢复保留本地计时起点；异 run 清空，让 groupTurns 回退到 user.createdAt。
    activeRunStartedAt:
      state.activeRunId === snapshot.run.id ? state.activeRunStartedAt : undefined,
  toolActivity: undefined,
  streamText: "",
  thinking: "",
  thinkingStartedAt: undefined,
  thinkingDurationMs: undefined,
  ...markRunRunning(state, snapshot.run.id, snapshot.run.sessionId)
};
}

export function shouldHandleRunEvent(
  state: AppState,
  event: StreamEvent,
  force: boolean | undefined
): boolean {
  if (event.type === "setup_error") {
    return true;
  }
  if (force || event.type === "session_updated") {
    return true;
  }
  if (event.type === "run_started") {
    return Boolean(
      (state.activeRunClientRequestId && event.clientRequestId === state.activeRunClientRequestId) ||
        (state.activeRunId && event.runId === state.activeRunId)
    );
  }
  return Boolean(
    (state.activeRunId && event.runId === state.activeRunId) ||
      state.runHistory.some((run) => run.id === event.runId && run.status === "running")
  );
}

export function autoOpenProgressPanelPatch(state: AppState, toolCall: ToolCall): Partial<AppState> {
  const todoArgs =
    toolCall.name === "TodoWrite" ? todoWriteArgsSchema.safeParse(toolCall.args) : undefined;
  if (
    toolCall.name === "TodoWrite" &&
    todoArgs?.success &&
    todoArgs.data.todos.length === 0 &&
    state.activeRunId === toolCall.runId
  ) {
    return {
      progressPanelOpen: false,
      progressPanelAutoOpenedRunId: undefined
    };
  }
  if (
    toolCall.name !== "TodoWrite" ||
    !todoArgs?.success ||
    todoArgs.data.todos.length === 0 ||
    state.view !== "chat" ||
    state.activeRunId !== toolCall.runId ||
    state.progressPanelAutoOpenedRunId === toolCall.runId
  ) {
    return {};
  }
  console.info("[store] 检测到 todo 清单，自动打开对话进度浮层", {
    runId: toolCall.runId,
    toolCallId: toolCall.id,
    wasOpen: state.progressPanelOpen,
    rightPanelOpen: state.rightPanelOpen,
    rightPanelMode: state.rightPanelMode
  });
  return {
    progressPanelOpen: true,
    progressPanelAutoOpenedRunId: toolCall.runId
  };
}
