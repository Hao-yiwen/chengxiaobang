import type { Message, Session, ToolCall } from "@chengxiaobang/shared";
import { timelineItems } from "./timeline";

/** Display labels injected by the caller so this stays i18n-free and pure. */
export interface ExportLabels {
  user: string;
  assistant: string;
  toolCall: string;
  reasoning: string;
  exportedAt: string;
}

export interface ExportOptions {
  includeReasoning?: boolean;
  now?: Date;
}

const RESULT_PREVIEW_LIMIT = 400;

/** Renders a whole conversation as a Markdown document, in timeline order. */
export function buildSessionMarkdown(
  session: Session,
  messages: Message[],
  toolCalls: ToolCall[],
  labels: ExportLabels,
  options: ExportOptions = {}
): string {
  const { includeReasoning = true, now = new Date() } = options;
  const parts: string[] = [`# ${session.title}`, `> ${labels.exportedAt}: ${now.toISOString()}`];

  for (const item of timelineItems(messages, toolCalls)) {
    if (item.kind === "message") {
      const message = item.message;
      if (message.role === "user") {
        parts.push(`## ${labels.user}`, message.content);
      } else if (message.role === "assistant") {
        parts.push(`## ${labels.assistant}`);
        if (includeReasoning && message.reasoning) {
          parts.push(quoted(`**${labels.reasoning}**\n${message.reasoning}`));
        }
        parts.push(message.content);
      }
    } else {
      const toolCall = item.toolCall;
      parts.push(`**${labels.toolCall}** \`${toolCall.name}\` · ${toolCall.status}`);
      if (toolCall.result) {
        parts.push("```\n" + truncate(toolCall.result) + "\n```");
      }
    }
  }
  return parts.join("\n\n") + "\n";
}

/** Title → safe .md filename; strips path separators and control characters. */
export function exportFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
  return `${safe || "session"}.md`;
}

function quoted(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function truncate(text: string): string {
  return text.length > RESULT_PREVIEW_LIMIT ? `${text.slice(0, RESULT_PREVIEW_LIMIT)}…` : text;
}
