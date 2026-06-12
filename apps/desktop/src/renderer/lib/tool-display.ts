import {
  AlarmIcon,
  ChatCircleDotsIcon,
  ClockCountdownIcon,
  ClockIcon,
  FileDocIcon,
  FilePlusIcon,
  FilePptIcon,
  FileTextIcon,
  FileXlsIcon,
  FilesIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GitDiffIcon,
  GlobeIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  SparkleIcon,
  TerminalWindowIcon,
  WrenchIcon,
  type Icon
} from "@phosphor-icons/react";
import type { ToolCall } from "@chengxiaobang/shared";
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
  | "other";

const TOOL_ICONS: Record<string, Icon> = {
  read_file: FileTextIcon,
  write_file: FilePlusIcon,
  edit_file: PencilSimpleIcon,
  list_directory: FolderOpenIcon,
  make_directory: FolderPlusIcon,
  glob: FilesIcon,
  search: MagnifyingGlassIcon,
  shell: TerminalWindowIcon,
  git_status: GitBranchIcon,
  git_diff: GitDiffIcon,
  fetch_url: GlobeIcon,
  create_pptx: FilePptIcon,
  create_docx: FileDocIcon,
  create_xlsx: FileXlsIcon,
  feishu_send_message: PaperPlaneTiltIcon,
  propose_plan: ListChecksIcon,
  update_plan: ListChecksIcon,
  ask_user: ChatCircleDotsIcon,
  btw: NotePencilIcon,
  use_skill: SparkleIcon,
  schedule_create: AlarmIcon,
  schedule_list: ClockIcon,
  schedule_cancel: ClockCountdownIcon
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
  read_file: "read",
  write_file: "edit",
  edit_file: "edit",
  make_directory: "edit",
  list_directory: "search",
  glob: "search",
  search: "search",
  shell: "command",
  git_status: "command",
  git_diff: "command",
  fetch_url: "web",
  create_pptx: "artifact",
  create_docx: "artifact",
  create_xlsx: "artifact",
  feishu_send_message: "message",
  propose_plan: "plan",
  update_plan: "plan",
  schedule_create: "schedule",
  schedule_list: "schedule",
  schedule_cancel: "schedule"
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
  | "read_file"
  | "write_file"
  | "edit_file"
  | "list_directory"
  | "make_directory"
  | "glob"
  | "search"
  | "shell"
  | "git_status"
  | "git_diff"
  | "fetch_url"
  | "create_pptx"
  | "create_docx"
  | "create_xlsx"
  | "feishu_send_message"
  | "propose_plan"
  | "update_plan"
  | "ask_user"
  | "btw"
  | "use_skill"
  | "schedule_create"
  | "schedule_list"
  | "schedule_cancel"
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
    case "read_file":
    case "write_file":
    case "edit_file":
    case "list_directory":
    case "make_directory":
    case "create_pptx":
    case "create_docx":
    case "create_xlsx":
      return { key: `chat.toolLine.${name}`, params: { path: shortenPath(stringArg(args, "path") ?? ".") } };
    case "glob":
      return { key: "chat.toolLine.glob", params: { pattern: truncateEnd(stringArg(args, "pattern") ?? "", 40) } };
    case "search":
      return { key: "chat.toolLine.search", params: { query: truncateEnd(stringArg(args, "query") ?? "", 40) } };
    case "shell":
      return {
        key: "chat.toolLine.shell",
        params: { command: truncateEnd((stringArg(args, "command") ?? "").replace(/\s+/g, " ").trim(), 60) }
      };
    case "fetch_url":
      return { key: "chat.toolLine.fetch_url", params: { url: truncateEnd(stringArg(args, "url") ?? "", 60) } };
    case "propose_plan":
      return { key: "chat.toolLine.propose_plan", params: { title: truncateEnd(stringArg(args, "title") ?? "", 30) } };
    case "use_skill":
      return { key: "chat.toolLine.use_skill", params: { name: stringArg(args, "name") ?? "" } };
    case "schedule_create":
      return { key: "chat.toolLine.schedule_create", params: { name: stringArg(args, "name") ?? "" } };
    case "git_status":
    case "git_diff":
    case "feishu_send_message":
    case "update_plan":
    case "ask_user":
    case "btw":
    case "schedule_list":
    case "schedule_cancel":
      return { key: `chat.toolLine.${name}` };
    default:
      return { key: "chat.toolLine.fallback", params: { name } };
  }
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
