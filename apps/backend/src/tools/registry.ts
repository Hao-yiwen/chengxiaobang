import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { FeishuSender } from "../feishu/feishu-bridge";
import { createFsTools } from "./fs-tools";
import { createShellTools } from "./shell-tools";
import { createWebTools } from "./web-tools";
import { createOfficeTools } from "./office-tools";
import { createFeishuTools } from "./feishu-tools";

const MUTATING_TOOLS = new Set<string>([
  "write_file",
  "edit_file",
  "make_directory",
  "shell",
  "create_pptx",
  "create_docx",
  "create_xlsx",
  // Outbound messaging needs consent too — and being approval-gated means
  // read-only Feishu-triggered runs can never spam Feishu themselves.
  "feishu_send_message"
]);

export function requiresApproval(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

/**
 * All builtin tools bound to a workspace. The Feishu sender is resolved lazily
 * because the FeishuService is constructed after the agent runner.
 */
export function createAgentTools(
  workspacePath: string,
  getFeishuSender?: () => FeishuSender | undefined
): AgentTool<any>[] {
  return [
    ...createFsTools(workspacePath),
    ...createShellTools(workspacePath),
    ...createWebTools(),
    ...createOfficeTools(workspacePath),
    ...createFeishuTools(getFeishuSender)
  ];
}

export function findTool(
  tools: AgentTool<any>[],
  name: string
): AgentTool<any> | undefined {
  return tools.find((tool) => tool.name === name);
}
