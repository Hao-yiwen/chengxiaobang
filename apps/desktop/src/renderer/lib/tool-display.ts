import type { ComponentType } from "react";
import {
  BrainIcon,
  ChatBubblesIcon,
  ChecklistPlanIcon,
  ClockIcon,
  DocumentIcon,
  EditPencilIcon,
  FolderIcon,
  FolderOpenOutlineIcon,
  FoldersIcon,
  GitBranchIcon,
  GlobeOutlineIcon,
  LabFlaskOutlineIcon,
  PointerOutlineIcon,
  PullRequestOpenIcon,
  SearchIcon,
  SkillIcon,
  TerminalIcon,
  type FileIconSvgProps
} from "@/assets/file-type-icons";
import {
  proposePlanArgsSchema,
  proposedPlanTitle,
  toolDisplayCategory,
  type ToolCall,
  type ToolDisplayCategory
} from "@chengxiaobang/shared";
import { shortenPath } from "./tool-call";

type Icon = ComponentType<FileIconSvgProps>;

/** 工具在折叠摘要中聚合的类别。 */
export type ToolCategory = ToolDisplayCategory;

const TOOL_ICONS: Record<string, Icon> = {
  Read: DocumentIcon,
  Write: EditPencilIcon,
  Edit: EditPencilIcon,
  LS: FolderOpenOutlineIcon,
  MakeDirectory: FolderIcon,
  Glob: FoldersIcon,
  Grep: SearchIcon,
  Bash: TerminalIcon,
  PowerShell: TerminalIcon,
  BashStatus: TerminalIcon,
  BashCancel: TerminalIcon,
  GitStatus: GitBranchIcon,
  GitDiff: PullRequestOpenIcon,
  WebFetch: GlobeOutlineIcon,
  WebSearch: SearchIcon,
  ToolSearch: SearchIcon,
  FeishuSendMessage: PointerOutlineIcon,
  ExitPlanMode: ChecklistPlanIcon,
  TodoRead: ChecklistPlanIcon,
  TodoWrite: ChecklistPlanIcon,
  AskUserQuestion: ChatBubblesIcon,
  Skill: SkillIcon,
  ScheduleCreate: ClockIcon,
  ScheduleList: ClockIcon,
  ScheduleCancel: ClockIcon,
  Memory: BrainIcon,
  OcrExtractText: DocumentIcon,
  CreateSkill: SkillIcon
};

export const FALLBACK_TOOL_ICON: Icon = LabFlaskOutlineIcon;

const warnedUnknownTools = new Set<string>();

/** 工具专属图标；未知工具名记一次 debug 日志并返回兜底图标。 */
export function toolIcon(name: string): Icon {
  const icon = TOOL_ICONS[name];
  if (icon) {
    return icon;
  }
  if (!warnedUnknownTools.has(name)) {
    warnedUnknownTools.add(name);
    console.debug("[tool-display] 未知工具名，使用兜底图标", { name });
  }
  return FALLBACK_TOOL_ICON;
}

export function toolCategory(name: string): ToolCategory {
  return toolDisplayCategory(name);
}

const CATEGORY_ICONS: Record<ToolCategory, Icon> = {
  read: DocumentIcon,
  edit: EditPencilIcon,
  search: SearchIcon,
  command: TerminalIcon,
  web: GlobeOutlineIcon,
  artifact: DocumentIcon,
  message: PointerOutlineIcon,
  plan: ChecklistPlanIcon,
  schedule: ClockIcon,
  memory: BrainIcon,
  other: LabFlaskOutlineIcon
};

export function categoryIcon(category: ToolCategory): Icon {
  return CATEGORY_ICONS[category];
}

/** 超长截断，结尾补省略号。 */
export function truncateEnd(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type ToolLineName =
  | "Read"
  | "ReadGeneric"
  | "Write"
  | "WriteGeneric"
  | "Edit"
  | "EditGeneric"
  | "LS"
  | "MakeDirectory"
  | "Glob"
  | "Grep"
  | "Bash"
  | "PowerShell"
  | "BashStatus"
  | "BashCancel"
  | "GitStatus"
  | "GitDiff"
  | "WebFetch"
  | "WebSearch"
  | "ToolSearch"
  | "FeishuSendMessage"
  | "ExitPlanMode"
  | "TodoRead"
  | "TodoWrite"
  | "AskUserQuestion"
  | "Skill"
  | "CreateSkill"
  | "ScheduleCreate"
  | "ScheduleList"
  | "ScheduleCancel"
  | "Memory"
  | "OcrExtractText"
  | "fallback";

type ToolLineRunningOnlyName =
  | "LSGeneric"
  | "MakeDirectoryGeneric"
  | "GlobGeneric"
  | "GrepGeneric"
  | "BashGeneric"
  | "PowerShellGeneric"
  | "WebFetchGeneric"
  | "WebSearchGeneric"
  | "ToolSearchGeneric"
  | "ExitPlanModeGeneric"
  | "SkillGeneric"
  | "CreateSkillGeneric"
  | "ScheduleCreateGeneric"
  | "MemoryGeneric"
  | "fallbackGeneric";

type ToolLineRunningName = ToolLineName | ToolLineRunningOnlyName;
type ToolLineKey =
  | `chat.toolLine.${ToolLineName}`
  | `chat.toolLineRunning.${ToolLineRunningName}`;

export interface ToolLineLabel {
  key: ToolLineKey;
  params?: Record<string, string>;
}

function stringArg(args: ToolCall["args"], key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

type ToolLineNamespace = "chat.toolLine" | "chat.toolLineRunning";

function labelKey(
  namespace: "chat.toolLine",
  name: ToolLineName
): `chat.toolLine.${ToolLineName}`;
function labelKey(
  namespace: "chat.toolLineRunning",
  name: ToolLineRunningName
): `chat.toolLineRunning.${ToolLineRunningName}`;
function labelKey(namespace: ToolLineNamespace, name: ToolLineName): ToolLineKey;
function labelKey(
  namespace: ToolLineNamespace,
  name: ToolLineName | ToolLineRunningName
): ToolLineKey {
  return `${namespace}.${name}` as ToolLineKey;
}

const RUNNING_ARG_DISPLAY_TOOL_NAMES = new Set<string>(["Write", "Edit"]);
const ACTIVE_TOOL_STATUSES = new Set<ToolCall["status"]>([
  "running",
  "pending_approval",
  "pending_smart_approval"
]);

/** 运行中工具行只允许写入/编辑展示 file_path，其他工具参数等完成后再出现在历史里。 */
export function shouldHideRunningToolArgs(
  toolCall: Pick<ToolCall, "name" | "status">
): boolean {
  return (
    ACTIVE_TOOL_STATUSES.has(toolCall.status) &&
    !RUNNING_ARG_DISPLAY_TOOL_NAMES.has(toolCall.name)
  );
}

/** 工具调用的一行人话描述（i18n key + 已截断好的插值参数）。 */
export function toolLineLabel(toolCall: ToolCall): ToolLineLabel {
  return toolLineLabelInNamespace(toolCall, "chat.toolLine");
}

/** 运行中/准备中的工具描述，避免把正在执行的工具显示成完成态。 */
export function toolLineRunningLabel(toolCall: ToolCall): ToolLineLabel {
  const genericLabel = genericRunningToolLineLabel(toolCall);
  if (genericLabel) {
    return genericLabel;
  }
  return toolLineLabelInNamespace(toolCall, "chat.toolLineRunning");
}

function genericRunningToolLineLabel(toolCall: ToolCall): ToolLineLabel | undefined {
  if (!shouldHideRunningToolArgs(toolCall)) {
    return undefined;
  }
  switch (toolCall.name) {
    case "Read":
      return { key: labelKey("chat.toolLineRunning", "ReadGeneric") };
    case "LS":
      return { key: labelKey("chat.toolLineRunning", "LSGeneric") };
    case "MakeDirectory":
      return { key: labelKey("chat.toolLineRunning", "MakeDirectoryGeneric") };
    case "Glob":
      return { key: labelKey("chat.toolLineRunning", "GlobGeneric") };
    case "Grep":
      return { key: labelKey("chat.toolLineRunning", "GrepGeneric") };
    case "Bash":
      return { key: labelKey("chat.toolLineRunning", "BashGeneric") };
    case "PowerShell":
      return { key: labelKey("chat.toolLineRunning", "PowerShellGeneric") };
    case "WebFetch":
      return { key: labelKey("chat.toolLineRunning", "WebFetchGeneric") };
    case "WebSearch":
      return { key: labelKey("chat.toolLineRunning", "WebSearchGeneric") };
    case "ToolSearch":
      return { key: labelKey("chat.toolLineRunning", "ToolSearchGeneric") };
    case "ExitPlanMode":
      return { key: labelKey("chat.toolLineRunning", "ExitPlanModeGeneric") };
    case "Skill":
      return { key: labelKey("chat.toolLineRunning", "SkillGeneric") };
    case "CreateSkill":
      return { key: labelKey("chat.toolLineRunning", "CreateSkillGeneric") };
    case "ScheduleCreate":
      return { key: labelKey("chat.toolLineRunning", "ScheduleCreateGeneric") };
    case "Memory":
      return { key: labelKey("chat.toolLineRunning", "MemoryGeneric") };
    case "BashStatus":
    case "BashCancel":
    case "GitStatus":
    case "GitDiff":
    case "FeishuSendMessage":
    case "TodoRead":
    case "TodoWrite":
    case "AskUserQuestion":
    case "ScheduleList":
    case "ScheduleCancel":
    case "OcrExtractText":
      return undefined;
    default:
      return { key: labelKey("chat.toolLineRunning", "fallbackGeneric") };
  }
}

function toolLineLabelInNamespace(
  toolCall: ToolCall,
  namespace: ToolLineNamespace
): ToolLineLabel {
  const { name, args } = toolCall;
  switch (name) {
    case "Read": {
      const path = stringArg(args, "file_path");
      return path
        ? { key: labelKey(namespace, "Read"), params: { path: shortenPath(path) } }
        : { key: labelKey(namespace, "ReadGeneric") };
    }
    case "Write": {
      const path = stringArg(args, "file_path");
      return path
        ? { key: labelKey(namespace, "Write"), params: { path: shortenPath(path) } }
        : { key: labelKey(namespace, "WriteGeneric") };
    }
    case "Edit": {
      const path = stringArg(args, "file_path");
      return path
        ? { key: labelKey(namespace, "Edit"), params: { path: shortenPath(path) } }
        : { key: labelKey(namespace, "EditGeneric") };
    }
    case "LS":
    case "MakeDirectory":
      return { key: labelKey(namespace, name), params: { path: shortenPath(stringArg(args, "path") ?? ".") } };
    case "Glob":
      return { key: labelKey(namespace, "Glob"), params: { pattern: truncateEnd(stringArg(args, "pattern") ?? "", 40) } };
    case "Grep":
      return { key: labelKey(namespace, "Grep"), params: { query: truncateEnd(stringArg(args, "pattern") ?? "", 40) } };
    case "WebSearch":
      return { key: labelKey(namespace, "WebSearch"), params: { query: truncateEnd(stringArg(args, "query") ?? "", 40) } };
    case "Bash":
      return {
        key: labelKey(namespace, "Bash"),
        params: { command: truncateEnd((stringArg(args, "command") ?? "").replace(/\s+/g, " ").trim(), 60) }
      };
    case "PowerShell":
      return {
        key: labelKey(namespace, "PowerShell"),
        params: { command: truncateEnd((stringArg(args, "command") ?? "").replace(/\s+/g, " ").trim(), 60) }
      };
    case "WebFetch":
      return { key: labelKey(namespace, "WebFetch"), params: { url: truncateEnd(stringArg(args, "url") ?? "", 60) } };
    case "ToolSearch":
      return { key: labelKey(namespace, "ToolSearch"), params: { query: truncateEnd(stringArg(args, "query") ?? "", 40) } };
    case "ExitPlanMode":
      return {
        key: labelKey(namespace, "ExitPlanMode"),
        params: { title: truncateEnd(proposePlanLabel(args), 30) }
      };
    case "TodoWrite":
      return { key: labelKey(namespace, "TodoWrite") };
    case "Skill":
      return { key: labelKey(namespace, "Skill"), params: { name: stringArg(args, "skill") ?? "" } };
    case "CreateSkill":
      return { key: labelKey(namespace, "CreateSkill"), params: { name: stringArg(args, "name") ?? stringArg(args, "url") ?? "" } };
    case "ScheduleCreate":
      return { key: labelKey(namespace, "ScheduleCreate"), params: { name: stringArg(args, "name") ?? "" } };
    case "Memory":
      return {
        key: labelKey(namespace, "Memory"),
        params: {
          path: shortenPath(stringArg(args, "path") ?? stringArg(args, "old_path") ?? "/memories")
        }
      };
    case "GitStatus":
    case "GitDiff":
    case "BashStatus":
    case "BashCancel":
    case "FeishuSendMessage":
    case "TodoRead":
    case "AskUserQuestion":
    case "ScheduleList":
    case "ScheduleCancel":
    case "OcrExtractText":
      return { key: labelKey(namespace, name) };
    default:
      return { key: labelKey(namespace, "fallback"), params: { name } };
  }
}

function proposePlanLabel(args: Record<string, unknown>): string {
  const parsed = proposePlanArgsSchema.safeParse(args);
  if (parsed.success) {
    return proposedPlanTitle(parsed.data.markdown);
  }
  return stringArg(args, "title") ?? "计划";
}

export interface ToolGroupSummaryPart {
  category: ToolCategory;
  count: number;
}

/** 折叠摘要：按组内类别首次出现顺序聚合计数。 */
export function toolGroupSummary(toolCalls: ToolCall[]): ToolGroupSummaryPart[] {
  const parts: ToolGroupSummaryPart[] = [];
  const byCategory = new Map<ToolCategory, ToolGroupSummaryPart>();
  for (const toolCall of toolCalls) {
    const category = toolCategory(toolCall.name);
    const existing = byCategory.get(category);
    if (existing) {
      existing.count += 1;
    } else {
      const part = { category, count: 1 };
      byCategory.set(category, part);
      parts.push(part);
    }
  }
  return parts;
}
