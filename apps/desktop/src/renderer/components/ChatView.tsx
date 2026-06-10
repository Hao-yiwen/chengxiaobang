import { Archive, Check, ChevronDown, Terminal, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";
import { MessageActions, MessageEditor } from "@/components/MessageActions";
import { ReasoningPanel } from "@/components/ReasoningPanel";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { StreamingMarkdown } from "@/components/StreamingMarkdown";
import { ToolCallRow } from "@/components/ToolCallRow";
import { thinkingSeconds } from "@/lib/reasoning";
import { isNearBottom } from "@/lib/scroll";
import { timelineItems } from "@/lib/timeline";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

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
    isRunning
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
      isRunning: state.isRunning
    }))
  );
  const approve = useAppStore((state) => state.approve);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const [nearBottom, setNearBottom] = useState(true);

  const showWaiting = isRunning && !streamText && !thinking && !pendingTool;

  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;

  // Keep the newest content in view while streaming, but only when the user is
  // already near the bottom — never yank them back up if they've scrolled away.
  // Content can grow without a scroll event, so nearBottom is recomputed here
  // as well as in the scroll handler.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const near = isNearBottom(el);
    setNearBottom(near);
    if (!near) {
      return;
    }
    // `scrollIntoView` is absent under jsdom — optional-call so tests don't throw.
    if (typeof window.requestAnimationFrame !== "function") {
      bottomRef.current?.scrollIntoView?.({ block: "end" });
      return;
    }
    // Coalesce per-delta snaps into one frame so layout is forced at most once
    // per paint while streaming (DeepSeek-GUI's use-timeline-scroll approach).
    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
    }
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      bottomRef.current?.scrollIntoView?.({ block: "end" });
    });
  }, [messages, toolHistory, streamText, thinking, pendingTool]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame?.(scrollFrame.current);
      }
    },
    []
  );

  return (
    // Full-bleed scroll area with a centered content column, matching the
    // ChatGPT-style app layout (the composer lives outside, in App).
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
        className="min-h-0 flex-1 overflow-y-auto px-6"
      >
        <div className="mx-auto flex w-full max-w-[44rem] flex-col py-3">
          {timelineItems(messages, toolHistory).map((item) =>
            item.kind === "message" ? (
              <MessageBubble
                key={`message-${item.message.id}`}
                message={item.message}
                isLastAssistant={item.message.id === lastAssistantId}
              />
            ) : (
              <ToolCallRow key={`tool-${item.toolCall.id}`} toolCall={item.toolCall} />
            )
          )}

          {thinking ? (
            <ReasoningPanel text={thinking} streaming startedAt={thinkingStartedAt} />
          ) : null}

          {pendingTool ? (
            <div className="mb-5 animate-scale-in self-stretch overflow-hidden rounded-xl border bg-card shadow-soft">
              <div className="flex items-center gap-2 border-b bg-muted/60 px-4 py-2.5">
                <Terminal className="size-4 text-muted-foreground" />
                <span className="text-[13px] font-semibold">{pendingTool.name}</span>
              </div>
              <div className="flex items-start justify-between gap-4 p-4">
                <pre className="min-w-0 flex-1 max-h-[220px] overflow-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
                  {JSON.stringify(pendingTool.args, null, 2)}
                </pre>
                <div className="flex flex-none flex-col items-stretch gap-2">
                  <Button size="sm" onClick={() => approve(pendingTool.id, true)}>
                    <Check className="size-4" />
                    {t("chat.run")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => approve(pendingTool.id, false)}>
                    <X className="size-4" />
                    {t("chat.reject")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {streamText ? (
            <div className="mb-5 animate-msg-in self-stretch">
              <StreamingMarkdown text={streamText} className="stream-caret" />
            </div>
          ) : null}

          {showWaiting ? (
            <div className="mb-6 flex items-center gap-2 self-stretch text-[13.5px] text-muted-foreground">
              <span className="size-3 flex-none animate-pulse rounded-full bg-foreground" />
              <span className="shimmer-text">{t("chat.waiting")}</span>
            </div>
          ) : null}

          {events
            .filter((event) => event.type === "run_error")
            .map((event, index) => (
              <div
                key={`${event.type}-${index}`}
                className="mb-3 flex items-start gap-2 self-stretch rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive"
              >
                <X className="mt-0.5 size-3.5 flex-none" />
                <span className="min-w-0 break-words">{event.error}</span>
              </div>
            ))}

          {!isRunning && lastUsage ? (
            <div className="mb-2 self-start text-[11px] text-muted-foreground/70">
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
  isLastAssistant = false
}: {
  message: Message;
  isLastAssistant?: boolean;
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
        <div className="mb-5 w-[min(560px,90%)] self-end">
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
      <div className="group/msg mb-5 flex max-w-[78%] animate-msg-in flex-col items-end self-end">
        <div className="rounded-3xl bg-bubble-user px-4 py-2.5 text-foreground">
          <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">
            {message.content}
          </div>
        </div>
        <MessageActions message={message} onEdit={() => setEditing(true)} />
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
      {message.durationMs !== undefined ? <TurnDuration durationMs={message.durationMs} /> : null}
      <MessageActions message={message} isLastAssistant={isLastAssistant} />
    </div>
  );
});

/** System-style card for a /compact summary; collapsed by default. */
function CompactionCard({ message }: { message: Message }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-5 animate-msg-in self-stretch overflow-hidden rounded-xl border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/70"
      >
        <Archive className="size-4 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">{t("chat.compactionTitle")}</span>
          <span className="block truncate text-xs text-muted-foreground">
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
          <Markdown text={message.content} className="text-[13.5px]" />
        </div>
      ) : null}
    </div>
  );
}

/** Subtle "用时 N 秒" footer for a completed assistant turn. */
function TurnDuration({ durationMs }: { durationMs: number }) {
  const { t } = useTranslation();
  return (
    <div className="mt-1.5 text-[11px] text-muted-foreground/70">
      {t("chat.turnDuration", { seconds: thinkingSeconds(durationMs) })}
    </div>
  );
}

