import {
  AlarmIcon,
  BrainIcon,
  ChatCircleDotsIcon,
  ClockCountdownIcon,
  ClockIcon,
  FilePlusIcon,
  FileTextIcon,
  FilesIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GitDiffIcon,
  GlobeIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TerminalWindowIcon,
  WrenchIcon,
  type Icon
} from "@phosphor-icons/react";
import { proposePlanArgsSchema, proposedPlanTitle, type ToolCall } from "@chengxiaobang/shared";
import { shortenPath } from "./tool-call";

/** 工具在折叠摘要中聚合的类别。 */
export type ToolCategory =
  | "read"
  | "edit"
  | "search"
  | "command"
  | "web"
  | "artifact"
  | "message"
  | "plan"
  | "schedule"
  | "memory"
  | "other";

const TOOL_ICONS: Record<string, Icon> = {
  Read: FileTextIcon,
  Write: FilePlusIcon,
  Edit: PencilSimpleIcon,
  LS: FolderOpenIcon,
  MakeDirectory: FolderPlusIcon,
  Glob: FilesIcon,
  Grep: MagnifyingGlassIcon,
  Bash: TerminalWindowIcon,
  BashStatus: TerminalWindowIcon,
  BashCancel: TerminalWindowIcon,
  GitStatus: GitBranchIcon,
  GitDiff: GitDiffIcon,
  WebFetch: GlobeIcon,
  WebSearch: MagnifyingGlassIcon,
  FeishuSendMessage: PaperPlaneTiltIcon,
  ExitPlanMode: ListChecksIcon,
  TodoRead: ListChecksIcon,
  TodoWrite: ListChecksIcon,
  AskUserQuestion: ChatCircleDotsIcon,
  Skill: SparkleIcon,
  ScheduleCreate: AlarmIcon,
  ScheduleList: ClockIcon,
  ScheduleCancel: ClockCountdownIcon,
  Memory: BrainIcon,
  OcrExtractText: FileTextIcon,
  CreateSkill: SparkleIcon
};

export const FALLBACK_TOOL_ICON: Icon = WrenchIcon;

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

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  Read: "read",
  Write: "edit",
  Edit: "edit",
  MakeDirectory: "edit",
  LS: "search",
  Glob: "search",
  Grep: "search",
  Bash: "command",
  BashStatus: "command",
  BashCancel: "command",
  GitStatus: "command",
  GitDiff: "command",
  WebFetch: "web",
  WebSearch: "web",
  FeishuSendMessage: "message",
  ExitPlanMode: "plan",
  TodoRead: "plan",
  TodoWrite: "plan",
  ScheduleCreate: "schedule",
  ScheduleList: "schedule",
  ScheduleCancel: "schedule",
  Memory: "memory",
  OcrExtractText: "read",
  CreateSkill: "edit"
};

export function toolCategory(name: string): ToolCategory {
  return TOOL_CATEGORIES[name] ?? "other";
}

const CATEGORY_ICONS: Record<ToolCategory, Icon> = {
  read: FileTextIcon,
  edit: PencilSimpleIcon,
  search: MagnifyingGlassIcon,
  command: TerminalWindowIcon,
  web: GlobeIcon,
  artifact: FilePlusIcon,
  message: PaperPlaneTiltIcon,
  plan: ListChecksIcon,
  schedule: ClockIcon,
  memory: BrainIcon,
  other: WrenchIcon
};

export function categoryIcon(category: ToolCategory): Icon {
  return CATEGORY_ICONS[category];
}

/** 超长截断，结尾补省略号。 */
export function truncateEnd(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type ToolLineKey = `chat.toolLine.${
  | "Read"
  | "Write"
  | "Edit"
  | "LS"
  | "MakeDirectory"
  | "Glob"
  | "Grep"
  | "Bash"
  | "BashStatus"
  | "BashCancel"
  | "GitStatus"
  | "GitDiff"
  | "WebFetch"
  | "WebSearch"
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
  | "fallback"}`;

export interface ToolLineLabel {
  key: ToolLineKey;
  params?: Record<string, string>;
}

function stringArg(args: ToolCall["args"], key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

/** 工具调用的一行人话描述（i18n key + 已截断好的插值参数）。 */
export function toolLineLabel(toolCall: ToolCall): ToolLineLabel {
  const { name, args } = toolCall;
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return { key: `chat.toolLine.${name}`, params: { path: shortenPath(stringArg(args, "file_path") ?? ".") } };
    case "LS":
    case "MakeDirectory":
      return { key: `chat.toolLine.${name}`, params: { path: shortenPath(stringArg(args, "path") ?? ".") } };
    case "Glob":
      return { key: "chat.toolLine.Glob", params: { pattern: truncateEnd(stringArg(args, "pattern") ?? "", 40) } };
    case "Grep":
      return { key: "chat.toolLine.Grep", params: { query: truncateEnd(stringArg(args, "pattern") ?? "", 40) } };
    case "WebSearch":
      return { key: "chat.toolLine.WebSearch", params: { query: truncateEnd(stringArg(args, "query") ?? "", 40) } };
    case "Bash":
      return {
        key: "chat.toolLine.Bash",
        params: { command: truncateEnd((stringArg(args, "command") ?? "").replace(/\s+/g, " ").trim(), 60) }
      };
    case "WebFetch":
      return { key: "chat.toolLine.WebFetch", params: { url: truncateEnd(stringArg(args, "url") ?? "", 60) } };
    case "ExitPlanMode":
      return {
        key: "chat.toolLine.ExitPlanMode",
        params: { title: truncateEnd(proposePlanLabel(args), 30) }
      };
    case "TodoWrite":
      return { key: "chat.toolLine.TodoWrite" };
    case "Skill":
      return { key: "chat.toolLine.Skill", params: { name: stringArg(args, "skill") ?? "" } };
    case "CreateSkill":
      return { key: "chat.toolLine.CreateSkill", params: { name: stringArg(args, "name") ?? stringArg(args, "url") ?? "" } };
    case "ScheduleCreate":
      return { key: "chat.toolLine.ScheduleCreate", params: { name: stringArg(args, "name") ?? "" } };
    case "Memory":
      return {
        key: "chat.toolLine.Memory",
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
      return { key: `chat.toolLine.${name}` };
    default:
      return { key: "chat.toolLine.fallback", params: { name } };
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
