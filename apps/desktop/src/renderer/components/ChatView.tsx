import {
  ArchiveIcon as Archive,
  ArrowClockwiseIcon as RefreshCw,
  CaretDownIcon as ChevronDown,
  FileIcon as FileAttachment,
  FileImageIcon as FileImage,
  XIcon as X
} from "@phosphor-icons/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useTranslation } from "react-i18next";
import type { Message, MessageAttachment, RunRecord, StreamEvent, ToolCall } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { AssistantMarkdownWithArtifacts } from "@/components/AssistantMarkdownWithArtifacts";
import { ArtifactFloatingPanel } from "@/components/ArtifactFloatingPanel";
import { Markdown } from "@/components/Markdown";
import { MessageActions, MessageEditor } from "@/components/MessageActions";
import { PlanCard } from "@/components/PlanCard";
import { ProgressFloatingPanel } from "@/components/ProgressFloatingPanel";
import { ReasoningPanel } from "@/components/ReasoningPanel";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { ToolActivityStatus } from "@/components/ToolActivityStatus";
import { ToolCallGroup } from "@/components/ToolCallGroup";
import { ToolCallRow } from "@/components/ToolCallRow";
import { parseArtifactDeclarations } from "@/lib/artifact";
import { anchorScrollTop, contentTop, isNearBottom, tailSpacerHeight } from "@/lib/scroll";
import {
  derivePlanView,
  groupTimelineItems,
  timelineItems,
  type GroupedTimelineItem,
  type PlanView
} from "@/lib/timeline";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

type PlanTimelineItem = { kind: "plan"; at: string; plan: PlanView };
type ChatViewTimelineItem = GroupedTimelineItem | PlanTimelineItem;
type FailedRunNotice = {
  id: string;
  message: string;
  at: string;
  persisted: boolean;
};
type RunErrorTimelineItem = { kind: "run-error"; at: string; notice: FailedRunNotice };

type ChatViewTimelineRenderItem = ChatViewTimelineItem | RunErrorTimelineItem;

const FAILED_RUN_FALLBACK = "运行失败，但未记录错误详情";

function isFailedRunEndEvent(
  event: StreamEvent
): event is Extract<StreamEvent, { type: "run_end" }> & { status: "failed" } {
  return event.type === "run_end" && event.status === "failed";
}

function chatViewTimelineItems(
  messages: Message[],
  toolCalls: ToolCall[],
  failedNotices: FailedRunNotice[],
  activeRunId?: string
): ChatViewTimelineRenderItem[] {
  const groupedItems = groupTimelineItems(timelineItems(messages, toolCalls));
  const chronologicalItems: ChatViewTimelineRenderItem[] = [
    ...groupedItems,
    ...failedNotices.map((notice) => ({
      kind: "run-error" as const,
      at: notice.at,
      notice
    }))
  ].sort((left, right) => left.at.localeCompare(right.at));
  const result: ChatViewTimelineRenderItem[] = [];

  for (const item of chronologicalItems) {
    if (item.kind === "run-error") {
      result.push(item);
      continue;
    }
    if (
      item.kind === "tool" &&
      (item.toolCall.name === "todo_create" ||
        item.toolCall.name === "todo_update" ||
        item.toolCall.name === "update_plan")
    ) {
      continue;
    }
    if (item.kind === "tool" && item.toolCall.name === "propose_plan") {
      const plan = derivePlanView(
        toolCalls.filter((toolCall) => toolCall.name === "propose_plan"),
        { activeRunId }
      );
      const visiblePlan =
        plan?.anchor.id === item.toolCall.id
          ? plan
          : derivePlanView([item.toolCall], { activeRunId });
      if (visiblePlan) {
        result.push({ kind: "plan", at: item.at, plan: visiblePlan });
      }
      continue;
    }
    result.push(item);
  }

  return result;
}

function toolCallsWithPendingPlan(toolCalls: ToolCall[], pendingTool?: ToolCall): ToolCall[] {
  if (!pendingTool || pendingTool.name !== "propose_plan") {
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

function failedRunNotices(runs: RunRecord[], events: StreamEvent[]): FailedRunNotice[] {
  const persisted = runs
    .filter((run) => run.status === "failed")
    .map((run) => ({
      id: run.id,
      message: run.error ?? FAILED_RUN_FALLBACK,
      at: run.updatedAt,
      persisted: true
    }));
  const persistedIds = new Set(persisted.map((notice) => notice.id));
  const live = events
    .filter(isFailedRunEndEvent)
    .filter((event) => !persistedIds.has(event.runId))
    .map((event, index) => ({
      id: `live-${event.runId}-${index}`,
      message: event.error ?? FAILED_RUN_FALLBACK,
      at: "\uffff",
      persisted: false
    }));
  return [...persisted, ...live].sort((left, right) => left.at.localeCompare(right.at));
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

export function ChatView() {
  const { t } = useTranslation();
  const {
    messages,
    toolHistory,
    streamText,
    thinking,
    thinkingStartedAt,
    pendingTool,
    toolActivity,
    runningTool,
    events,
    runHistory,
    isRunning,
    activeRunId
  } = useAppStore(
    useShallow((state) => ({
      messages: state.messages,
      toolHistory: state.toolHistory,
      streamText: state.streamText,
      thinking: state.thinking,
      thinkingStartedAt: state.thinkingStartedAt,
      pendingTool: state.pendingTool,
      toolActivity: state.toolActivity,
      runningTool: state.runningTool,
      events: state.events,
      runHistory: state.runHistory,
      isRunning: state.isRunning,
      activeRunId: state.activeRunId
    }))
  );
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const regenerateLast = useAppStore((state) => state.regenerateLast);

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
  const [nearBottom, setNearBottom] = useState(true);

  const hasActiveTimelineTool = Boolean(runningTool);
  const showActivityStatus =
    isRunning &&
    !streamText &&
    !thinking &&
    !pendingTool &&
    !hasActiveTimelineTool &&
    Boolean(toolActivity);
  const showWaiting =
    isRunning &&
    !streamText &&
    !thinking &&
    !pendingTool &&
    !showActivityStatus &&
    !hasActiveTimelineTool;

  // Reasoning-only rows carry no actions, so the "last assistant" affordances
  // (copy/regenerate) stay on the last turn that actually has content.
  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim().length > 0)?.id;
  const failedNotices = useMemo(
    () => failedRunNotices(runHistory, events),
    [runHistory, events]
  );
  const timelineToolCalls = useMemo(
    () => toolCallsWithPendingPlan(toolHistory, pendingTool),
    [toolHistory, pendingTool]
  );
  const items = useMemo(
    () => chatViewTimelineItems(messages, timelineToolCalls, failedNotices, activeRunId),
    [messages, timelineToolCalls, failedNotices, activeRunId]
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
  }, []);

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
      console.debug("[ChatView] 历史加载完成，滚动到底部", { count: messages.length });
    }
  }, [messages, isRunning]);

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

  return (
    // 滚动区铺满主区域；内容列由共享布局左偏，和底部输入列保持同一个锚点。
    <div className="chat-layout-scope relative flex min-h-0 w-full flex-1 flex-col">
      <div
        ref={scrollRef}
        data-testid="chat-scroll"
        onScroll={() => {
          const el = scrollRef.current;
          if (el) {
            setNearBottom(isNearBottom(el));
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto px-12"
      >
        <div
          ref={contentColumnRef}
          data-testid="chat-content-column"
          className="chat-primary-column relative flex flex-col py-5"
        >
          {items.map((item, index) => {
            if (item.kind === "message") {
              const hideActions = shouldHideMessageActions(
                item,
                index,
                items,
                activeRunAssistantIds
              );
              return (
                <MessageBubble
                  key={`message-${item.message.id}`}
                  message={item.message}
                  isLastAssistant={item.message.id === lastAssistantId}
                  hideActions={hideActions}
                  showActionsByDefault={item.message.id === lastActionMessageId}
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
          })}

          {thinking ? (
            <ReasoningPanel text={thinking} streaming startedAt={thinkingStartedAt} />
          ) : null}

          {streamText ? (
            <div className="mb-5 animate-msg-in self-stretch">
              <AssistantMarkdownWithArtifacts text={streamText} streaming />
            </div>
          ) : null}

          {showActivityStatus ? (
            <ToolActivityStatus
              toolActivity={toolActivity}
              runningTool={runningTool}
              className="mb-6 self-stretch"
            />
          ) : null}

          {showWaiting ? (
            <div className="mb-6 flex items-center gap-2 self-stretch text-caption text-muted-foreground">
              <span className="size-3 flex-none animate-pulse rounded-full bg-foreground" />
              <span className="shimmer-text">{t("chat.waiting")}</span>
            </div>
          ) : null}

          <div
            ref={spacerRef}
            data-testid="chat-tail-spacer"
            aria-hidden="true"
            className="flex-none self-stretch"
          />
          <div ref={bottomRef} />
        </div>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-5 bg-gradient-to-b from-background/0 to-background/75"
      />

      <div data-testid="chat-floating-stack" className="chat-floating-stack">
        <ArtifactFloatingPanel />
        <ProgressFloatingPanel />
      </div>

      {!nearBottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 px-12">
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
      <X className="mt-0.5 size-3.5 flex-none" />
      <div className="min-w-0 flex-1">
        <p className="break-words font-mono text-micro">{notice.message}</p>
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-sm border border-destructive/30 bg-background px-2.5 text-caption font-medium text-destructive transition-colors hover:border-destructive/50 hover:bg-destructive/10"
          >
            <RefreshCw className="size-3.5 flex-none" />
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
  hideActions = false,
  showActionsByDefault = false
}: {
  message: Message;
  isLastAssistant?: boolean;
  hideActions?: boolean;
  showActionsByDefault?: boolean;
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
    if (editing) {
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
        <div className="max-w-full rounded-lg bg-bubble-user px-4 py-2.5 text-foreground">
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
          onEdit={() => setEditing(true)}
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
    <div className="group/msg mb-5 animate-msg-in self-stretch">
      {message.reasoning ? (
        <ReasoningPanel text={message.reasoning} durationMs={message.reasoningMs} />
      ) : null}
      <AssistantMarkdownWithArtifacts text={message.content} messageId={message.id} />
      {hideActions ? null : (
        <MessageActions
          message={message}
          isLastAssistant={isLastAssistant}
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
      Boolean(nextItem && nextItem.kind !== "message"))
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

  const Icon = isImage ? FileImage : FileAttachment;
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
        <Archive className="size-4 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-caption font-medium">{t("chat.compactionTitle")}</span>
          <span className="block truncate text-micro text-muted-foreground">
            {t("chat.compactionHint")}
          </span>
        </span>
        <ChevronDown
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
