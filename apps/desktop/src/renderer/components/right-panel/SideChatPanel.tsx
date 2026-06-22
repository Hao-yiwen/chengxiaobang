import {
  CheckMediumIcon,
  CopyIcon,
  RefreshIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import { useEffect, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createId } from "@chengxiaobang/shared";
import type { Message, SideChatDetail, StreamEvent } from "@chengxiaobang/shared";
import { Markdown } from "@/components/Markdown";
import { MetaActionButton } from "@/components/MessageActions";
import { StreamingMarkdown } from "@/components/StreamingMarkdown";
import { ToolCallRow } from "@/components/ToolCallRow";
import { Button } from "@/components/ui/button";
import { parseArtifactDeclarations } from "@/lib/artifact";
import {
  initialSideChatState,
  sideChatReducer,
  type SideChatItem
} from "@/lib/side-chat";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";
import {
  getApiClient,
  resolveRunProvider,
  selectActiveProject,
  useAppStore
} from "@/store";
import { latestSideChatAnchorMessage } from "@/store/helpers/side-chats";

function sideChatItemsFromDetail(detail: SideChatDetail | null): SideChatItem[] {
  if (!detail) {
    return [];
  }
  return [
    ...detail.messages.map((message) => ({ kind: "message" as const, message })),
    ...detail.toolCalls.map((toolCall) => ({ kind: "tool" as const, toolCall }))
  ].sort((a, b) => {
    const aAt =
      a.kind === "message" ? Date.parse(a.message.createdAt) : Date.parse(a.toolCall.createdAt);
    const bAt =
      b.kind === "message" ? Date.parse(b.message.createdAt) : Date.parse(b.toolCall.createdAt);
    return (Number.isFinite(aAt) ? aAt : 0) - (Number.isFinite(bAt) ? bAt : 0);
  });
}

function sideChatMessageCopyText(message: Message): string | undefined {
  if (message.role !== "user" && message.role !== "assistant") {
    return undefined;
  }
  if (!message.content.trim()) {
    return undefined;
  }
  return message.role === "assistant"
    ? parseArtifactDeclarations(message.content).cleanMarkdown
    : message.content;
}

function SideChatCopyActions({
  text,
  align,
  messageId,
  role,
  alwaysVisible = false
}: {
  text: string | undefined;
  align: "user" | "assistant";
  messageId?: string;
  role: Message["role"];
  alwaysVisible?: boolean;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  if (!text) {
    return null;
  }
  const copyText = text;

  async function copyMessage(): Promise<void> {
    console.info("[side-chat] 复制侧边会话消息", {
      messageId,
      role,
      textLength: copyText.length,
      alwaysVisible
    });
    await copy(copyText);
  }

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-2 transition-opacity",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100",
        align === "user" ? "justify-end" : "justify-start"
      )}
    >
      <MetaActionButton
        label={copied ? t("chat.copied") : t("chat.copy")}
        onClick={() => void copyMessage()}
      >
        {copied ? <CheckMediumIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </MetaActionButton>
    </div>
  );
}

function latestCopyableSideMessageId(items: SideChatItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "message" && sideChatMessageCopyText(item.message)) {
      return item.message.id;
    }
  }
  return undefined;
}

/**
 * 右侧消息锚定侧边会话：隐藏持久化、可续问、可审批，但不进入主聊天运行状态。
 */
export function SideChatPanel() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const provider = useAppStore(resolveRunProvider);
  const accessMode = useAppStore((state) => state.accessMode);
  const model = useAppStore((state) => state.model);
  const reasoningMode = useAppStore((state) => state.reasoningMode);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const messages = useAppStore((state) => state.messages);
  const sideChatsByMessageId = useAppStore((state) => state.sideChatsByMessageId);
  const activeSideChatAnchorMessageId = useAppStore(
    (state) => state.activeSideChatAnchorMessageId
  );
  const refreshSideChat = useAppStore((state) => state.refreshSideChat);
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
        if (current.anchorMessageId) {
          void useAppStore.getState().refreshSideChat(current.anchorMessageId);
        }
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
            if (current.anchorMessageId) {
              void useAppStore.getState().refreshSideChat(current.anchorMessageId);
            }
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
    const latestAnchor = latestSideChatAnchorMessage(messages, activeSessionId);
    const latestExistingAnchorMessageId =
      latestAnchor && sideChatsByMessageId[latestAnchor.id] ? latestAnchor.id : undefined;
    const anchorMessageId = activeSideChatAnchorMessageId ?? latestExistingAnchorMessageId;
    const current = stateRef.current;
    if (current.running) {
      console.debug("[side-chat] 运行中保持当前侧边会话状态，跳过锚点自动刷新", {
        activeSessionId,
        currentAnchorMessageId: current.anchorMessageId,
        nextAnchorMessageId: anchorMessageId,
        runId: current.runId,
        clientRequestId: current.clientRequestId
      });
      return undefined;
    }
    if (anchorMessageId && current.anchorMessageId === anchorMessageId && current.sessionId) {
      console.debug("[side-chat] 当前锚点已加载，跳过重复加载", {
        anchorMessageId,
        sessionId: current.sessionId
      });
      return undefined;
    }
    if (!anchorMessageId) {
      console.debug("[side-chat] 清空侧边会话：当前没有已创建侧边会话的锚点", {
        activeSessionId,
        latestAnchorMessageId: latestAnchor?.id
      });
      stateRef.current = initialSideChatState;
      dispatch({ type: "reset" });
      return undefined;
    }
    const client = getApiClient();
    stateRef.current = {
      ...initialSideChatState,
      anchorMessageId
    };
    dispatch({ type: "load", anchorMessageId, items: [] });
    if (!client?.getSideChat) {
      console.warn("[side-chat] 加载消息侧边会话失败：ApiClient 不可用", { anchorMessageId });
      return undefined;
    }
    let cancelled = false;
    void client
      .getSideChat(anchorMessageId)
      .then((detail) => {
        if (cancelled || stateRef.current.anchorMessageId !== anchorMessageId) {
          console.debug("[side-chat] 忽略过期的侧边会话加载结果", {
            anchorMessageId,
            currentAnchorMessageId: stateRef.current.anchorMessageId
          });
          return;
        }
        const items = sideChatItemsFromDetail(detail);
        const sessionId = detail?.session?.id;
        console.info("[side-chat] 加载消息绑定侧边会话", {
          anchorMessageId,
          sessionId,
          itemCount: items.length,
          hasPersistedSession: Boolean(sessionId)
        });
        stateRef.current = {
          ...initialSideChatState,
          anchorMessageId,
          sessionId,
          items
        };
        dispatch({ type: "load", anchorMessageId, sessionId, items });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        console.warn("[side-chat] 加载消息绑定侧边会话失败", {
          anchorMessageId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, activeSideChatAnchorMessageId, messages, sideChatsByMessageId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.items, state.streamText, state.pendingTool]);

  async function send(): Promise<void> {
    const client = getApiClient();
    const prompt = input.trim();
    const latestAnchor = latestSideChatAnchorMessage(messages, activeSessionId);
    const current = stateRef.current;
    const anchorMessageId =
      current.anchorMessageId ?? activeSideChatAnchorMessageId ?? latestAnchor?.id;
    if (!client || !prompt || current.running) {
      return;
    }
    if (!anchorMessageId) {
      console.warn("[side-chat] 发送失败：当前主会话没有可绑定的最近消息", {
        activeSessionId,
        messageCount: messages.length
      });
      return;
    }
    if (!provider) {
      useAppStore.getState().setOnboardingOpen(true);
      return;
    }
    let sessionId = current.sessionId;
    let sideChatParentSessionId = activeSessionId;
    try {
      if (!sessionId) {
        console.info("[side-chat] 首次发送前创建隐藏侧边会话", {
          anchorMessageId,
          activeSessionId,
          source: current.anchorMessageId ? "loaded-anchor" : "latest-main-message"
        });
        if (!client.createSideChat) {
          throw new Error("当前客户端不支持侧边会话");
        }
        const detail = await client.createSideChat(anchorMessageId);
        if (!detail.session) {
          throw new Error("侧边会话创建失败：后端未返回会话");
        }
        const items = sideChatItemsFromDetail(detail);
        sessionId = detail.session.id;
        sideChatParentSessionId = detail.session.sideChatParentSessionId ?? activeSessionId;
        stateRef.current = {
          ...initialSideChatState,
          anchorMessageId,
          sessionId,
          items
        };
        dispatch({ type: "load", anchorMessageId, sessionId, items });
        void refreshSideChat(anchorMessageId);
      }
    } catch (error) {
      console.warn("[side-chat] 创建隐藏侧边会话失败", {
        anchorMessageId,
        activeSessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      dispatch({
        type: "finish",
        error: error instanceof Error ? error.message : "侧边会话创建失败"
      });
      return;
    }
    if (!sessionId) {
      console.warn("[side-chat] 发送失败：隐藏侧边会话 id 为空", {
        anchorMessageId,
        activeSessionId
      });
      dispatch({ type: "finish", error: "侧边会话创建失败" });
      return;
    }
    setInput("");
    const clientRequestId = createId("side_run");
    dispatch({ type: "send", clientRequestId });
    stateRef.current = {
      ...stateRef.current,
      anchorMessageId,
      sessionId,
      clientRequestId,
      runId: undefined,
      running: true,
      error: undefined
    };
    const runInput = {
      sessionId,
      ...(sideChatParentSessionId ? { sideChatParentSessionId } : {}),
      projectId: project?.id ?? null,
      prompt,
      clientRequestId,
      providerId: provider.id,
      accessMode,
      planMode: false,
      ...(model ? { model } : {}),
      ...(reasoningMode ? { reasoningMode } : {})
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
      await client.streamRun(runInput, applyRunEvent);
      dispatch({ type: "finish" });
      void refreshSideChat(anchorMessageId);
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
  const latestAnchor = latestSideChatAnchorMessage(messages, activeSessionId);
  const canStartSideChat = Boolean(activeSideChatAnchorMessageId ?? latestAnchor);
  const hasLoadedAnchor = Boolean(state.anchorMessageId);
  const latestCopyableMessageId = latestCopyableSideMessageId(state.items);
  const streamingCopyText = state.streamText.trim() ? state.streamText : undefined;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 [scrollbar-gutter:stable]"
      >
        {!canStartSideChat ? (
          <p className="px-1 py-2 text-caption text-muted-foreground">
            {t("rightPanel.chatNoAvailableAnchor")}
          </p>
        ) : !hasLoadedAnchor ? (
          <p className="px-1 py-2 text-caption text-muted-foreground">
            {t("rightPanel.chatNoAnchor")}
          </p>
        ) : state.items.length === 0 && !state.streamText ? (
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
                    className="group/msg flex min-w-0 max-w-[85%] flex-col items-end self-end"
                  >
                    <div className="rounded-sm bg-canvas-soft-2 px-3 py-2 text-caption text-foreground">
                      <span className="whitespace-pre-wrap break-words">
                        {item.message.content}
                      </span>
                    </div>
                    <SideChatCopyActions
                      text={sideChatMessageCopyText(item.message)}
                      align="user"
                      messageId={item.message.id}
                      role={item.message.role}
                      alwaysVisible={!streamingCopyText && item.message.id === latestCopyableMessageId}
                    />
                  </div>
                ) : (
                  <div key={item.message.id} className="group/msg min-w-0 max-w-full">
                    <Markdown text={item.message.content} />
                    <SideChatCopyActions
                      text={sideChatMessageCopyText(item.message)}
                      align="assistant"
                      messageId={item.message.id}
                      role={item.message.role}
                      alwaysVisible={!streamingCopyText && item.message.id === latestCopyableMessageId}
                    />
                  </div>
                )
              ) : (
                <ToolCallRow key={item.toolCall.id} toolCall={item.toolCall} />
              )
            )}
            {state.streamText ? (
              <div className="group/msg min-w-0 max-w-full">
                <StreamingMarkdown text={state.streamText} className="min-w-0 max-w-full" />
                <SideChatCopyActions
                  text={streamingCopyText}
                  align="assistant"
                  role="assistant"
                  alwaysVisible
                />
              </div>
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
          disabled={!canStartSideChat}
          spellCheck={false}
          className="h-8 w-full rounded-xs border bg-card px-2.5 text-caption outline-none transition-colors focus:border-form-focus disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
    </div>
  );
}
