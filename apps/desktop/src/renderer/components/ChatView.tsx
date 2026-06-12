import {
  ArchiveIcon as Archive,
  CaretDownIcon as ChevronDown,
  XIcon as X
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Markdown } from "@/components/Markdown";
import { MessageActions, MessageEditor } from "@/components/MessageActions";
import { ReasoningPanel } from "@/components/ReasoningPanel";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { StreamingMarkdown } from "@/components/StreamingMarkdown";
import { ToolCallGroup } from "@/components/ToolCallGroup";
import { ToolCallRow } from "@/components/ToolCallRow";
import { thinkingSeconds } from "@/lib/reasoning";
import { anchorScrollTop, contentTop, isNearBottom, tailSpacerHeight } from "@/lib/scroll";
import { groupTimelineItems, timelineItems } from "@/lib/timeline";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

export type AsideLayout = "gutter-wide" | "gutter-narrow" | "inline";

/** 旁注布局断点纯函数，供测试和后续 AsideNote 接线复用。 */
export function asideLayoutForWidth(width: number): AsideLayout {
  if (width >= 1096) return "gutter-wide";
  if (width >= 916) return "gutter-narrow";
  return "inline";
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
    events,
    lastUsage,
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
      events: state.events,
      lastUsage: state.lastUsage,
      isRunning: state.isRunning,
      activeRunId: state.activeRunId
    }))
  );
  const openFilePreview = useAppStore((state) => state.openFilePreview);

  const scrollRef = useRef<HTMLDivElement>(null);
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

  const showWaiting = isRunning && !streamText && !thinking && !pendingTool;

  // Reasoning-only rows carry no actions, so the "last assistant" affordances
  // (copy/regenerate) stay on the last turn that actually has content.
  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim().length > 0)?.id;
  const items = groupTimelineItems(timelineItems(messages, toolHistory));
  const activeRunAssistantIds = new Set(
    events
      .filter(
        (event) =>
          event.type === "message" &&
          event.runId === activeRunId &&
          event.message.role === "assistant"
      )
      .map((event) => (event.type === "message" ? event.message.id : ""))
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
  }, [messages, toolHistory, streamText, thinking, pendingTool, syncTailGeometry]);

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
    // Full-bleed scroll area with a centered content column; the composer
    // lives outside so the bottom rule and input surface stay stable.
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
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
        <div className="mx-auto flex w-full max-w-[48rem] flex-col py-5">
          {items.map((item, index) => {
            if (item.kind === "message") {
              const nextItem = items[index + 1];
              const hideActions =
                item.message.role === "assistant" &&
                (activeRunAssistantIds.has(item.message.id) ||
                  nextItem?.kind === "tool" ||
                  nextItem?.kind === "tool-group");
              return (
                <MessageBubble
                  key={`message-${item.message.id}`}
                  message={item.message}
                  isLastAssistant={item.message.id === lastAssistantId}
                  hideActions={hideActions}
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
              <StreamingMarkdown text={streamText} className="stream-caret" />
            </div>
          ) : null}

          {showWaiting ? (
            <div className="mb-6 flex items-center gap-2 self-stretch text-caption text-muted-foreground">
              <span className="size-3 flex-none animate-pulse rounded-full bg-foreground" />
              <span className="shimmer-text">{t("chat.waiting")}</span>
            </div>
          ) : null}

          {events
            .filter((event) => event.type === "run_end" && event.status === "failed")
            .map((event, index) => (
              <div
                key={`${event.type}-${index}`}
                className="mb-3 flex items-start gap-2 self-stretch rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-micro text-destructive"
              >
                <X className="mt-0.5 size-3.5 flex-none" />
                <span className="min-w-0 break-words">
                  {event.type === "run_end" ? event.error : null}
                </span>
              </div>
            ))}

          {!isRunning && lastUsage ? (
            <div className="mb-2 self-start text-micro text-muted-slate">
              {t("chat.tokenUsage", {
                total: lastUsage.totalTokens,
                prompt: lastUsage.promptTokens,
                completion: lastUsage.completionTokens
              })}
              {lastUsage.cachedPromptTokens
                ? t("chat.tokenCached", { cached: lastUsage.cachedPromptTokens })
                : ""}
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

      {!nearBottom ? (
        <ScrollToBottomButton
          onClick={() =>
            bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" })
          }
        />
      ) : null}
    </div>
  );
}

// Memoized so per-delta re-renders during streaming skip settled messages —
// the store preserves referential identity of existing message objects.
const MessageBubble = memo(function MessageBubble({
  message,
  isLastAssistant = false,
  hideActions = false
}: {
  message: Message;
  isLastAssistant?: boolean;
  hideActions?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const editAndResend = useAppStore((state) => state.editAndResend);
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
        <div className="rounded-lg bg-bubble-user px-4 py-2.5 text-foreground">
          <div className="whitespace-pre-wrap break-words text-body-sm">
            {message.content}
          </div>
        </div>
        <MessageActions message={message} onEdit={() => setEditing(true)} />
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
      <Markdown text={message.content} />
      {/* 工具间的过渡叙述不标注用时 —— 只有收尾回答展示整轮耗时。 */}
      {message.durationMs !== undefined && !hideActions ? (
        <TurnDuration durationMs={message.durationMs} />
      ) : null}
      {hideActions ? null : <MessageActions message={message} isLastAssistant={isLastAssistant} />}
    </div>
  );
});

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

/** Subtle "用时 N 秒" footer for a completed assistant turn. */
function TurnDuration({ durationMs }: { durationMs: number }) {
  const { t } = useTranslation();
  return (
    <div className="mt-1.5 text-micro text-muted-slate">
      {t("chat.turnDuration", { seconds: thinkingSeconds(durationMs) })}
    </div>
  );
}
