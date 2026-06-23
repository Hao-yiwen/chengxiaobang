import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import {
  nowIso,
  type AgentDebugTool,
  type Message,
  type MessageAttachment,
  type RunImageAttachment,
  type ToolCallApproval,
  toolMetadata
} from "@chengxiaobang/shared";
import { requiresApproval } from "../tools/registry";

export function toAgentDebugTool(tool: AgentTool<any>): AgentDebugTool {
  const metadata = toolMetadata(tool.name);
  return {
    name: tool.name,
    ...(tool.label ? { label: tool.label } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    requiresApproval: requiresApproval(tool.name),
    readOnly: metadata.readOnly,
    mutating: metadata.mutating,
    destructive: metadata.destructive,
    concurrencySafe: metadata.concurrencySafe,
    searchHint: metadata.searchHint,
    deferPolicy: metadata.deferPolicy,
    maxInlineResultChars: metadata.maxInlineResultChars,
    category: metadata.category
  };
}

export function toolResultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function markSmartApprovalUserDecision(
  approval: ToolCallApproval,
  approved: boolean
): ToolCallApproval {
  return {
    ...approval,
    userDecision: {
      approved,
      decidedAt: nowIso()
    }
  };
}

export function displayPromptForTitle(
  content: string,
  attachments: MessageAttachment[]
): string {
  const trimmed = content.trim();
  if (trimmed) {
    return trimmed;
  }
  if (attachments.length === 0) {
    return "新对话";
  }
  return `附件：${attachments.map((attachment) => attachment.name).join("、")}`;
}

export function buildUserPiMessage(
  content: string,
  attachments: RunImageAttachment[]
): UserMessage {
  if (attachments.length === 0) {
    return { role: "user", content, timestamp: Date.now() };
  }
  return {
    role: "user",
    content: [
      { type: "text", text: content },
      ...attachments.map((attachment) => ({
        type: "image" as const,
        data: attachment.dataBase64,
        mimeType: attachment.mimeType
      }))
    ],
    timestamp: Date.now()
  };
}

export function toClientMessage(
  { payload: _payload, ...message }: { payload?: string } & Message
): Message & { attachments: MessageAttachment[] } {
  return {
    ...message,
    attachments: message.attachments ?? []
  };
}
