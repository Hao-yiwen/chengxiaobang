import { Check, ChevronRight, FileText, Loader2, Terminal, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message, ToolCall } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";
import { MessageActions, MessageEditor } from "@/components/MessageActions";
import { ReasoningPanel } from "@/components/ReasoningPanel";
import { ScrollToBottomButton } from "@/components/ScrollToBottomButton";
import { thinkingSeconds } from "@/lib/reasoning";
import { isNearBottom } from "@/lib/scroll";
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
  const [nearBottom, setNearBottom] = useState(true);

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
    if (near) {
      // `scrollIntoView` is absent under jsdom — optional-call so tests don't throw.
      bottomRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [messages, toolHistory, streamText, thinking, pendingTool]);

  return (
    <div className="relative flex w-[min(760px,100%)] min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-testid="chat-scroll"
        onScroll={() => {
          const el = scrollRef.current;
          if (el) {
            setNearBottom(isNearBottom(el));
          }
        }}
        className="flex min-h-0 flex-1 flex-col overflow-auto py-2"
      >
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
            <Markdown text={streamText} className="stream-caret" />
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

const TOOL_STATUS_STYLES: Record<ToolCall["status"], string> = {
  completed: "text-foreground",
  failed: "text-destructive",
  rejected: "text-destructive",
  running: "text-muted-foreground",
  pending_approval: "text-foreground"
};

/** File tools whose `path` argument can be opened in the right-panel preview. */
const FILE_PREVIEW_TOOLS = new Set<ToolCall["name"]>(["read_file", "write_file", "edit_file"]);

function ToolCallRow({ toolCall }: { toolCall: ToolCall }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openFilePreview = useAppStore((state) => state.openFilePreview);
  const isRunning = toolCall.status === "running" || toolCall.status === "pending_approval";
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";
  const accent = TOOL_STATUS_STYLES[toolCall.status] ?? "text-muted-foreground";
  const filePath =
    FILE_PREVIEW_TOOLS.has(toolCall.name) && typeof toolCall.args.path === "string"
      ? toolCall.args.path
      : undefined;
  return (
    <div className="mb-3 self-start overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => toolCall.result && setOpen((value) => !value)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left font-mono text-xs",
            toolCall.result && "transition-colors hover:bg-muted/70"
          )}
        >
          {isRunning ? (
            <Loader2 className={cn("size-3.5 flex-none animate-spin", accent)} />
          ) : isError ? (
            <X className={cn("size-3.5 flex-none", accent)} />
          ) : (
            <Check className={cn("size-3.5 flex-none", accent)} />
          )}
          <span className="font-semibold text-foreground">{toolCall.name}</span>
          <span className="text-muted-foreground">{toolCall.status}</span>
          {toolCall.result ? (
            <ChevronRight
              className={cn(
                "ml-auto size-3.5 flex-none text-muted-foreground transition-transform",
                open && "rotate-90"
              )}
            />
          ) : null}
        </button>
        {filePath ? (
          <button
            type="button"
            title={t("chat.previewFile")}
            onClick={() => openFilePreview(filePath)}
            className="mr-2 flex max-w-[220px] flex-none items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FileText className="size-3 flex-none" />
            <span className="truncate">{filePath}</span>
          </button>
        ) : null}
      </div>
      {toolCall.result ? (
        open ? (
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-t bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {toolCall.result}
          </pre>
        ) : (
          <pre className="max-h-[1.5rem] overflow-hidden whitespace-pre-wrap break-words border-t bg-background/60 px-3 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground/70">
            {toolCall.result}
          </pre>
        )
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
      <div className="group/msg mb-5 flex max-w-[80%] flex-col items-end self-end">
        <div className="animate-msg-in rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground shadow-soft">
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

/** Subtle "用时 N 秒" footer for a completed assistant turn. */
function TurnDuration({ durationMs }: { durationMs: number }) {
  const { t } = useTranslation();
  return (
    <div className="mt-1.5 text-[11px] text-muted-foreground/70">
      {t("chat.turnDuration", { seconds: thinkingSeconds(durationMs) })}
    </div>
  );
}

type TimelineItem =
  | { kind: "message"; at: string; message: Message }
  | { kind: "tool"; at: string; toolCall: ToolCall };

function timelineItems(messages: Message[], toolCalls: ToolCall[]): TimelineItem[] {
  return [
    // Tool-role messages are rendered as tool-call rows, not chat bubbles.
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
