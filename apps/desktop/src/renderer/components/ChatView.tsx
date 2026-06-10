import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Terminal,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message, ToolCall } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/** Distance from the bottom (px) within which we keep auto-scrolling. */
const STICK_TO_BOTTOM_PX = 96;

export function ChatView() {
  const { t } = useTranslation();
  const { messages, toolHistory, streamText, thinking, pendingTool, events, isRunning } =
    useAppStore(
      useShallow((state) => ({
        messages: state.messages,
        toolHistory: state.toolHistory,
        streamText: state.streamText,
        thinking: state.thinking,
        pendingTool: state.pendingTool,
        events: state.events,
        isRunning: state.isRunning
      }))
    );
  const approve = useAppStore((state) => state.approve);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // Keep pinned to the bottom while new content streams in, unless the user
  // scrolled up to read history (then offer a jump-to-bottom button instead).
  useEffect(() => {
    const node = scrollRef.current;
    if (node && stickRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, toolHistory, streamText, thinking, pendingTool, events]);

  function onScroll(): void {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickRef.current = distance < STICK_TO_BOTTOM_PX;
    setShowJump(!stickRef.current);
  }

  function jumpToBottom(): void {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    stickRef.current = true;
    setShowJump(false);
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }

  const showWaiting =
    isRunning && !streamText && !thinking && !pendingTool;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[44rem] flex-col px-6 pb-6 pt-2">
          {timelineItems(messages, toolHistory).map((item) =>
            item.kind === "message" ? (
              <MessageRow key={`message-${item.message.id}`} message={item.message} />
            ) : (
              <ToolCallRow key={`tool-${item.toolCall.id}`} toolCall={item.toolCall} />
            )
          )}

          {thinking ? <ThinkingBlock text={thinking} streaming /> : null}

          {pendingTool ? (
            <div className="mb-5 animate-scale-in self-stretch overflow-hidden rounded-2xl border bg-card shadow-soft">
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <Terminal className="size-4 text-muted-foreground" />
                <span className="text-[13px] font-semibold">{pendingTool.name}</span>
                <span className="text-[12px] text-muted-foreground">
                  {t("chat.approvalTitle")}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4 p-4">
                <pre className="max-h-[220px] min-w-0 flex-1 overflow-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed text-muted-foreground">
                  {JSON.stringify(pendingTool.args, null, 2)}
                </pre>
                <div className="flex flex-none flex-col items-stretch gap-2">
                  <Button size="sm" className="rounded-full" onClick={() => approve(pendingTool.id, true)}>
                    <Check className="size-4" />
                    {t("chat.run")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => approve(pendingTool.id, false)}
                  >
                    <X className="size-4" />
                    {t("chat.reject")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {streamText ? (
            <div className="mb-6 animate-msg-in self-stretch">
              <Markdown text={streamText} className="stream-caret" />
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
                className="mb-3 flex items-start gap-2 self-stretch rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive"
              >
                <X className="mt-0.5 size-3.5 flex-none" />
                <span className="min-w-0 break-words">{event.error}</span>
              </div>
            ))}
        </div>
      </div>

      {showJump ? (
        <button
          type="button"
          title={t("chat.scrollToBottom")}
          onClick={jumpToBottom}
          className="absolute bottom-4 left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-foreground shadow-elevated transition-colors hover:bg-accent"
        >
          <ArrowDown className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** Hover-revealed copy button with success feedback, used under messages. */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.warn("复制到剪贴板失败", error);
    }
  }

  return (
    <button
      type="button"
      title={copied ? t("chat.copied") : t("chat.copy")}
      aria-label={copied ? t("chat.copied") : t("chat.copy")}
      onClick={() => void copy()}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/**
 * Collapsible reasoning block. While streaming it shows a shimmering label and
 * stays expanded; once the answer lands it collapses to a quiet toggle that
 * the user can reopen at any time (the text is persisted with the message).
 */
function ThinkingBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(streaming);
  return (
    <div className={cn("self-stretch", streaming ? "mb-5 animate-msg-in" : "mb-2.5")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span className={cn(streaming && "shimmer-text")}>{t("chat.thinking")}</span>
      </button>
      {open ? (
        <div className="mt-1.5 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted-foreground">
          {text}
        </div>
      ) : null}
    </div>
  );
}

const TOOL_STATUS_KEYS = {
  completed: "chat.toolStatus.completed",
  failed: "chat.toolStatus.failed",
  rejected: "chat.toolStatus.rejected",
  running: "chat.toolStatus.running",
  pending_approval: "chat.toolStatus.pendingApproval"
} as const satisfies Record<ToolCall["status"], string>;

function ToolCallRow({ toolCall }: { toolCall: ToolCall }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const isRunning = toolCall.status === "running" || toolCall.status === "pending_approval";
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";
  return (
    <div className="mb-3 max-w-full self-start overflow-hidden rounded-xl border bg-surface/60">
      <button
        type="button"
        onClick={() => toolCall.result && setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs",
          toolCall.result && "transition-colors hover:bg-accent/60"
        )}
      >
        {isRunning ? (
          <Loader2 className="size-3.5 flex-none animate-spin text-muted-foreground" />
        ) : isError ? (
          <X className="size-3.5 flex-none text-destructive" />
        ) : (
          <Check className="size-3.5 flex-none text-muted-foreground" />
        )}
        <span className="font-semibold text-foreground">{toolCall.name}</span>
        <span className="text-muted-foreground">{t(TOOL_STATUS_KEYS[toolCall.status])}</span>
        {toolCall.result ? (
          <ChevronRight
            className={cn(
              "ml-auto size-3.5 flex-none text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
        ) : null}
      </button>
      {toolCall.result ? (
        open ? (
          <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words border-t bg-background px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {toolCall.result}
          </pre>
        ) : (
          <pre className="max-h-[1.6rem] overflow-hidden whitespace-pre-wrap break-words border-t bg-background px-3 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground/60">
            {toolCall.result}
          </pre>
        )
      ) : null}
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="group mb-5 flex max-w-[78%] animate-msg-in flex-col items-end self-end">
        <div className="rounded-3xl bg-bubble-user px-4 py-2.5 text-foreground">
          <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">
            {message.content}
          </div>
        </div>
        <div className="mt-1 h-7 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton text={message.content} />
        </div>
      </div>
    );
  }
  return (
    <div className="group mb-5 animate-msg-in self-stretch">
      {message.thinking ? <ThinkingBlock text={message.thinking} /> : null}
      <Markdown text={message.content} />
      <div className="mt-1.5 h-7 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton text={message.content} className="-ml-1.5" />
      </div>
    </div>
  );
}

type TimelineItem =
  | { kind: "message"; at: string; message: Message }
  | { kind: "tool"; at: string; toolCall: ToolCall };

function timelineItems(messages: Message[], toolCalls: ToolCall[]): TimelineItem[] {
  return [
    // Tool-role messages duplicate the tool card's result panel — skip them.
    ...messages
      .filter((message) => message.role !== "tool")
      .map((message) => ({
        kind: "message" as const,
        at: message.createdAt,
        message
      })),
    ...toolCalls.map((toolCall) => ({
      kind: "tool" as const,
      at: toolCall.updatedAt,
      toolCall
    }))
  ].sort((left, right) => left.at.localeCompare(right.at));
}
