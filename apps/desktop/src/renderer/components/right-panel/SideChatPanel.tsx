import {
  CheckMediumIcon,
  ComposeIcon,
  RefreshIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import { useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createId } from "@chengxiaobang/shared";
import type { StreamEvent } from "@chengxiaobang/shared";
import { Markdown } from "@/components/Markdown";
import { StreamingMarkdown } from "@/components/StreamingMarkdown";
import { ToolCallRow } from "@/components/ToolCallRow";
import { Button } from "@/components/ui/button";
import { initialSideChatState, sideChatReducer } from "@/lib/side-chat";
import {
  getApiClient,
  resolveRunProvider,
  selectActiveProject,
  useAppStore
} from "@/store";

/**
 * 右侧独立小聊天：拥有自己的会话、流式回复、工具行和轻量审批栏。
 * 它不会写入主聊天的运行状态。
 */
export function SideChatPanel() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const provider = useAppStore(resolveRunProvider);
  const accessMode = useAppStore((state) => state.accessMode);
  const model = useAppStore((state) => state.model);
  const [state, dispatch] = useReducer(sideChatReducer, initialSideChatState);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  function applyRunEvent(event: StreamEvent): void {
    stateRef.current = sideChatReducer(stateRef.current, { type: "event", event });
    dispatch({ type: "event", event });
  }

  async function recoverSideChatRun(): Promise<void> {
    const client = getApiClient();
    const current = stateRef.current;
    if (!client || !current.running || !current.sessionId || !current.runId) {
      return;
    }
    const sessionId = current.sessionId;
    const runId = current.runId;
    try {
      const [messages, history] = await Promise.all([
        client.listMessages(sessionId),
        client.listSessionRuns(sessionId)
      ]);
      if (stateRef.current.runId !== runId) {
        console.info("[side-chat] 跳过过期的运行恢复结果", {
          sessionId,
          runId,
          currentRunId: stateRef.current.runId
        });
        return;
      }
      const toolCalls = history.toolCalls.filter((toolCall) => toolCall.runId === runId);
      const run = history.runs.find((item) => item.id === runId);
      console.info("[side-chat] 重连后恢复运行状态", {
        sessionId,
        runId,
        runStatus: run?.status,
        messageCount: messages.length,
        toolCallCount: toolCalls.length
      });
      for (const message of messages) {
        applyRunEvent({ type: "message", runId, message });
      }
      for (const toolCall of toolCalls) {
        applyRunEvent({ type: "tool_call", runId, toolCall });
      }
      if (run && run.status !== "running") {
        applyRunEvent({
          type: "run_end",
          runId,
          status: run.status,
          ...(run.usage ? { usage: run.usage } : {}),
          ...(run.error ? { error: run.error } : {})
        });
        void useAppStore.getState().loadData();
      }
    } catch (error) {
      console.warn("[side-chat] 重连后恢复运行状态失败", {
        sessionId,
        runId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  useEffect(() => {
    const client = getApiClient();
    if (!client?.subscribeRunEvents) {
      return undefined;
    }
    return client.subscribeRunEvents(
      (event) => {
        const current = stateRef.current;
        if (event.type === "session_updated") {
          return;
        }
        if (event.type === "run_started") {
          if (current.clientRequestId && event.clientRequestId === current.clientRequestId) {
            applyRunEvent(event);
          }
          return;
        }
        if (!("runId" in event)) {
          return;
        }
        if (current.runId && event.runId === current.runId) {
          applyRunEvent(event);
          if (event.type === "run_end") {
            void useAppStore.getState().loadData();
          }
        }
      },
      {
        onReconnect: () => void recoverSideChatRun(),
        onError: (error: unknown) =>
          console.warn("[side-chat] 全局运行事件流异常", {
            error: error instanceof Error ? error.message : String(error)
          })
      }
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.items, state.streamText, state.pendingTool]);

  async function send(): Promise<void> {
    const client = getApiClient();
    const prompt = input.trim();
    if (!client || !prompt || state.running) {
      return;
    }
    if (!provider) {
      useAppStore.getState().setOnboardingOpen(true);
      return;
    }
    setInput("");
    const clientRequestId = createId("side_run");
    dispatch({ type: "send", clientRequestId });
    stateRef.current = {
      ...stateRef.current,
      clientRequestId,
      runId: undefined,
      running: true,
      error: undefined
    };
    const runInput = {
      sessionId: state.sessionId,
      projectId: project?.id ?? null,
      prompt,
      clientRequestId,
      providerId: provider.id,
      accessMode,
      planMode: false,
      ...(model ? { model } : {})
    };
    try {
      if (client.startRun && client.subscribeRunEvents) {
        const started = await client.startRun(runInput);
        if (stateRef.current.clientRequestId === clientRequestId && !stateRef.current.runId) {
          applyRunEvent({
            type: "run_started",
            runId: started.runId,
            sessionId: started.sessionId,
            ...(started.clientRequestId ? { clientRequestId: started.clientRequestId } : {}),
            ...(started.providerId ? { providerId: started.providerId } : {}),
            ...(started.model ? { model: started.model } : {}),
            ...(started.reasoningMode ? { reasoningMode: started.reasoningMode } : {})
          });
        }
        return;
      }
      await client.streamRun(runInput, (event) => dispatch({ type: "event", event }));
      dispatch({ type: "finish" });
      // 把可能新建的侧边会话同步到左侧列表。
      void useAppStore.getState().loadData();
    } catch (error) {
      console.error("[side-chat] 运行流中断:", error);
      dispatch({ type: "finish", error: error instanceof Error ? error.message : String(error) });
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  const pendingTool = state.pendingTool;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex min-w-0 flex-none items-center justify-end border-b px-3 py-2">
        <button
          type="button"
          disabled={state.running}
          onClick={() => dispatch({ type: "reset" })}
          className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-micro text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ComposeIcon className="size-3.5" />
          {t("rightPanel.chatNew")}
        </button>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 [scrollbar-gutter:stable]"
      >
        {state.items.length === 0 && !state.streamText ? (
          <p className="px-1 py-2 text-caption text-muted-foreground">
            {t("rightPanel.chatEmpty")}
          </p>
        ) : (
          <div className="flex min-w-0 max-w-full flex-col gap-3">
            {state.items.map((item) =>
              item.kind === "message" ? (
                item.message.role === "user" ? (
                  <div
                    key={item.message.id}
                    className="min-w-0 max-w-[85%] self-end rounded-sm bg-canvas-soft-2 px-3 py-2 text-caption text-foreground"
                  >
                    <span className="whitespace-pre-wrap break-words">{item.message.content}</span>
                  </div>
                ) : (
                  <div key={item.message.id} className="min-w-0 max-w-full">
                    <Markdown text={item.message.content} />
                  </div>
                )
              ) : (
                <ToolCallRow key={item.toolCall.id} toolCall={item.toolCall} />
              )
            )}
            {state.streamText ? (
              <StreamingMarkdown text={state.streamText} className="min-w-0 max-w-full" />
            ) : null}
            {state.running && !state.streamText && !pendingTool ? (
              <RefreshIcon className="size-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        )}
        {pendingTool ? (
          <div className="mt-3 max-w-full overflow-hidden rounded-sm border bg-card">
            <div className="border-b bg-canvas-soft-2/70 px-3 py-2 font-mono text-micro font-medium uppercase tracking-[0.28px]">
              {pendingTool.name}
            </div>
            <div className="flex flex-col gap-2 p-3">
              <pre className="max-h-[160px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted px-2.5 py-2 font-mono text-micro leading-relaxed text-muted-foreground [scrollbar-gutter:stable]">
                {JSON.stringify(pendingTool.args, null, 2)}
              </pre>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void getApiClient()?.approve(pendingTool.id, { approved: true })}
                >
                  <CheckMediumIcon className="size-4" />
                  {t("chat.run")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void getApiClient()?.approve(pendingTool.id, { approved: false })}
                >
                  <XMarkIcon className="size-4" />
                  {t("chat.reject")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {state.error ? (
          <p className="mt-3 px-1 text-micro text-destructive">{state.error}</p>
        ) : null}
      </div>
      <div className="flex-none border-t px-3 py-2.5">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("rightPanel.chatPlaceholder")}
          aria-label={t("rightPanel.chatPlaceholder")}
          spellCheck={false}
          className="h-8 w-full rounded-xs border bg-card px-2.5 text-caption outline-none transition-colors focus:border-form-focus"
        />
      </div>
    </div>
  );
}
