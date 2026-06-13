import type { Message, Session, ToolCall } from "@chengxiaobang/shared";
import { parseArtifactDeclarations } from "./artifact";
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
        const body = [
          ...(message.attachments?.length
            ? [`附件：${message.attachments.map((attachment) => attachment.name).join("、")}`]
            : []),
          ...(message.content.trim() ? [message.content] : [])
        ];
        parts.push(`## ${labels.user}`, ...body);
      } else if (message.role === "assistant") {
        // Reasoning-only turns export their reasoning quote alone; with
        // reasoning excluded they would be empty, so skip them entirely.
        const body: string[] = [];
        if (includeReasoning && message.reasoning) {
          body.push(quoted(`**${labels.reasoning}**\n${message.reasoning}`));
        }
        const cleanContent = parseArtifactDeclarations(message.content).cleanMarkdown;
        if (cleanContent.trim()) {
          body.push(cleanContent);
        }
        if (body.length > 0) {
          parts.push(`## ${labels.assistant}`, ...body);
        }
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
