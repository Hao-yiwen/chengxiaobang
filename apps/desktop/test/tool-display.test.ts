import { describe, expect, it } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import {
  FALLBACK_TOOL_ICON,
  categoryIcon,
  toolCategory,
  toolGroupSummary,
  toolIcon,
  toolLineLabel,
  truncateEnd,
  type ToolCategory
} from "../src/renderer/lib/tool-display";
import zh from "../src/renderer/i18n/locales/zh.json";
import en from "../src/renderer/i18n/locales/en.json";

const BUILTIN_TOOLS = [
  "read_file",
  "write_file",
  "edit_file",
  "list_directory",
  "make_directory",
  "glob",
  "search",
  "shell",
  "shell_status",
  "shell_cancel",
  "git_status",
  "git_diff",
  "fetch_url",
  "web_search",
  "create_pptx",
  "create_docx",
  "create_xlsx",
  "feishu_send_message",
  "propose_plan",
  "update_plan",
  "todo_create",
  "todo_update",
  "ask_user",
  "btw",
  "use_skill",
  "schedule_create",
  "schedule_create_once",
  "schedule_list",
  "schedule_cancel",
  "memory"
] as const;

const CATEGORIES: ToolCategory[] = [
  "read",
  "edit",
  "search",
  "command",
  "web",
  "artifact",
  "message",
  "plan",
  "schedule",
  "memory",
  "other"
];

function toolCall(partial: Partial<ToolCall>): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name: "shell",
    args: {},
    status: "completed",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:01.000Z",
    ...partial
  };
}

describe("toolIcon", () => {
  it("每个内置工具都有专属图标且不落兜底", () => {
    for (const name of BUILTIN_TOOLS) {
      const icon = toolIcon(name);
      expect(icon, name).toBeTruthy();
      expect(icon, name).not.toBe(FALLBACK_TOOL_ICON);
    }
  });

  it("未知工具名返回兜底图标", () => {
    expect(toolIcon("totally_unknown_tool")).toBe(FALLBACK_TOOL_ICON);
  });
});

describe("toolCategory / categoryIcon", () => {
  it("内置工具归入已知类别，未知工具归 other", () => {
    expect(toolCategory("read_file")).toBe("read");
    expect(toolCategory("edit_file")).toBe("edit");
    expect(toolCategory("search")).toBe("search");
    expect(toolCategory("list_directory")).toBe("search");
    expect(toolCategory("shell")).toBe("command");
    expect(toolCategory("shell_status")).toBe("command");
    expect(toolCategory("shell_cancel")).toBe("command");
    expect(toolCategory("fetch_url")).toBe("web");
    expect(toolCategory("web_search")).toBe("web");
    expect(toolCategory("create_pptx")).toBe("artifact");
    expect(toolCategory("feishu_send_message")).toBe("message");
    expect(toolCategory("propose_plan")).toBe("plan");
    expect(toolCategory("todo_create")).toBe("plan");
    expect(toolCategory("schedule_create")).toBe("schedule");
    expect(toolCategory("schedule_create_once")).toBe("schedule");
    expect(toolCategory("memory")).toBe("memory");
    expect(toolCategory("nonexistent")).toBe("other");
  });

  it("每个类别都有图标", () => {
    for (const category of CATEGORIES) {
      expect(categoryIcon(category), category).toBeTruthy();
    }
  });
});

describe("toolLineLabel", () => {
  it("每个内置工具的 key 在 zh/en 文案中都存在", () => {
    for (const name of BUILTIN_TOOLS) {
      const label = toolLineLabel(toolCall({ name, args: { path: "a.ts" } }));
      const suffix = label.key.replace("chat.toolLine.", "");
      expect(zh.chat.toolLine, `zh 缺少 ${suffix}`).toHaveProperty(suffix);
      expect(en.chat.toolLine, `en 缺少 ${suffix}`).toHaveProperty(suffix);
    }
    expect(zh.chat.toolLine).toHaveProperty("fallback");
    expect(en.chat.toolLine).toHaveProperty("fallback");
  });

  it("文件类工具缩短路径", () => {
    const label = toolLineLabel(
      toolCall({ name: "read_file", args: { path: "apps/desktop/src/renderer/lib/timeline.ts" } })
    );
    expect(label.key).toBe("chat.toolLine.read_file");
    expect(label.params).toEqual({ path: "…/lib/timeline.ts" });
  });

  it("shell 命令压缩空白并截断到 60 字符", () => {
    const command = `pnpm   test\n  --filter ${"x".repeat(80)}`;
    const label = toolLineLabel(toolCall({ name: "shell", args: { command } }));
    expect(label.key).toBe("chat.toolLine.shell");
    expect(label.params?.command?.length).toBe(61);
    expect(label.params?.command?.endsWith("…")).toBe(true);
    expect(label.params?.command).not.toContain("\n");
  });

  it("search 查询截断到 40 字符", () => {
    const label = toolLineLabel(toolCall({ name: "search", args: { query: "y".repeat(50) } }));
    expect(label.params?.query).toBe(`${"y".repeat(40)}…`);
  });

  it("web_search 查询截断到 40 字符", () => {
    const label = toolLineLabel(toolCall({ name: "web_search", args: { query: "z".repeat(50) } }));
    expect(label.key).toBe("chat.toolLine.web_search");
    expect(label.params?.query).toBe(`${"z".repeat(40)}…`);
  });

  it("propose_plan 从 Markdown 标题提取摘要标题，并兼容旧 title", () => {
    const markdownLabel = toolLineLabel(
      toolCall({
        name: "propose_plan",
        args: { markdown: "# 登录页错误提示优化\n\n## Summary\n优化提示。" }
      })
    );
    expect(markdownLabel.params).toEqual({ title: "登录页错误提示优化" });

    const legacyLabel = toolLineLabel(
      toolCall({ name: "propose_plan", args: { title: "旧计划", steps: [] } })
    );
    expect(legacyLabel.params).toEqual({ title: "旧计划" });
  });

  it("未知工具名落 fallback 并携带原名", () => {
    const label = toolLineLabel(toolCall({ name: "mystery_tool" }));
    expect(label.key).toBe("chat.toolLine.fallback");
    expect(label.params).toEqual({ name: "mystery_tool" });
  });

  it("参数缺失时不抛错", () => {
    expect(toolLineLabel(toolCall({ name: "read_file", args: {} })).params).toEqual({ path: "." });
    expect(toolLineLabel(toolCall({ name: "shell", args: {} })).params).toEqual({ command: "" });
  });
});

describe("toolGroupSummary", () => {
  it("按类别首次出现顺序聚合计数", () => {
    const summary = toolGroupSummary([
      toolCall({ name: "read_file" }),
      toolCall({ name: "search" }),
      toolCall({ name: "read_file" }),
      toolCall({ name: "shell" })
    ]);
    expect(summary).toEqual([
      { category: "read", count: 2 },
      { category: "search", count: 1 },
      { category: "command", count: 1 }
    ]);
  });

  it("每个类别的摘要 key 在 zh 文案中存在", () => {
    for (const category of CATEGORIES) {
      expect(zh.chat.toolGroup, `zh 缺少 ${category}`).toHaveProperty(category);
    }
    expect(zh.chat.toolGroup).toHaveProperty("failed");
    expect(en.chat.toolGroup).toHaveProperty("failed");
  });
});

describe("truncateEnd", () => {
  it("不超长原样返回，超长截断补省略号", () => {
    expect(truncateEnd("abc", 3)).toBe("abc");
    expect(truncateEnd("abcd", 3)).toBe("abc…");
    expect(truncateEnd("", 5)).toBe("");
  });
});
