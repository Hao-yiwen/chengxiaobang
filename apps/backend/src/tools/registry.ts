import type { AgentTool } from "@earendil-works/pi-agent-core";
import { isDeferredToolName, toolMetadata, type ModelInputModality } from "@chengxiaobang/shared";
import type { WebSearchExecutor } from "../web-search/web-search-config-service";
import { createFsTools } from "./fs-tools";
import { createShellTools } from "./shell-tools";
import { createWebTools } from "./web-tools";
import type { WebFetchRuntime } from "./web-fetch";
import { createMemoryTools } from "./memory-tools";
import { createOcrTools, type OcrToolRuntime } from "./ocr-tools";
import { isMcpToolName } from "../mcp/mcp-tool-bridge";

export type PlanPhase = "none" | "draft" | "execute";

export function requiresApproval(name: string): boolean {
  return toolMetadata(name).requiresApproval || isMcpToolName(name);
}

export function isMutatingTool(name: string): boolean {
  // 外部 MCP server 的工具可能产生任意副作用，一律按需审批，不依赖其自报的能力。
  return toolMetadata(name).mutating || isMcpToolName(name);
}

/** 计划模式下按阶段裁剪模型可见工具；飞书/headless 通道隐藏会阻塞的计划/提问工具。 */
export function selectAgentTools(
  tools: AgentTool<any>[],
  options: {
    planPhase: PlanPhase;
    viaFeishu: boolean;
    headless?: boolean;
    enableOcr?: boolean;
    enabledDeferredToolNames?: ReadonlySet<string>;
  }
): AgentTool<any>[] {
  return tools
    .filter((tool) => {
      if (tool.name === "OcrExtractText") {
        return Boolean(options.enableOcr);
      }
      if (options.viaFeishu && (tool.name === "ExitPlanMode" || tool.name === "AskUserQuestion")) {
        return false;
      }
      // 定时任务的无人值守执行：AskUserQuestion 无条件进入 pending_approval 等待，
      // 没有人会回答，必须在工具层面隐藏而不是依赖自动拒绝。
      if (options.headless && tool.name === "AskUserQuestion") {
        return false;
      }
      // todo 是桌面端旁观进度，不在正式计划、飞书或无人值守场景里混用。
      if (tool.name === "TodoRead" || tool.name === "TodoWrite") {
        return options.planPhase === "none" && !options.viaFeishu && !options.headless;
      }
      if (isDeferredAgentTool(tool.name, options.enabledDeferredToolNames)) {
        return false;
      }
      if (options.planPhase === "draft") {
        const metadata = toolMetadata(tool.name);
        return metadata.readOnly || metadata.planDraftVisible;
      }
      if (options.planPhase === "execute") {
        return tool.name !== "ExitPlanMode";
      }
      return tool.name !== "ExitPlanMode";
    })
    .map(withToolExecutionMode);
}

/** 绑定到工作区的基础工具。 */
export function createAgentTools(
  workspacePath: string,
  options: {
    webSearch?: WebSearchExecutor;
    webFetch?: WebFetchRuntime;
    /** 长期记忆的落盘目录；提供时注册 memory 工具。 */
    memoryDir?: string;
    /** OCR 工具运行时；提供后注册按需 OCR 只读工具。 */
    ocr?: OcrToolRuntime;
    /** 当前 run 模型的输入能力；用于 Read 图片时按模型能力返回 image 或文本提示。 */
    modelInputModalities?: readonly ModelInputModality[];
    /** 后台 shell 输出的全局落盘目录；不提供时回退到工作区旧路径。 */
    shellOutputDir?: string;
    /** 当前 run id；提供后用于在全局 shell 输出目录下做运行级隔离。 */
    runId?: string;
    /** 已就绪的 MCP 桥接工具；由 McpManager.getToolsForWorkspace 提供，并入工具集合。 */
    mcpTools?: AgentTool<any>[];
  } = {}
): AgentTool<any>[] {
  return [
    ...createFsTools(workspacePath, { modelInputModalities: options.modelInputModalities }),
    ...createShellTools(workspacePath, {
      ...(options.shellOutputDir ? { shellOutputDir: options.shellOutputDir } : {}),
      ...(options.runId ? { runId: options.runId } : {})
    }),
    ...createWebTools(options.webSearch, options.webFetch),
    ...(options.ocr ? createOcrTools(workspacePath, options.ocr) : []),
    ...(options.memoryDir ? createMemoryTools(options.memoryDir) : []),
    ...(options.mcpTools ?? [])
  ];
}

export function findTool(
  tools: AgentTool<any>[],
  name: string
): AgentTool<any> | undefined {
  return tools.find((tool) => tool.name === name);
}

function isDeferredAgentTool(
  name: string,
  enabledDeferredToolNames?: ReadonlySet<string>
): boolean {
  if (enabledDeferredToolNames?.has(name)) {
    return false;
  }
  return isMcpToolName(name) || isDeferredToolName(name);
}

function withToolExecutionMode(tool: AgentTool<any>): AgentTool<any> {
  const metadata = toolMetadata(tool.name);
  if (metadata.concurrencySafe) {
    return tool;
  }
  return tool.executionMode === "sequential" ? tool : { ...tool, executionMode: "sequential" };
}
