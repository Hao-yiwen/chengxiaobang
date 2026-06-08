import { Check, ChevronRight, Loader2, Terminal, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message, ToolCall } from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

export function ChatView() {
  const { t } = useTranslation();
  const { messages, toolHistory, streamText, thinking, pendingTool, events, lastUsage, isRunning } =
    useAppStore(
      useShallow((state) => ({
        messages: state.messages,
        toolHistory: state.toolHistory,
        streamText: state.streamText,
        thinking: state.thinking,
        pendingTool: state.pendingTool,
        events: state.events,
        lastUsage: state.lastUsage,
        isRunning: state.isRunning
      }))
    );
  const approve = useAppStore((state) => state.approve);

  return (
    <div className="flex w-[min(760px,100%)] min-h-0 flex-1 flex-col overflow-auto py-2">
      {timelineItems(messages, toolHistory).map((item) =>
        item.kind === "message" ? (
          <MessageBubble key={`message-${item.message.id}`} message={item.message} />
        ) : (
          <ToolCallRow key={`tool-${item.toolCall.id}`} toolCall={item.toolCall} />
        )
      )}

      {thinking ? (
        <div className="mb-5 flex animate-msg-in gap-3 self-stretch">
          <Avatar pulsing />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="shimmer-text mb-1 text-[12px] font-semibold">{t("chat.thinking")}</div>
            <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-muted-foreground">
              {thinking}
            </div>
          </div>
        </div>
      ) : null}

      {pendingTool ? (
        <div className="mb-5 animate-scale-in self-stretch overflow-hidden rounded-xl border border-amber/40 bg-card shadow-soft">
          <div className="flex items-center gap-2 border-b border-amber/30 bg-amber/10 px-4 py-2.5">
            <Terminal className="size-4 text-amber" />
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
        <div className="mb-5 flex animate-msg-in gap-3 self-stretch">
          <Avatar />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="mb-1 text-[12px] font-semibold text-muted-foreground">
              {t("chat.roleAssistant")}
            </div>
            <Markdown text={streamText} className="stream-caret" />
          </div>
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
    </div>
  );
}

function Avatar({ pulsing }: { pulsing?: boolean }) {
  return (
    <div
      className={cn(
        "flex size-8 flex-none items-center justify-center rounded-lg border border-brand/15 bg-brand-soft shadow-soft",
        pulsing && "animate-pulse"
      )}
    >
      <Logo className="size-[22px]" />
    </div>
  );
}

const TOOL_STATUS_STYLES: Record<ToolCall["status"], string> = {
  completed: "text-brand",
  failed: "text-destructive",
  rejected: "text-destructive",
  running: "text-muted-foreground",
  pending_approval: "text-amber"
};

function ToolCallRow({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = useState(false);
  const isRunning = toolCall.status === "running" || toolCall.status === "pending_approval";
  const isError = toolCall.status === "failed" || toolCall.status === "rejected";
  const accent = TOOL_STATUS_STYLES[toolCall.status] ?? "text-muted-foreground";
  return (
    <div className="mb-3 self-start overflow-hidden rounded-lg border bg-muted/40">
      <button
        type="button"
        onClick={() => toolCall.result && setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs",
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

function MessageBubble({ message }: { message: Message }) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  if (isUser) {
    return (
      <div className="mb-5 max-w-[80%] animate-msg-in self-end rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground shadow-soft">
        <div className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="mb-5 flex animate-msg-in gap-3 self-stretch">
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 text-[12px] font-semibold text-muted-foreground">
          {t(roleLabel(message.role))}
        </div>
        <Markdown text={message.content} />
      </div>
    </div>
  );
}

type RoleKey =
  | "chat.roleUser"
  | "chat.roleAssistant"
  | "chat.roleTool"
  | "chat.roleSystem";

function roleLabel(role: Message["role"]): RoleKey {
  if (role === "user") {
    return "chat.roleUser";
  }
  if (role === "assistant") {
    return "chat.roleAssistant";
  }
  if (role === "tool") {
    return "chat.roleTool";
  }
  return "chat.roleSystem";
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
