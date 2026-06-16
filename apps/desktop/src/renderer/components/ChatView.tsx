import {
  ArchiveBoxIcon,
  ChevronIcon,
  FileIcon,
  GitBranchIcon,
  RefreshIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useTranslation } from "react-i18next";
import type {
  Message,
  MessageAttachment,
  Session,
  ToolActivity,
  ToolCall
} from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { AssistantMarkdownWithArtifacts } from "@/components/AssistantMarkdownWithArtifacts";
import { Markdown } from "@/components/Markdown";
import { MessageActions, MessageEditor } from "@/components/MessageActions";
import { PlanCard } from "@/components/PlanCard";
import { ReasoningPanel } from "@/components/ReasoningPanel";
import { RunFileChangesCard } from "@/components/RunFileChangesCard";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { ToolCallGroup } from "@/components/ToolCallGroup";
import { ToolCallRow } from "@/components/ToolCallRow";
import { WorkTimer } from "@/components/WorkTimer";
import { parseArtifactDeclarations } from "@/lib/artifact";
import { anchorScrollTop, contentTop, isNearBottom, tailSpacerHeight } from "@/lib/scroll";
import {
  chatViewTimelineItems,
  failedRunNotices,
  groupTurns,
  type ChatBlock,
  type ChatViewTimelineRenderItem,
  type FailedRunNotice,
  type TurnBlock
} from "@/lib/timeline";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

function toolCallsWithPendingPlan(toolCalls: ToolCall[], pendingTool?: ToolCall): ToolCall[] {
  if (!pendingTool || pendingTool.name !== "ExitPlanMode") {
    return toolCalls;
  }
  if (toolCalls.some((toolCall) => toolCall.id === pendingTool.id)) {
    return toolCalls;
  }
  console.debug("[ChatView] 将待确认计划并入聊天时间线", {
    toolCallId: pendingTool.id,
    runId: pendingTool.runId
  });
  return [...toolCalls, pendingTool];
}

function toolActivityToTimelineTool(
  activity: ToolActivity | undefined,
  runId: string | undefined
): ToolCall | undefined {
  if (!activity?.name || !runId) {
    return undefined;
  }
  return {
    id: activity.toolCallId ?? `tool_activity_${runId}_${activity.contentIndex}`,
    runId,
    name: activity.name,
    args: activity.argsPreview,
    status: "running",
    createdAt: activity.updatedAt,
    updatedAt: activity.updatedAt
  };
}

function streamCaretFilePath(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || !("file_path" in args)) {
    return undefined;
  }
  const value = (args as { file_path?: unknown }).file_path;
  return typeof value === "string" ? value : undefined;
}

function streamCaretToolSummary(tool: ToolCall | undefined) {
  if (!tool) {
    return undefined;
  }
  return {
    id: tool.id,
    runId: tool.runId,
    name: tool.name,
    status: tool.status,
    filePath: streamCaretFilePath(tool.args)
  };
}

function streamCaretJsonForLog(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify({
      serializeError: error instanceof Error ? error.message : String(error)
    });
  }
}

function canRetryFailedNotice(
  notice: FailedRunNotice,
  messages: Message[],
  isRunning: boolean
): boolean {
  if (isRunning || !messages.some((message) => message.role === "user")) {
    return false;
  }
  return !messages.some((message) => message.role === "user" && message.createdAt > notice.at);
}

function resolveForkMarkerBlockKey(
  blocks: ChatBlock[],
  messages: Message[],
  session: Session | undefined
): string | undefined {
  if (!session?.parentSessionId) {
    return undefined;
  }
  if (messages.length === 0 || messages.every((message) => message.sessionId !== session.id)) {
    return undefined;
  }
  const explicitMessageId = session.forkPointMessageId;
  if (explicitMessageId) {
    const block = blocks.find((item) => blockContainsMessageId(item, explicitMessageId));
    if (block) {
      return block.key;
    }
    console.debug("[ChatView] 派生点消息不在当前时间线，尝试按创建时间回退", {
      sessionId: session.id,
      forkPointMessageId: explicitMessageId
    });
  }
  const fallbackMessageId = fallbackForkPointMessageId(messages, session.createdAt);
  if (!fallbackMessageId) {
    console.debug("[ChatView] 派生会话缺少可定位的派生点", {
      sessionId: session.id,
      messageCount: messages.length
    });
    return undefined;
  }
  const block = blocks.find((item) => blockContainsMessageId(item, fallbackMessageId));
  if (!block) {
    console.debug("[ChatView] 派生点回退消息未进入渲染时间线", {
      sessionId: session.id,
      fallbackMessageId
    });
    return undefined;
  }
  return block.key;
}

function fallbackForkPointMessageId(
  messages: Message[],
  sessionCreatedAt: string
): string | undefined {
  const sessionCreatedMs = Date.parse(sessionCreatedAt);
  if (!Number.isFinite(sessionCreatedMs)) {
    return undefined;
  }
  let candidate: { id: string; createdMs: number } | undefined;
  for (const message of messages) {
    const createdMs = Date.parse(message.createdAt);
    if (!Number.isFinite(createdMs) || createdMs > sessionCreatedMs) {
      continue;
    }
    if (!candidate || createdMs >= candidate.createdMs) {
      candidate = { id: message.id, createdMs };
    }
  }
  return candidate?.id;
}

function blockContainsMessageId(block: ChatBlock, messageId: string): boolean {
  if (block.kind === "standalone") {
    return block.item.kind === "message" && block.item.message.id === messageId;
  }
  if (block.user?.item.message.id === messageId || block.answer?.item.message.id === messageId) {
    return true;
  }
  return (
    block.intermediate.some(
      (member) => member.item.kind === "message" && member.item.message.id === messageId
    ) ||
    block.afterAnswer.some(
      (member) => member.item.kind === "message" && member.item.message.id === messageId
    )
  );
}

export function ChatView() {
  const { t } = useTranslation();
  const {
    sessions,
    activeSessionId,
    messages,
    toolHistory,
    streamText,
    thinking,
    thinkingStartedAt,
    thinkingDurationMs,
    pendingTool,
    toolActivity,
    runningTool,
    events,
    runHistory,
    isRunning,
    activeRunId,
    activeRunStartedAt
  } = useAppStore(
    useShallow((state) => ({
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      messages: state.messages,
      toolHistory: state.toolHistory,
      streamText: state.streamText,
      thinking: state.thinking,
      thinkingStartedAt: state.thinkingStartedAt,
      thinkingDurationMs: state.thinkingDurationMs,
      pendingTool: state.pendingTool,
      toolActivity: state.toolActivity,
      runningTool: state.runningTool,
      events: state.events,
      runHistory: state.runHistory,
      isRunning: state.isRunning,
      activeRunId: state.activeRunId,
      activeRunStartedAt: state.activeRunStartedAt
    }))
  );
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const regenerateLast = useAppStore((state) => state.regenerateLast);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentColumnRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  // Message id currently anchored to the viewport top (the just-sent user
  // message), and a snapshot of the previous messages tail so wholesale array
  // replacements (session switch, post-run reload) can be told apart from a
  // genuine echo append.
  const anchorIdRef = useRef<string | undefined>(undefined);
  const prevTailRef = useRef<
    { sessionId?: string; lastId?: string; length: number } | undefined
  >(undefined);
  const streamCaretDecisionLogKeyRef = useRef<string | undefined>(undefined);
  const [nearBottom, setNearBottom] = useState(true);
  const [scrollProgress, setScrollProgress] = useState({
    visible: false,
    top: 0,
    height: 100
  });

  const syncScrollProgress = useCallback((el: HTMLDivElement | null = scrollRef.current) => {
    if (!el) {
      return;
    }
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 1) {
      setScrollProgress((current) =>
        current.visible ? { visible: false, top: 0, height: 100 } : current
      );
      return;
    }
    const height = Math.max(8, Math.min(100, (el.clientHeight / el.scrollHeight) * 100));
    const top = Math.min(100 - height, Math.max(0, (el.scrollTop / maxScroll) * (100 - height)));
    setScrollProgress({ visible: true, top, height });
  }, []);

  const liveToolActivityCall = useMemo(
    () => toolActivityToTimelineTool(toolActivity, activeRunId),
    [toolActivity, activeRunId]
  );
  const hasActiveTimelineTool = Boolean(runningTool);
  const hasToolActivity = Boolean(toolActivity);
  const hasLiveThinking = Boolean(thinking);
  const isStreamingThinking = hasLiveThinking && thinkingDurationMs === undefined;
  const showWaiting =
    isRunning &&
    !streamText &&
    !thinking &&
    !pendingTool &&
    !hasToolActivity &&
    !hasActiveTimelineTool;

  // Reasoning-only rows carry no actions, so the "last assistant" affordances
  // (copy/regenerate) stay on the last turn that actually has content.
  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim().length > 0)?.id;
  const lastUserMessageId = [...messages].reverse().find((message) => message.role === "user")?.id;
  const failedNotices = useMemo(
    () => failedRunNotices(runHistory, events),
    [runHistory, events]
  );
  const timelineToolCalls = useMemo(
    () => toolCallsWithPendingPlan(toolHistory, pendingTool),
    [toolHistory, pendingTool]
  );
  const items = useMemo(
    () => chatViewTimelineItems(messages, timelineToolCalls, failedNotices, activeRunId, runHistory),
    [messages, timelineToolCalls, failedNotices, activeRunId, runHistory]
  );
  const activeRunAssistantIds = useMemo(
    () =>
      new Set(
        events
          .filter(
            (event) =>
              event.type === "message" &&
              event.runId === activeRunId &&
              event.message.role === "assistant"
          )
          .map((event) => (event.type === "message" ? event.message.id : ""))
      ),
    [activeRunId, events]
  );
  const lastActionMessageId = useMemo(
    () => lastVisibleActionMessageId(items, activeRunAssistantIds),
    [activeRunAssistantIds, items]
  );
  // 把扁平时间线按轮次分组，每个 AI 轮次包一层「已工作」折叠头。nowMs 只作活跃轮缺起点时的
  // 兜底，不进 deps（否则每帧重算）；折叠头实时刷新由 WorkTimer 内部 interval 局部驱动。
  const blocks = useMemo(
    () =>
      groupTurns(items, {
        isRunning,
        activeRunId,
        activeRunAssistantIds,
        activeRunStartedAt,
        nowMs: Date.now()
      }),
    [items, isRunning, activeRunId, activeRunAssistantIds, activeRunStartedAt]
  );
  const forkMarkerBlockKey = useMemo(
    () => resolveForkMarkerBlockKey(blocks, messages, activeSession),
    [activeSession, blocks, messages]
  );
  // 运行中但还没有活跃轮（如 user 消息回显前的瞬间）时，运行中临时块需要兜底挂末尾，避免丢失。
  const hasActiveTurn = blocks.some((block) => block.kind === "turn" && block.active);

  // Resize the tail spacer to keep the anchored message's scroll position
  // reachable, and recompute nearBottom (content can grow without a scroll
  // event). Never moves scrollTop — streaming must not yank the view.
  const syncTailGeometry = useCallback(() => {
    const el = scrollRef.current;
    const spacer = spacerRef.current;
    if (!el || !spacer) {
      return;
    }
    const anchorId = anchorIdRef.current;
    if (anchorId) {
      const node = el.querySelector<HTMLElement>(`[data-message-id="${anchorId}"]`);
      if (!node) {
        console.warn("[ChatView] 锚点消息已不在 DOM，清除锚定", { anchorId });
        anchorIdRef.current = undefined;
        spacer.style.height = "0px";
      } else {
        const top = contentTop(
          node.getBoundingClientRect().top,
          el.getBoundingClientRect().top,
          el.scrollTop
        );
        const next = tailSpacerHeight({
          anchorContentTop: top,
          naturalScrollHeight: el.scrollHeight - spacer.offsetHeight,
          clientHeight: el.clientHeight
        });
        if (spacer.offsetHeight > 0 && next === 0) {
          console.debug("[ChatView] 本轮内容超过一屏，spacer 归零", { anchorId });
        }
        spacer.style.height = `${next}px`;
      }
    }
    setNearBottom(isNearBottom(el));
    syncScrollProgress(el);
  }, [syncScrollProgress]);

  // Anchor a just-sent user message to the viewport top (claude.ai-style).
  // The echo only ever arrives while the run is active; history loads and the
  // post-run reload replace the whole array, so they are told apart by the
  // tail message's id/sessionId rather than by array identity.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const last = messages[messages.length - 1];
    const prev = prevTailRef.current;
    prevTailRef.current = {
      sessionId: last?.sessionId,
      lastId: last?.id,
      length: messages.length
    };

    const isUserEcho =
      isRunning &&
      last?.role === "user" &&
      last.id !== prev?.lastId &&
      (!prev || prev.length === 0 || last.sessionId === prev.sessionId);
    if (isUserEcho) {
      anchorIdRef.current = last.id;
      const node = el.querySelector<HTMLElement>(`[data-message-id="${last.id}"]`);
      const spacer = spacerRef.current;
      if (!node || !spacer) {
        console.warn("[ChatView] 找不到刚发送的用户消息节点，跳过锚定", { id: last.id });
        return;
      }
      const top = contentTop(
        node.getBoundingClientRect().top,
        el.getBoundingClientRect().top,
        el.scrollTop
      );
      // 先撑高 spacer 再写 scrollTop，否则目标位置会被旧的滚动上限钳制。
      spacer.style.height = `${tailSpacerHeight({
        anchorContentTop: top,
        naturalScrollHeight: el.scrollHeight - spacer.offsetHeight,
        clientHeight: el.clientHeight
      })}px`;
      const target = anchorScrollTop(top);
      el.scrollTop = target;
      setNearBottom(isNearBottom(el));
      syncScrollProgress(el);
      console.debug("[ChatView] 锚定用户消息到视口顶部", { id: last.id, target });
      return;
    }

    const historyLoaded = messages.length > 0 && (!prev || last?.sessionId !== prev.sessionId);
    if (historyLoaded) {
      anchorIdRef.current = undefined;
      if (spacerRef.current) {
        spacerRef.current.style.height = "0px";
      }
      el.scrollTop = el.scrollHeight;
      setNearBottom(true);
      syncScrollProgress(el);
      console.debug("[ChatView] 历史加载完成，滚动到底部", { count: messages.length });
    }
  }, [messages, isRunning, syncScrollProgress]);

  // While content streams in, shrink the spacer 1:1 with growth so the view
  // stays put (no auto-scroll — the user may still be reading above).
  useEffect(() => {
    if (typeof window.requestAnimationFrame !== "function") {
      syncTailGeometry();
      return;
    }
    // Coalesce per-delta work into one frame so layout is forced at most once
    // per paint while streaming.
    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
    }
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      syncTailGeometry();
    });
  }, [
    messages,
    toolHistory,
    items,
    streamText,
    thinking,
    pendingTool,
    toolActivity,
    runningTool,
    syncTailGeometry
  ]);

  // Container resizes (window resize, side panels) change the spacer math.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncTailGeometry);
      return () => window.removeEventListener("resize", syncTailGeometry);
    }
    const observer = new ResizeObserver(syncTailGeometry);
    if (scrollRef.current) {
      observer.observe(scrollRef.current);
    }
    return () => observer.disconnect();
  }, [syncTailGeometry]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame?.(scrollFrame.current);
      }
    },
    []
  );

  // 运行中临时块兜底挂末尾时记一笔，便于排查「活跃轮判定异常导致思考/工具状态错位」。
  useEffect(() => {
    if (
      !hasActiveTurn &&
      (showWaiting || hasLiveThinking || Boolean(streamText) || Boolean(liveToolActivityCall))
    ) {
      console.debug("[ChatView] 运行中暂无活跃轮承载临时块，已兜底挂末尾", { activeRunId });
    }
  }, [hasActiveTurn, showWaiting, hasLiveThinking, streamText, liveToolActivityCall, activeRunId]);

  // 单个时间线 item 的渲染分支（与原扁平渲染一致）；index 为其在全局 items 的下标，供
  // shouldHideMessageActions 等依赖全局位置的逻辑使用。
  const renderTimelineItem = (
    item: ChatViewTimelineRenderItem,
    index: number,
    options?: { hideReasoning?: boolean; afterContent?: ReactNode }
  ): ReactNode => {
    if (item.kind === "message") {
      const hideActions = shouldHideMessageActions(item, index, items, activeRunAssistantIds);
      return (
        <MessageBubble
          key={`message-${item.message.id}`}
          message={item.message}
          isLastAssistant={item.message.id === lastAssistantId}
          canEditUserMessage={item.message.id === lastUserMessageId}
          hideActions={hideActions}
          showActionsByDefault={item.message.id === lastActionMessageId}
          hideReasoning={options?.hideReasoning}
          afterContent={options?.afterContent}
        />
      );
    }
    if (item.kind === "run-error") {
      return (
        <RunErrorNotice
          key={`run-error-${item.notice.id}`}
          notice={item.notice}
          canRetry={canRetryFailedNotice(item.notice, messages, isRunning)}
          onRetry={() => {
            console.info("[ChatView] 用户点击失败运行重试", {
              noticeId: item.notice.id,
              persisted: item.notice.persisted
            });
            void regenerateLast();
          }}
        />
      );
    }
    if (item.kind === "plan") {
      return (
        <PlanCard
          key={`plan-${item.plan.anchor.id}`}
          markdown={item.plan.state.markdown}
          status={item.plan.status}
        />
      );
    }
    if (item.kind === "run-file-changes") {
      return (
        <RunFileChangesCard
          key={`run-file-changes-${item.runId}`}
          runId={item.runId}
          fileChanges={item.fileChanges}
        />
      );
    }
    if (item.kind === "tool-group") {
      return (
        <ToolCallGroup
          key={`group-${item.toolCalls[0].id}`}
          toolCalls={item.toolCalls}
          onOpenFile={openFilePreview}
        />
      );
    }
    return (
      <ToolCallRow
        key={`tool-${item.toolCall.id}`}
        toolCall={item.toolCall}
        onOpenFile={openFilePreview}
      />
    );
  };

  // 只有纯文本流式输出才保留 Markdown 内置 caret；thinking/工具/Todo 已经有更具体的运行态提示。
  const hasSpecificRuntimeIndicator =
    hasLiveThinking || Boolean(liveToolActivityCall) || Boolean(runningTool) || Boolean(pendingTool);
  const showStreamingMarkdownCaret = Boolean(streamText) && !hasSpecificRuntimeIndicator;
  const streamCaretDecisionPayload = useMemo(
    () => ({
      activeRunId,
      isRunning,
      streamTextChars: streamText.length,
      hasStreamText: Boolean(streamText),
      liveToolActivity: streamCaretToolSummary(liveToolActivityCall),
      runningTool: streamCaretToolSummary(runningTool),
      pendingTool: streamCaretToolSummary(pendingTool),
      showWaiting,
      hasLiveThinking,
      showCaret: showStreamingMarkdownCaret
    }),
    [
      activeRunId,
      hasLiveThinking,
      isRunning,
      liveToolActivityCall,
      pendingTool,
      runningTool,
      showStreamingMarkdownCaret,
      showWaiting,
      streamText.length
    ]
  );
  const streamCaretDecisionLogKey = useMemo(
    () =>
      streamCaretJsonForLog({
        activeRunId,
        isRunning,
        hasStreamText: Boolean(streamText),
        liveToolActivity: streamCaretToolSummary(liveToolActivityCall),
        runningTool: streamCaretToolSummary(runningTool),
        pendingTool: streamCaretToolSummary(pendingTool),
        showWaiting,
        hasLiveThinking,
        showCaret: showStreamingMarkdownCaret
      }),
    [
      activeRunId,
      hasLiveThinking,
      isRunning,
      liveToolActivityCall,
      pendingTool,
      runningTool,
      showStreamingMarkdownCaret,
      showWaiting,
      streamText
    ]
  );

  useEffect(() => {
    if (!isRunning && !streamText && !liveToolActivityCall && !runningTool && !pendingTool) {
      streamCaretDecisionLogKeyRef.current = undefined;
      return;
    }
    if (streamCaretDecisionLogKeyRef.current === streamCaretDecisionLogKey) {
      return;
    }
    streamCaretDecisionLogKeyRef.current = streamCaretDecisionLogKey;
    console.info(
      "[stream-caret-debug] chat-view-decision " + streamCaretJsonForLog(streamCaretDecisionPayload)
    );
  }, [
    isRunning,
    liveToolActivityCall,
    pendingTool,
    runningTool,
    streamCaretDecisionPayload,
    streamCaretDecisionLogKey,
    streamText
  ]);

  // 运行中的临时块（思考流 / 流式文本 / 工具活动 / 等待），只挂到活跃轮折叠体尾部。
  const runtimeTail =
    hasLiveThinking || streamText || liveToolActivityCall || showWaiting ? (
      <>
        {hasLiveThinking ? (
          <ReasoningPanel
            text={thinking}
            streaming={isStreamingThinking}
            startedAt={thinkingStartedAt}
            durationMs={thinkingDurationMs}
          />
        ) : null}
        {streamText ? (
          <div className="mb-4 animate-msg-in self-stretch">
            <AssistantMarkdownWithArtifacts
              text={streamText}
              streaming
              showCaret={showStreamingMarkdownCaret}
            />
          </div>
        ) : null}
        {liveToolActivityCall ? (
          <ToolCallRow toolCall={liveToolActivityCall} onOpenFile={openFilePreview} />
        ) : null}
        {showWaiting ? (
          <div className="mb-6 flex items-center gap-2 self-stretch text-caption text-muted-foreground">
            <span className="size-3 flex-none animate-pulse rounded-full bg-foreground" />
            <span className="shimmer-text">{t("chat.waiting")}</span>
          </div>
        ) : null}
      </>
    ) : null;

  return (
    // 滚动区铺满主区域；chat-layout-scope 由上层 App 统一提供，与输入框共用同一容器基准。
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      {/* 聊天主滚动条不预留 gutter，避免回复列可用宽度小于底部输入列。 */}
      <div
        ref={scrollRef}
        data-testid="chat-scroll"
        onScroll={() => {
          const el = scrollRef.current;
          if (el) {
            setNearBottom(isNearBottom(el));
            syncScrollProgress(el);
          }
        }}
        className="chat-scroll-area min-h-0 flex-1 overflow-y-auto"
      >
        <div
          ref={contentColumnRef}
          data-testid="chat-content-column"
          className="chat-primary-column relative flex flex-col pt-5 pb-0"
        >
          {blocks.map((block) => (
            <Fragment key={block.key}>
              {block.kind === "standalone" ? (
                renderTimelineItem(block.item, block.index)
              ) : (
                <TurnView
                  block={block}
                  renderItem={renderTimelineItem}
                  runtimeTail={block.active ? runtimeTail : null}
                />
              )}
              {forkMarkerBlockKey === block.key ? <BranchForkMarker /> : null}
            </Fragment>
          ))}

          {!hasActiveTurn ? runtimeTail : null}

          <div
            ref={spacerRef}
            data-testid="chat-tail-spacer"
            aria-hidden="true"
            className="flex-none self-stretch"
          />
          <div
            data-testid="chat-bottom-gap"
            aria-hidden="true"
            className="h-4 flex-none self-stretch"
          />
          <div ref={bottomRef} />
        </div>
      </div>

      {scrollProgress.visible ? (
        <div aria-hidden="true" className="chat-scroll-progress">
          <div
            className="chat-scroll-progress-thumb"
            style={{
              height: `${scrollProgress.height}%`,
              top: `${scrollProgress.top}%`
            }}
          />
        </div>
      ) : null}

      {!nearBottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10">
          <div className="chat-primary-column flex justify-center">
            <ScrollToBottomButton
              onClick={() =>
                bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BranchForkMarker() {
  const { t } = useTranslation();
  const label = t("chat.branchForkMarker");
  return (
    <div
      data-testid="branch-fork-marker"
      aria-label={label}
      className="mb-7 mt-[10px] flex items-center self-stretch px-1 text-link"
    >
      <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
      <span className="mx-4 inline-flex min-w-0 items-center gap-1.5 text-caption font-normal text-link">
        <GitBranchIcon className="size-4 flex-none" />
        <span className="truncate">{label}</span>
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
    </div>
  );
}

/**
 * 一个 AI 轮次的渲染：user 消息在折叠头外、上方；中间过程 + 运行中临时块进 WorkTimer 折叠体；
 * 最终答复在折叠头外、下方。WorkTimer 保持同一实例，在 running -> settled 时自行平滑收起。
 */
function TurnView({
  block,
  renderItem,
  runtimeTail
}: {
  block: TurnBlock;
  renderItem: (
    item: ChatViewTimelineRenderItem,
    index: number,
    options?: { hideReasoning?: boolean; afterContent?: ReactNode }
  ) => ReactNode;
  runtimeTail: ReactNode;
}) {
  // 最终答复自带的「思考过程」也收进折叠头：折叠体里补一个它的 reasoning 面板（时间上在中间过程之后），
  // 答复正文用 hideReasoning 渲染、留在折叠头外。
  const answerMessage = block.answer?.item.message;
  const answerReasoning = answerMessage?.reasoning ? (
    <ReasoningPanel text={answerMessage.reasoning} durationMs={answerMessage.reasoningMs} />
  ) : null;
  const afterAnswerContent =
    block.afterAnswer.length > 0 ? (
      <>{block.afterAnswer.map((member) => renderItem(member.item, member.index))}</>
    ) : null;
  const collapsible =
    block.intermediate.length > 0 || Boolean(answerReasoning) || Boolean(runtimeTail);
  return (
    <>
      {block.user ? renderItem(block.user.item, block.user.index) : null}
      <WorkTimer
        key={block.key}
        timing={block.timing}
        collapsible={collapsible}
      >
        {block.intermediate.map((member) => renderItem(member.item, member.index))}
        {answerReasoning}
        {runtimeTail}
      </WorkTimer>
      {block.answer
        ? renderItem(block.answer.item, block.answer.index, {
            hideReasoning: true,
            afterContent: afterAnswerContent
          })
        : afterAnswerContent}
    </>
  );
}

function RunErrorNotice({
  notice,
  canRetry,
  onRetry
}: {
  notice: FailedRunNotice;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="run-error-notice"
      className="mb-3 flex items-start gap-2 self-stretch rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive"
    >
      <XMarkIcon className="mt-0.5 size-3.5 flex-none" />
      <div className="min-w-0 flex-1">
        <p className="break-words font-mono text-micro">{notice.message}</p>
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-sm border border-destructive/30 bg-background px-2.5 text-caption font-medium text-destructive transition-colors hover:border-destructive/50 hover:bg-destructive/10"
          >
            <RefreshIcon className="size-3.5 flex-none" />
            <span>{t("chat.retryFailedRun")}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// 记忆化消息气泡，流式合帧更新时可跳过已落库消息。
const MessageBubble = memo(function MessageBubble({
  message,
  isLastAssistant = false,
  canEditUserMessage = false,
  hideActions = false,
  showActionsByDefault = false,
  hideReasoning = false,
  afterContent
}: {
  message: Message;
  isLastAssistant?: boolean;
  canEditUserMessage?: boolean;
  hideActions?: boolean;
  showActionsByDefault?: boolean;
  /** 折叠头外的最终答复传 true：它的思考过程改由 TurnView 收进折叠体，正文这里只渲染内容。 */
  hideReasoning?: boolean;
  /** 最终答复正文之后、消息操作按钮之前的本轮尾部内容。 */
  afterContent?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const editAndResend = useAppStore((state) => state.editAndResend);
  const attachments = message.attachments ?? [];
  const parsedAssistant = useMemo(
    () => (message.role === "assistant" ? parseArtifactDeclarations(message.content) : undefined),
    [message.content, message.role]
  );
  if (message.kind === "compaction_summary") {
    return <CompactionCard message={message} />;
  }
  const isUser = message.role === "user";
  if (isUser) {
    if (editing && canEditUserMessage) {
      return (
        <div data-message-id={message.id} className="mb-5 w-[min(560px,90%)] self-end">
          <MessageEditor
            initial={message.content}
            onCancel={() => setEditing(false)}
            onSubmit={(content) => {
              setEditing(false);
              void editAndResend(message.id, content);
            }}
          />
        </div>
      );
    }
    return (
      <div
        data-message-id={message.id}
        className="group/msg mb-5 flex max-w-[78%] animate-msg-in flex-col items-end self-end"
      >
        <div className="max-w-full rounded-lg rounded-tr-none border border-border bg-canvas-soft-2 px-5 py-2.5 text-foreground">
          {attachments.length > 0 ? <UserMessageAttachments attachments={attachments} /> : null}
          {message.content.trim() ? (
            <div
              className={cn(
                "whitespace-pre-wrap break-words text-body-sm",
                attachments.length > 0 && "mt-2"
              )}
            >
              {message.content}
            </div>
          ) : null}
        </div>
        <MessageActions
          message={message}
          onEdit={canEditUserMessage ? () => setEditing(true) : undefined}
          alwaysVisible={showActionsByDefault}
        />
      </div>
    );
  }
  // Reasoning-only turn (the model thought, then went straight to tools):
  // just the settled panel, at its true place before the tool rows.
  if (!message.content.trim()) {
    return (
      <div data-message-id={message.id} className="animate-msg-in self-stretch">
        <ReasoningPanel text={message.reasoning ?? ""} durationMs={message.reasoningMs} />
      </div>
    );
  }
  // Assistant turns render as plain left-aligned content — no avatar, no name —
  // with the persisted reasoning panel (if any) sitting above the answer.
  return (
    <div className="group/msg mb-4 animate-msg-in self-stretch">
      {!hideReasoning && message.reasoning ? (
        <ReasoningPanel text={message.reasoning} durationMs={message.reasoningMs} />
      ) : null}
      <AssistantMarkdownWithArtifacts text={message.content} messageId={message.id} />
      {afterContent}
      {hideActions ? null : (
        <MessageActions
          message={message}
          isLastAssistant={isLastAssistant}
          canFork
          copyContent={parsedAssistant?.cleanMarkdown}
          alwaysVisible={showActionsByDefault}
        />
      )}
    </div>
  );
});

function shouldHideMessageActions(
  item: Extract<ChatViewTimelineRenderItem, { kind: "message" }>,
  currentIndex: number,
  items: ChatViewTimelineRenderItem[],
  activeRunAssistantIds: Set<string>
): boolean {
  const nextItem = items[currentIndex + 1];
  return (
    item.message.role === "assistant" &&
    (activeRunAssistantIds.has(item.message.id) ||
      hasLaterAssistantAnswerInTurn(items, currentIndex) ||
      Boolean(nextItem && nextItem.kind !== "message" && nextItem.kind !== "run-file-changes"))
  );
}

function lastVisibleActionMessageId(
  items: ChatViewTimelineRenderItem[],
  activeRunAssistantIds: Set<string>
): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind !== "message") {
      continue;
    }
    if (item.message.kind === "compaction_summary") {
      continue;
    }
    if (item.message.role === "assistant" && item.message.content.trim().length === 0) {
      continue;
    }
    if (shouldHideMessageActions(item, index, items, activeRunAssistantIds)) {
      continue;
    }
    return item.message.id;
  }
  return undefined;
}

function hasLaterAssistantAnswerInTurn(
  items: ChatViewTimelineRenderItem[],
  currentIndex: number
): boolean {
  for (let index = currentIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "message") {
      continue;
    }
    if (item.message.role === "user") {
      return false;
    }
    if (item.message.role === "assistant" && item.message.content.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function UserMessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  return (
    <div className="flex max-w-full flex-col gap-2">
      {attachments.map((attachment) => (
        <UserMessageAttachment key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

function UserMessageAttachment({ attachment }: { attachment: MessageAttachment }) {
  const { t } = useTranslation();
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const [fileUrl, setFileUrl] = useState<string | undefined>();
  const [imageFailed, setImageFailed] = useState(false);
  const isImage = attachment.kind === "image";

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setFileUrl(undefined);
    setImageFailed(false);
    if (!isImage) {
      return () => {
        disposed = true;
      };
    }
    const bridge = window.chengxiaobang;
    if (!bridge?.readFilePreviewBuffer) {
      console.warn("[ChatView] 图片附件二进制预览能力不可用", {
        id: attachment.id,
        path: attachment.path
      });
      return () => {
        disposed = true;
      };
    }
    void bridge.readFilePreviewBuffer(attachment.path).then((result) => {
      if (disposed) {
        return;
      }
      if (result.ok) {
        objectUrl = URL.createObjectURL(
          new Blob([result.data], { type: attachment.mimeType ?? "image/png" })
        );
        setFileUrl(objectUrl);
        return;
      }
      console.warn("[ChatView] 图片附件二进制预览读取失败", {
        id: attachment.id,
        path: attachment.path,
        error: result.error
      });
    });
    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachment.id, attachment.mimeType, attachment.path, isImage]);

  const open = () => openFilePreview(attachment.path);
  if (isImage && fileUrl && !imageFailed) {
    return (
      <button
        type="button"
        className="flex h-[140px] w-[220px] max-w-full items-center justify-center overflow-hidden rounded-md border border-border bg-background text-left transition-opacity hover:opacity-90"
        onClick={open}
        title={t("chat.openAttachment", { name: attachment.name })}
        aria-label={t("chat.openAttachment", { name: attachment.name })}
      >
        <img
          src={fileUrl}
          alt={t("chat.attachmentImageAlt", { name: attachment.name })}
          onError={() => setImageFailed(true)}
          className="h-full w-full object-contain"
        />
      </button>
    );
  }

  const Icon = FileIcon;
  return (
    <button
      type="button"
      className="flex min-h-[56px] w-[220px] max-w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-body-sm transition-colors hover:bg-muted/70"
      onClick={open}
      title={t("chat.openAttachment", { name: attachment.name })}
      aria-label={t("chat.openAttachment", { name: attachment.name })}
    >
      <Icon className="size-4 flex-none text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{attachment.name}</span>
        <span className="block text-micro text-muted-foreground">
          {formatAttachmentSize(attachment.size)}
        </span>
      </span>
    </button>
  );
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
}

/** System-style card for a /compact summary; collapsed by default. */
function CompactionCard({ message }: { message: Message }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-5 animate-msg-in self-stretch overflow-hidden rounded-sm border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/70"
      >
        <ArchiveBoxIcon className="size-4 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-caption font-medium">{t("chat.compactionTitle")}</span>
          <span className="block truncate text-micro text-muted-foreground">
            {t("chat.compactionHint")}
          </span>
        </span>
        <ChevronIcon
          className={cn(
            "size-4 flex-none text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="border-t px-4 py-3">
          <Markdown text={message.content} className="text-caption" />
        </div>
      ) : null}
    </div>
  );
}
