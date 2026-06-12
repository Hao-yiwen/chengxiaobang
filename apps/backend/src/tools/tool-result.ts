import type { AgentToolResult } from "@earendil-works/pi-agent-core";

/** Wrap a plain string as the text-only tool result every builtin tool returns. */
export function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}
