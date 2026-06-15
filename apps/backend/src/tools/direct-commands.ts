import type { ToolName } from "@chengxiaobang/shared";

export interface ToolRequest {
  name: ToolName;
  args: Record<string, unknown>;
}

/** Parse the direct slash commands that run a single builtin tool without the model. */
export function parseToolRequest(prompt: string): ToolRequest | undefined {
  const trimmed = prompt.trim();
  if (trimmed.startsWith("/ls")) {
    return { name: "LS", args: { path: trimmed.slice(3).trim() || "." } };
  }
  if (trimmed.startsWith("/read ")) {
    return { name: "Read", args: { file_path: trimmed.slice(6).trim() } };
  }
  if (trimmed.startsWith("/write ")) {
    const [, targetAndContent = ""] = trimmed.split("/write ");
    const [target, ...contentLines] = targetAndContent.split("\n");
    return {
      name: "Write",
      args: { file_path: target.trim(), content: contentLines.join("\n") }
    };
  }
  if (trimmed.startsWith("/shell ")) {
    return { name: "Bash", args: { command: trimmed.slice(7).trim() } };
  }
  if (trimmed === "/git status") {
    return { name: "GitStatus", args: {} };
  }
  if (trimmed === "/git diff") {
    return { name: "GitDiff", args: {} };
  }
  return undefined;
}
