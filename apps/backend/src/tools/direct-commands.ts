import type { ToolName } from "@chengxiaobang/shared";

export interface ToolRequest {
  name: ToolName;
  args: Record<string, unknown>;
}

/** Parse the direct slash commands that run a single builtin tool without the model. */
export function parseToolRequest(prompt: string): ToolRequest | undefined {
  const trimmed = prompt.trim();
  if (trimmed.startsWith("/ls")) {
    return { name: "list_directory", args: { path: trimmed.slice(3).trim() || "." } };
  }
  if (trimmed.startsWith("/read ")) {
    return { name: "read_file", args: { path: trimmed.slice(6).trim() } };
  }
  if (trimmed.startsWith("/write ")) {
    const [, targetAndContent = ""] = trimmed.split("/write ");
    const [target, ...contentLines] = targetAndContent.split("\n");
    return {
      name: "write_file",
      args: { path: target.trim(), content: contentLines.join("\n") }
    };
  }
  if (trimmed.startsWith("/shell ")) {
    return { name: "shell", args: { command: trimmed.slice(7).trim() } };
  }
  if (trimmed === "/git status") {
    return { name: "git_status", args: {} };
  }
  if (trimmed === "/git diff") {
    return { name: "git_diff", args: {} };
  }
  return undefined;
}
