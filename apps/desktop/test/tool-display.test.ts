import { describe, expect, it } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import {
  FALLBACK_TOOL_ICON,
  categoryIcon,
  shouldHideRunningToolArgs,
  toolCategory,
  toolGroupSummary,
  toolIcon,
  toolLineLabel,
  toolLineRunningLabel,
  truncateEnd,
  type ToolCategory
} from "../src/renderer/lib/tool-display";
import zh from "../src/renderer/i18n/locales/zh.json";
import en from "../src/renderer/i18n/locales/en.json";

const BUILTIN_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "LS",
  "MakeDirectory",
  "Glob",
  "Grep",
  "Bash",
  "BashStatus",
  "BashCancel",
  "GitStatus",
  "GitDiff",
  "WebFetch",
  "WebSearch",
  "CreateSkill",
  "FeishuSendMessage",
  "ExitPlanMode",
  "AskUserQuestion",
  "Skill",
  "TodoRead",
  "TodoWrite",
  "ScheduleCreate",
  "ScheduleList",
  "ScheduleCancel",
  "Memory",
  "OcrExtractText"
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
    name: "Bash",
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
    expect(toolCategory("Read")).toBe("read");
    expect(toolCategory("Edit")).toBe("edit");
    expect(toolCategory("Grep")).toBe("search");
    expect(toolCategory("LS")).toBe("search");
    expect(toolCategory("Bash")).toBe("command");
    expect(toolCategory("BashStatus")).toBe("command");
    expect(toolCategory("BashCancel")).toBe("command");
    expect(toolCategory("WebFetch")).toBe("web");
    expect(toolCategory("WebSearch")).toBe("web");
    expect(toolCategory("CreateSkill")).toBe("edit");
    expect(toolCategory("FeishuSendMessage")).toBe("message");
    expect(toolCategory("ExitPlanMode")).toBe("plan");
    expect(toolCategory("TodoWrite")).toBe("plan");
    expect(toolCategory("ScheduleCreate")).toBe("schedule");
    expect(toolCategory("Memory")).toBe("memory");
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
      const label = toolLineLabel(toolCall({ name, args: { file_path: "a.ts" } }));
      const suffix = label.key.replace("chat.toolLine.", "");
      expect(zh.chat.toolLine, `zh 缺少 ${suffix}`).toHaveProperty(suffix);
      expect(en.chat.toolLine, `en 缺少 ${suffix}`).toHaveProperty(suffix);
    }
    expect(zh.chat.toolLine).toHaveProperty("fallback");
    expect(en.chat.toolLine).toHaveProperty("fallback");
  });

  it("运行中工具只允许 Write/Edit 展示 file_path 参数", () => {
    const write = toolLineRunningLabel(
      toolCall({ name: "Write", status: "running", args: { file_path: "out.txt" } })
    );
    const edit = toolLineRunningLabel(
      toolCall({ name: "Edit", status: "running", args: { file_path: "src/app.ts" } })
    );
    expect(write).toEqual({
      key: "chat.toolLineRunning.Write",
      params: { path: "out.txt" }
    });
    expect(edit).toEqual({
      key: "chat.toolLineRunning.Edit",
      params: { path: "src/app.ts" }
    });
    expect(shouldHideRunningToolArgs(toolCall({ name: "Write", status: "running" }))).toBe(false);
    expect(shouldHideRunningToolArgs(toolCall({ name: "WebFetch", status: "running" }))).toBe(true);
  });

  it("非 Write/Edit 运行中工具使用泛化文案且不带参数", () => {
    const cases: Array<{ name: ToolCall["name"]; args: ToolCall["args"]; key: string }> = [
      { name: "Read", args: { file_path: "secret.ts" }, key: "chat.toolLineRunning.ReadGeneric" },
      { name: "WebFetch", args: { url: "https://example.com" }, key: "chat.toolLineRunning.WebFetchGeneric" },
      { name: "WebSearch", args: { query: "private query" }, key: "chat.toolLineRunning.WebSearchGeneric" },
      { name: "Bash", args: { command: "pnpm test" }, key: "chat.toolLineRunning.BashGeneric" },
      { name: "Skill", args: { skill: "ppt" }, key: "chat.toolLineRunning.SkillGeneric" }
    ];
    for (const item of cases) {
      const label = toolLineRunningLabel(
        toolCall({ name: item.name, status: "running", args: item.args })
      );
      expect(label.key, item.name).toBe(item.key);
      expect(label.params, item.name).toBeUndefined();
      const suffix = label.key.replace("chat.toolLineRunning.", "");
      expect(zh.chat.toolLineRunning, `zh 缺少 ${suffix}`).toHaveProperty(suffix);
      expect(en.chat.toolLineRunning, `en 缺少 ${suffix}`).toHaveProperty(suffix);
    }
  });

  it("运行中无参数工具保留专属文案", () => {
    expect(toolLineRunningLabel(toolCall({ name: "GitStatus", status: "running" }))).toEqual({
      key: "chat.toolLineRunning.GitStatus"
    });
  });

  it("完成后的工具历史仍保留真实参数描述", () => {
    expect(
      toolLineLabel(toolCall({ name: "WebFetch", args: { url: "https://example.com" } }))
    ).toEqual({
      key: "chat.toolLine.WebFetch",
      params: { url: "https://example.com" }
    });
    expect(toolLineLabel(toolCall({ name: "WebSearch", args: { query: "z".repeat(50) } }))).toEqual({
      key: "chat.toolLine.WebSearch",
      params: { query: `${"z".repeat(40)}…` }
    });
    expect(toolLineLabel(toolCall({ name: "Bash", args: { command: "pnpm   test" } }))).toEqual({
      key: "chat.toolLine.Bash",
      params: { command: "pnpm test" }
    });
  });

  it("文件类工具缩短路径", () => {
    const label = toolLineLabel(
      toolCall({ name: "Read", args: { file_path: "apps/desktop/src/renderer/lib/timeline.ts" } })
    );
    expect(label.key).toBe("chat.toolLine.Read");
    expect(label.params).toEqual({ path: "…/lib/timeline.ts" });
  });

  it("shell 命令压缩空白并截断到 60 字符", () => {
    const command = `pnpm   test\n  --filter ${"x".repeat(80)}`;
    const label = toolLineLabel(toolCall({ name: "Bash", args: { command } }));
    expect(label.key).toBe("chat.toolLine.Bash");
    expect(label.params?.command?.length).toBe(61);
    expect(label.params?.command?.endsWith("…")).toBe(true);
    expect(label.params?.command).not.toContain("\n");
  });

  it("search 查询截断到 40 字符", () => {
    const label = toolLineLabel(toolCall({ name: "Grep", args: { pattern: "y".repeat(50) } }));
    expect(label.params?.query).toBe(`${"y".repeat(40)}…`);
  });

  it("WebSearch 查询截断到 40 字符", () => {
    const label = toolLineLabel(toolCall({ name: "WebSearch", args: { query: "z".repeat(50) } }));
    expect(label.key).toBe("chat.toolLine.WebSearch");
    expect(label.params?.query).toBe(`${"z".repeat(40)}…`);
  });

  it("ExitPlanMode 从计划正文标题提取摘要标题", () => {
    const markdownLabel = toolLineLabel(
      toolCall({
        name: "ExitPlanMode",
        args: { plan: "# 登录页错误提示优化\n\n## Summary\n优化提示。" }
      })
    );
    expect(markdownLabel.params).toEqual({ title: "登录页错误提示优化" });
  });

  it("未知工具名落 fallback 并携带原名", () => {
    const label = toolLineLabel(toolCall({ name: "mystery_tool" }));
    expect(label.key).toBe("chat.toolLine.fallback");
    expect(label.params).toEqual({ name: "mystery_tool" });
  });

  it("参数缺失时不抛错", () => {
    expect(toolLineLabel(toolCall({ name: "Read", args: {} })).key).toBe("chat.toolLine.ReadGeneric");
    expect(toolLineLabel(toolCall({ name: "Bash", args: {} })).params).toEqual({ command: "" });
  });
});

describe("toolGroupSummary", () => {
  it("按类别首次出现顺序聚合计数", () => {
    const summary = toolGroupSummary([
      toolCall({ name: "Read" }),
      toolCall({ name: "Grep" }),
      toolCall({ name: "Read" }),
      toolCall({ name: "Bash" })
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
