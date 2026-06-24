import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createAgentTools, findTool, requiresApproval } from "../src/tools/registry";
import { assessToolApprovalRisk } from "../src/tools/approval-policy";
import { buildToolFileChangeDetails } from "../src/tools/file-change";
import { createPlanTools } from "../src/tools/plan-tools";
import { createScheduleTools } from "../src/tools/schedule-tools";
import { createShellTools } from "../src/tools/shell-tools";
import { SHELL_GLOBAL_OUTPUT_DIR } from "../src/tools/shell";
import { createSkillTools } from "../src/tools/skill-tools";
import { createTodoTools } from "../src/tools/todo-tools";
import { createToolSearchTool } from "../src/tools/tool-search-tool";
import { resolveRgCommand } from "../src/tools/fs-tools";

async function run(
  tools: AgentTool<any>[],
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const result = await executeTool(tools, name, args);
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function executeTool(
  tools: AgentTool<any>[],
  name: string,
  args: Record<string, unknown>
): Promise<Awaited<ReturnType<AgentTool<any>["execute"]>>> {
  const tool = getTool(tools, name);
  return tool.execute("tool_1", args);
}

function getTool(tools: AgentTool<any>[], name: string): AgentTool<any> {
  const tool = findTool(tools, name);
  if (!tool) {
    throw new Error(`tool not registered: ${name}`);
  }
  return tool;
}

function toolModelText(tool: AgentTool<any>): string {
  return JSON.stringify({
    description: tool.description,
    parameters: tool.parameters
  });
}

function expectToolGuidance(
  tools: AgentTool<any>[],
  name: string,
  snippets: string[]
): void {
  const text = toolModelText(getTool(tools, name));
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe("builtin agent tools", () => {
  let dir: string;
  let tools: AgentTool<any>[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-tools-"));
    tools = createAgentTools(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("registers every builtin tool exactly once", () => {
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "LS",
      "Read",
      "Write",
      "Edit",
      "MakeDirectory",
      "Glob",
      "Grep",
      "Bash",
      "GitStatus",
      "GitDiff",
      "BashStatus",
      "BashCancel",
      "WebFetch"
    ]);
  });

  it("registers PowerShell only for Windows shell tool catalogs", () => {
    const windowsNames = createShellTools(dir, { platform: "win32" }).map((tool) => tool.name);
    const macNames = createShellTools(dir, { platform: "darwin" }).map((tool) => tool.name);

    expect(windowsNames).toContain("PowerShell");
    expect(macNames).not.toContain("PowerShell");
  });

  it("keeps operational tool guidance in tool descriptions and parameter descriptions", () => {
    expectToolGuidance(tools, "Read", ["最多 2000 行", "offset/limit", "先用它了解现状"]);
    expectToolGuidance(tools, "Write", [
      "覆盖已有文件前必须先用 Read 完整读取",
      "小范围改动优先使用 Edit",
      "优先生成 file_path"
    ]);
    expectToolGuidance(tools, "Edit", [
      "old_string 不要包含 Read 输出里的行号前缀",
      "replace_all=true",
      "唯一匹配",
      "优先生成 file_path"
    ]);
    expectToolGuidance(tools, "Glob", ["不要用 shell 拼等价命令"]);
    expectToolGuidance(tools, "Grep", ["path 可传目录或单个文件", "不要用 shell 拼等价命令"]);
    expectToolGuidance(tools, "Bash", [
      "默认前台等待 15000ms",
      "run_in_background=true",
      "timeout 最长 600000ms",
      "BashStatus",
      "BashCancel"
    ]);
    expectToolGuidance(createShellTools(dir, { platform: "win32" }), "PowerShell", [
      "等待、后台、timeout、输出文件",
      "BashStatus",
      "BashCancel"
    ]);

    const planTools = createPlanTools({
      getApprovedPlanArgs: () => undefined,
      getAskUserAnswer: () => undefined,
      loadSkill: async () => undefined
    });
    expectToolGuidance(planTools, "AskUserQuestion", [
      "真正需要决策",
      "一次性合并",
      "2 到 4 个清晰选项"
    ]);
    expectToolGuidance(planTools, "Skill", ["PPT、Word、Excel", "先加载对应技能"]);

    expectToolGuidance(createTodoTools(), "TodoWrite", [
      "多步排查",
      "完整 todos",
      "最多一个 in_progress"
    ]);
    expectToolGuidance(
      createScheduleTools({ store: {} as never, sessionId: "session_test" }),
      "ScheduleCreate",
      ["kind=once", "带时区 ISO 时间 run_at", "不要用 cron 表达一次性任务"]
    );
    expectToolGuidance(
      createSkillTools({ skillMarketService: {} as never }),
      "CreateSkill",
      ["GitHub 链接", "口头描述需求", "name + description + content"]
    );
  });

  it("ToolSearch loads deferred tools by exact name and keyword", async () => {
    const enabledDeferredToolNames = new Set<string>();
    let runtimeTools: AgentTool<any>[] = [];
    runtimeTools = [
      {
        name: "mcp__demo__write",
        label: "Demo writer",
        description: "Write to demo service",
        parameters: {} as never,
        execute: async () => ({
          content: [{ type: "text", text: "ok" }],
          details: undefined
        })
      },
      createToolSearchTool({
        tools: () => runtimeTools,
        enabledDeferredToolNames
      })
    ];

    await expect(
      run(runtimeTools, "ToolSearch", { query: "select:mcp__demo__write" })
    ).resolves.toContain("mcp__demo__write");
    expect(enabledDeferredToolNames.has("mcp__demo__write")).toBe(true);

    enabledDeferredToolNames.clear();
    await expect(run(runtimeTools, "ToolSearch", { query: "demo writer" })).resolves.toContain(
      "mcp__demo__write"
    );
    expect(enabledDeferredToolNames.has("mcp__demo__write")).toBe(true);
  });

  it("Read 读取图片时按当前模型能力决定是否返回 image content", async () => {
    const imagePath = join(dir, "sample.png");
    await writeFile(imagePath, Buffer.from("89504e470d0a1a0a", "hex"));

    const textOnlyTools = createAgentTools(dir, { modelInputModalities: ["text"] });
    const textOnlyResult = await executeTool(textOnlyTools, "Read", { file_path: "sample.png" });
    expect(textOnlyResult.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("当前模型不支持图片原生输入")
      })
    ]);

    const imageTools = createAgentTools(dir, { modelInputModalities: ["text", "image"] });
    const imageResult = await executeTool(imageTools, "Read", { file_path: "sample.png" });
    expect(imageResult.content).toEqual([
      expect.objectContaining({ type: "image", mimeType: "image/png" })
    ]);
  });

  it("registers memory only when a memoryDir is configured, exempt from approval", async () => {
    expect(tools.map((tool) => tool.name)).not.toContain("Memory");

    const memoryDir = join(dir, "memories");
    const withMemory = createAgentTools(dir, { memoryDir });
    expect(withMemory.map((tool) => tool.name)).toContain("Memory");
    // 记忆读写仅限专用目录，不进审批队列，否则 headless 定时任务会被自动拒绝。
    expect(requiresApproval("Memory")).toBe(false);
    await expect(
      run(withMemory, "Memory", {
        command: "create",
        path: "/memories/note.md",
        file_text: "记一笔"
      })
    ).resolves.toContain("已创建");
    await expect(readFile(join(memoryDir, "note.md"), "utf8")).resolves.toBe("记一笔");
  });

  it("registers WebSearch only when a Tavily searcher is injected", async () => {
    const tools = createAgentTools(dir, {
      webSearch: async ({ query }) => `结果：${query}`
    });

    expect(tools.map((tool) => tool.name)).toContain("WebSearch");
    await expect(run(tools, "WebSearch", { query: "Tavily", maxUses: 1 })).resolves.toContain(
      "结果：Tavily"
    );
  });

  it("writes, reads and edits files", async () => {
    await expect(
      run(tools, "Write", { file_path: "notes/todo.md", content: "hello" })
    ).resolves.toContain("已写入");
    await expect(readFile(join(dir, "notes/todo.md"), "utf8")).resolves.toBe("hello");

    await run(tools, "Edit", {
      file_path: "notes/todo.md",
      old_string: "hello",
      new_string: "world"
    });
    await expect(run(tools, "Read", { file_path: "notes/todo.md" })).resolves.toContain(
      "     1\tworld"
    );
  });

  it("operates on explicit absolute file paths", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-tools-outside-"));
    try {
      const outsideFile = join(outsideDir, "resource.txt");
      await writeFile(outsideFile, "外部技能资源", "utf8");

      await expect(run(tools, "Read", { file_path: outsideFile })).resolves.toContain(
        "外部技能资源"
      );
      await expect(run(tools, "LS", { path: outsideDir })).resolves.toContain(
        "file resource.txt"
      );
      const createdFile = join(outsideDir, "created.txt");
      await expect(
        run(tools, "Write", { file_path: createdFile, content: "x" })
      ).resolves.toContain("已写入");
      await run(tools, "Edit", { file_path: createdFile, old_string: "x", new_string: "y" });
      await expect(readFile(createdFile, "utf8")).resolves.toBe("y");
      await expect(
        run(tools, "MakeDirectory", { path: join(outsideDir, "nested") })
      ).resolves.toContain("已创建目录");
      await expect(run(tools, "LS", { path: outsideDir })).resolves.toContain(
        "dir  nested"
      );
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("reads file line ranges when requested", async () => {
    await writeFile(join(dir, "notes.txt"), "one\ntwo\nthree\nfour", "utf8");

    const result = await run(tools, "Read", {
      file_path: "notes.txt",
      offset: 2,
      limit: 2
    });

    expect(result).toContain("notes.txt 的第 2-3 行（共 4 行）");
    expect(result).toContain("     2\ttwo");
    expect(result).toContain("     3\tthree");
    expect(result).toContain("offset=4");
    expect(result).not.toContain("one");
  });

  it("reads at most 2000 lines by default and returns the next offset hint", async () => {
    await writeFile(
      join(dir, "large.txt"),
      Array.from({ length: 2005 }, (_, index) => `line ${index + 1}`).join("\n"),
      "utf8"
    );

    const result = await run(tools, "Read", { file_path: "large.txt" });

    expect(result).toContain("large.txt 的第 1-2000 行（共 2005 行）");
    expect(result).toContain("offset=2001");
    expect(result).not.toContain("line 2001");
  });

  it("Write creates missing files through full-file writes only", async () => {
    await run(tools, "Write", {
      file_path: "new-lines.txt",
      content: "first\nsecond"
    });
    await expect(readFile(join(dir, "new-lines.txt"), "utf8")).resolves.toBe("first\nsecond");
  });

  it("Write returns diff details for newly created text files", async () => {
    const result = await executeTool(tools, "Write", {
      file_path: "notes/new.txt",
      content: "hello\n"
    });

    expect(result.details).toMatchObject({
      path: "notes/new.txt",
      operation: "write",
      additions: 1,
      deletions: 0,
      beforeText: "",
      afterText: "hello\n"
    });
    expect(result.details?.patch).toContain("+hello");
  });

  it("Write returns diff details when replacing an existing text file", async () => {
    await writeFile(join(dir, "replace.txt"), "old\n", "utf8");
    await run(tools, "Read", { file_path: "replace.txt" });

    const result = await executeTool(tools, "Write", {
      file_path: "replace.txt",
      content: "new\n"
    });

    expect(result.details).toMatchObject({
      path: "replace.txt",
      operation: "write",
      additions: 1,
      deletions: 1,
      beforeText: "old\n",
      afterText: "new\n"
    });
    expect(result.details?.patch).toContain("-old");
    expect(result.details?.patch).toContain("+new");
  });

  it("rejects replacing an existing file before a full Read", async () => {
    await writeFile(join(dir, "replace-unread.txt"), "old\n", "utf8");

    await expect(
      run(tools, "Write", {
        file_path: "replace-unread.txt",
        content: "new\n"
      })
    ).rejects.toThrow("必须先用 Read 完整读取");
  });

  it("rejects replacing an existing file after only a partial Read", async () => {
    await writeFile(join(dir, "replace-partial.txt"), "one\ntwo\nthree\n", "utf8");
    await run(tools, "Read", { file_path: "replace-partial.txt", offset: 1, limit: 1 });

    await expect(
      run(tools, "Write", {
        file_path: "replace-partial.txt",
        content: "new\n"
      })
    ).rejects.toThrow("只读过部分内容");
  });

  it("allows replacing an existing file after a full Read", async () => {
    await writeFile(join(dir, "replace-read.txt"), "old\n", "utf8");
    await run(tools, "Read", { file_path: "replace-read.txt" });

    await expect(
      run(tools, "Write", {
        file_path: "replace-read.txt",
        content: "new\n"
      })
    ).resolves.toContain("已写入");
    await expect(readFile(join(dir, "replace-read.txt"), "utf8")).resolves.toBe("new\n");
  });

  it("rejects Write when the file changed after Read", async () => {
    await writeFile(join(dir, "replace-stale.txt"), "old\n", "utf8");
    await run(tools, "Read", { file_path: "replace-stale.txt" });
    await writeFile(join(dir, "replace-stale.txt"), "changed\n", "utf8");

    await expect(
      run(tools, "Write", {
        file_path: "replace-stale.txt",
        content: "new\n"
      })
    ).rejects.toThrow("重新 Read");
  });

  it("refreshes read state after Write so a follow-up overwrite can continue", async () => {
    await run(tools, "Write", { file_path: "refresh-write.txt", content: "one\n" });

    await expect(
      run(tools, "Write", {
        file_path: "refresh-write.txt",
        content: "two\n"
      })
    ).resolves.toContain("已写入");
    await expect(readFile(join(dir, "refresh-write.txt"), "utf8")).resolves.toBe("two\n");
  });

  it("Edit requires a unique exact match unless replace_all is true", async () => {
    await writeFile(join(dir, "edit-all.txt"), "one\ntwo\none", "utf8");
    await run(tools, "Read", { file_path: "edit-all.txt" });

    await expect(
      run(tools, "Edit", {
        file_path: "edit-all.txt",
        old_string: "one",
        new_string: "ONE"
      })
    ).rejects.toThrow("默认必须唯一匹配");

    const result = await run(tools, "Edit", {
      file_path: "edit-all.txt",
      old_string: "one",
      new_string: "ONE",
      replace_all: true
    });
    expect(result).toContain("替换 2 处");
    await expect(readFile(join(dir, "edit-all.txt"), "utf8")).resolves.toBe("ONE\ntwo\nONE");
  });

  it("requires Read before Edit but does not require the read slice to contain old_string", async () => {
    await writeFile(join(dir, "edit-partial-read.txt"), "header\ntarget\n", "utf8");
    await run(tools, "Read", { file_path: "edit-partial-read.txt", offset: 1, limit: 1 });

    await expect(
      run(tools, "Edit", {
        file_path: "edit-partial-read.txt",
        old_string: "target",
        new_string: "done"
      })
    ).resolves.toContain("已编辑");
    await expect(readFile(join(dir, "edit-partial-read.txt"), "utf8")).resolves.toBe(
      "header\ndone\n"
    );
  });

  it("rejects Edit when the file has not been read", async () => {
    await writeFile(join(dir, "edit-unread.txt"), "old\n", "utf8");

    await expect(
      run(tools, "Edit", {
        file_path: "edit-unread.txt",
        old_string: "old",
        new_string: "new"
      })
    ).rejects.toThrow("必须先用 Read");
  });

  it("rejects Edit when the file changed after Read", async () => {
    await writeFile(join(dir, "edit-stale.txt"), "old\n", "utf8");
    await run(tools, "Read", { file_path: "edit-stale.txt" });
    await writeFile(join(dir, "edit-stale.txt"), "changed\n", "utf8");

    await expect(
      run(tools, "Edit", {
        file_path: "edit-stale.txt",
        old_string: "changed",
        new_string: "new"
      })
    ).rejects.toThrow("重新 Read");
  });

  it("preserves CRLF line endings when editing text files", async () => {
    await writeFile(join(dir, "crlf.txt"), "first\r\nsecond\r\n", "utf8");
    await run(tools, "Read", { file_path: "crlf.txt" });

    await expect(
      run(tools, "Edit", {
        file_path: "crlf.txt",
        old_string: "second",
        new_string: "SECOND"
      })
    ).resolves.toContain("已编辑");
    await expect(readFile(join(dir, "crlf.txt"), "utf8")).resolves.toBe("first\r\nSECOND\r\n");
  });

  it("Edit returns diff details for replace_all edits", async () => {
    await writeFile(join(dir, "edit-details.txt"), "one\ntwo\none\n", "utf8");
    await run(tools, "Read", { file_path: "edit-details.txt" });

    const result = await executeTool(tools, "Edit", {
      file_path: "edit-details.txt",
      old_string: "one",
      new_string: "ONE",
      replace_all: true
    });

    expect(result.details).toMatchObject({
      path: "edit-details.txt",
      operation: "edit",
      additions: 2,
      deletions: 2,
      beforeText: "one\ntwo\none\n",
      afterText: "ONE\ntwo\nONE\n"
    });
    expect(result.details?.patch).toContain("-one");
    expect(result.details?.patch).toContain("+ONE");
  });

  it("does not return diff details when Edit makes no content change", async () => {
    await writeFile(join(dir, "edit-noop.txt"), "same\n", "utf8");
    await run(tools, "Read", { file_path: "edit-noop.txt" });

    const result = await executeTool(tools, "Edit", {
      file_path: "edit-noop.txt",
      old_string: "same",
      new_string: "same"
    });

    expect(result.details).toBeUndefined();
  });

  it("marks oversized file diffs as truncated", () => {
    const details = buildToolFileChangeDetails({
      path: "large.txt",
      operation: "write",
      before: "",
      after: Array.from({ length: 80_000 }, (_, index) => `line-${index}`).join("\n")
    });

    expect(details).toMatchObject({
      path: "large.txt",
      truncated: true
    });
    expect(details?.patch).toContain("diff 内容过大，已截断");
  });

  it("requires exact replacement args for Edit", async () => {
    await writeFile(join(dir, "edit-args.txt"), "one\ntwo", "utf8");

    await expect(
      run(tools, "Edit", { file_path: "edit-args.txt", old_string: "", new_string: "x" })
    ).rejects.toThrow("old_string");
    await run(tools, "Read", { file_path: "edit-args.txt" });
    await expect(
      run(tools, "Edit", { file_path: "edit-args.txt", old_string: "one", new_string: "ONE" })
    ).resolves.toContain("已编辑");
  });

  it("fails Edit when old_string is missing", async () => {
    await writeFile(join(dir, "a.txt"), "abc", "utf8");
    await run(tools, "Read", { file_path: "a.txt" });
    await expect(
      run(tools, "Edit", { file_path: "a.txt", old_string: "zzz", new_string: "y" })
    ).rejects.toThrow("没有找到要替换的内容");
  });

  it("creates directories and lists them", async () => {
    await run(tools, "MakeDirectory", { path: "a/b/c" });
    await expect(run(tools, "LS", { path: "a/b" })).resolves.toContain("c");
    // LS defaults to the workspace root.
    await expect(run(tools, "LS", {})).resolves.toContain("a");
  });

  it("rejects binary text operations and oversized writes", async () => {
    await writeFile(join(dir, "archive.zip"), Buffer.from([0, 1, 2, 3]));

    await expect(run(tools, "Read", { file_path: "archive.zip" })).rejects.toThrow("二进制");
    await expect(
      run(tools, "Write", {
        file_path: "huge.txt",
        content: "x".repeat(8 * 1024 * 1024 + 1)
      })
    ).rejects.toThrow("超大文本");
  });

  it("suggests a similar path when a file is missing", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "app.ts"), "export const ok = true;\n", "utf8");

    await expect(run(tools, "Read", { file_path: "src/app.tss" })).rejects.toThrow(
      "app.ts"
    );
  });

  it("globs files recursively and ignores node_modules", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "node_modules", "x"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "x", "utf8");
    await writeFile(join(dir, "src", "b.md"), "x", "utf8");
    await writeFile(join(dir, "node_modules", "x", "c.ts"), "x", "utf8");

    const result = await run(tools, "Glob", { pattern: "**/*.ts" });
    expect(result).toContain("src/a.ts");
    expect(result).not.toContain("node_modules");
  });

  it("Grep searches file contents", async () => {
    await writeFile(join(dir, "a.txt"), "alpha\nNEEDLE here\nbeta", "utf8");
    await expect(run(tools, "Grep", { pattern: "needle", "-i": true })).resolves.toContain(
      "a.txt:2"
    );
  });

  it("Grep searches inside a single file path", async () => {
    await writeFile(join(dir, "a.txt"), "alpha\nneedle here\nbeta", "utf8");

    await expect(run(tools, "Grep", { path: "a.txt", pattern: "needle" })).resolves.toContain(
      "a.txt:2"
    );
  });

  it("Grep searches inside nested single file paths", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "export const needle = true;\n", "utf8");
    await writeFile(join(dir, "src", "b.ts"), "export const other = true;\n", "utf8");

    const result = await run(tools, "Grep", { path: "src/a.ts", pattern: "needle" });
    expect(result).toContain("a.ts:1");
    expect(result).not.toContain("b.ts");
  });

  it("Grep fails clearly when the search path is missing", async () => {
    await expect(run(tools, "Grep", { path: "missing-dir", pattern: "needle" })).rejects.toThrow(
      "Grep 找不到搜索路径：missing-dir"
    );
  });

  it("Grep uses the bundled ripgrep path when provided", () => {
    expect(resolveRgCommand({ CHENGXIAOBANG_RG_PATH: "/opt/chengxiaobang/rg" })).toBe(
      "/opt/chengxiaobang/rg"
    );
    expect(resolveRgCommand({})).toBe("rg");
  });

  it("Grep searches and globs explicit absolute paths", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-tools-search-"));
    try {
      await mkdir(join(outsideDir, "src"), { recursive: true });
      await writeFile(join(outsideDir, "src", "outside.ts"), "const needle = true;", "utf8");
      await writeFile(join(outsideDir, "README.md"), "needle docs", "utf8");

      await expect(
        run(tools, "Glob", { path: outsideDir, pattern: "**/*.ts" })
      ).resolves.toContain("src/outside.ts");
      await expect(
        run(tools, "Grep", { path: outsideDir, pattern: "needle" })
      ).resolves.toContain("src/outside.ts:1");
      await expect(
        run(tools, "Grep", { path: join(outsideDir, "src", "outside.ts"), pattern: "needle" })
      ).resolves.toContain("outside.ts:1");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("runs shell commands and throws on non-zero exit", async () => {
    await expect(run(tools, "Bash", { command: "echo hi" })).resolves.toContain("hi");
    await expect(run(tools, "Bash", { command: failingShellCommand(3) })).rejects.toThrow(
      "退出码 3"
    );
  });

  it("runs shell commands in the workspace directory", async () => {
    const result = await run(tools, "Bash", { command: printWorkingDirectoryCommand() });
    expect(await realpath(result.trim())).toBe(await realpath(dir));
  });

  it("moves slow shell commands to the background and writes output to a file", async () => {
    const shellOutputDir = join(dir, "data", SHELL_GLOBAL_OUTPUT_DIR);
    const shellTools = createShellTools(dir, {
      backgroundAfterMs: 50,
      shellOutputDir,
      runId: "run_test"
    });

    const result = await run(shellTools, "Bash", {
      command: delayedEchoCommand("background-done")
    });
    const id = parseBackgroundId(result);
    const outputPath = parseOutputPath(result);

    expect(result).toContain("已转入后台继续运行");
    expect(outputPath.startsWith(join(shellOutputDir, "run_test"))).toBe(true);
    await waitFor(async () => {
      const status = await run(shellTools, "BashStatus", { id });
      expect(status).toContain("状态：completed");
      expect(status).toContain(outputPath);
    });
    await expect(readFile(outputPath, "utf8")).resolves.toContain("background-done");
    await expect(
      readFile(join(dir, ".chengxiaobang", "shell-outputs", basename(outputPath)), "utf8")
    ).rejects.toThrow();
  });

  it("starts shell commands in the background when requested", async () => {
    const shellTools = createShellTools(dir, { backgroundAfterMs: 10_000 });
    const startedAt = Date.now();

    const result = await run(shellTools, "Bash", {
      command: longCommandWithTrailingEcho("should-not-print"),
      run_in_background: true
    });
    const id = parseBackgroundId(result);
    const outputPath = parseOutputPath(result);

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result).toContain("run_in_background=true");
    expect(outputPath).toMatch(/^\.chengxiaobang\/shell-outputs\/shell_/);
    const cancelled = await run(shellTools, "BashCancel", { id });
    expect(cancelled).toContain("状态：aborted");
    await expect(readFile(join(dir, outputPath), "utf8")).resolves.not.toContain(
      "should-not-print"
    );
  });

  it("waits for blocking shell commands before moving them to the background", async () => {
    const shellTools = createShellTools(dir, { backgroundAfterMs: 50 });

    const result = await run(shellTools, "Bash", {
      command: shortDelayedEchoCommand("blocking-done"),
      timeout: 1_000
    });

    expect(result).toContain("blocking-done");
    expect(result).not.toContain("后台命令 ID");
  });

  it("rejects invalid Bash timeout values with a clear message", async () => {
    const shellTools = createShellTools(dir);

    await expect(
      run(shellTools, "Bash", { command: "echo hi", timeout: 600_001 })
    ).rejects.toThrow("timeout 必须是 1 到 600000");
    await expect(
      run(shellTools, "Bash", { command: "echo hi", timeout: "soon" })
    ).rejects.toThrow("timeout 必须是 1 到 600000");
  });

  it("uses Bash.timeout as the foreground wait window before moving to the background", async () => {
    const shellTools = createShellTools(dir, { backgroundAfterMs: 10_000 });
    const result = await run(shellTools, "Bash", {
      command: delayedEchoCommand("timeout-background"),
      timeout: 50
    });
    const id = parseBackgroundId(result);
    const outputPath = parseOutputPath(result);

    expect(result).toContain("timeout=50ms");
    expect(outputPath).toMatch(/^\.chengxiaobang\/shell-outputs\/shell_/);
    await waitFor(async () => {
      const status = await run(shellTools, "BashStatus", { id });
      expect(status).toContain("状态：completed");
      expect(status).toContain(outputPath);
    });
    await expect(readFile(join(dir, outputPath), "utf8")).resolves.toContain(
      "timeout-background"
    );
  });

  it("cancels a background shell command by id", async () => {
    const shellTools = createShellTools(dir, { backgroundAfterMs: 50 });

    const result = await run(shellTools, "Bash", {
      command: longCommandWithTrailingEcho("should-not-print")
    });
    const id = parseBackgroundId(result);
    const outputPath = parseOutputPath(result);

    const cancelled = await run(shellTools, "BashCancel", { id });
    expect(cancelled).toContain("状态：aborted");
    await waitFor(async () => {
      const status = await run(shellTools, "BashStatus", { id });
      expect(status).toContain("状态：aborted");
    });
    await expect(readFile(join(dir, outputPath), "utf8")).resolves.not.toContain("should-not-print");
  });

  it("fetches a url through WebFetch and processes markdown with the injected model handler", async () => {
    const originalFetch = globalThis.fetch;
    let observedMarkdown = "";
    const webFetchTools = createAgentTools(dir, {
      webFetch: {
        processContent: async ({ markdown }) => {
          observedMarkdown = markdown;
          return { text: "模型处理结果" };
        }
      }
    });
    globalThis.fetch = (async () =>
      new Response("<html><body><h1>标题</h1><script>ignore()</script><p>正文</p></body></html>", {
        headers: { "content-type": "text/html" }
      })) as typeof fetch;
    try {
      const result = await run(webFetchTools, "WebFetch", {
        url: "https://example.com",
        prompt: "提取正文"
      });
      expect(result).toContain("WebFetch 结果");
      expect(result).toContain("模型处理结果");
      expect(observedMarkdown).toContain("标题");
      expect(observedMarkdown).toContain("正文");
      expect(observedMarkdown).not.toContain("ignore");
      expect(observedMarkdown).not.toContain("<script");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects non-http urls for WebFetch", async () => {
    await expect(
      run(tools, "WebFetch", { url: "file:///etc/passwd", prompt: "读取" })
    ).rejects.toThrow("仅支持 http");
  });

  it("rejects paths outside the workspace", async () => {
    await expect(run(tools, "Read", { file_path: "../../etc/passwd" })).rejects.toThrow(
      "超出当前项目范围"
    );
    await expect(
      run(tools, "Write", {
        file_path: "../../tmp/out.txt",
        content: "x"
      })
    ).rejects.toThrow("超出当前项目范围");
  });
});

describe("tool approval policy", () => {
  it("marks side-effect-capable tools for approval-aware contexts", () => {
    expect(requiresApproval("Write")).toBe(true);
    expect(requiresApproval("Bash")).toBe(true);
    expect(requiresApproval("PowerShell")).toBe(true);
    expect(requiresApproval("ScheduleCreate")).toBe(true);
    expect(requiresApproval("ToolSearch")).toBe(false);
    expect(requiresApproval("BashStatus")).toBe(false);
    expect(requiresApproval("BashCancel")).toBe(false);
    expect(requiresApproval("Read")).toBe(false);
    expect(requiresApproval("WebSearch")).toBe(false);
    expect(requiresApproval("GitStatus")).toBe(false);
  });

  it("classifies ordinary writes as low risk but keeps sensitive writes gated", () => {
    const workspacePath = join(tmpdir(), "cxb-risk-workspace");
    expect(
      assessToolApprovalRisk("Write", { file_path: "src/app.ts", content: "x" }, { workspacePath })
    ).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(assessToolApprovalRisk("Edit", { file_path: ".env", old_string: "A", new_string: "B" }))
      .toMatchObject({
        risk: "high",
        requiresGate: true,
        smartVerdict: "ask_user"
      });
    expect(
      assessToolApprovalRisk("Write", {
        file_path: "C:\\Users\\me\\repo\\.ssh\\id_rsa",
        content: "x"
      })
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
    expect(
      assessToolApprovalRisk("Write", {
        file_path: "C:\\Users\\me\\repo\\credentials.json",
        content: "x"
      })
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
    expect(
      assessToolApprovalRisk(
        "Write",
        { file_path: "c:\\users\\me\\repo\\src\\app.ts", content: "x" },
        { workspacePath: "C:\\Users\\Me\\Repo", platform: "win32" }
      )
    ).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(
      assessToolApprovalRisk(
        "Write",
        { file_path: "C:\\Users\\Me\\Other\\app.ts", content: "x" },
        { workspacePath: "C:\\Users\\Me\\Repo", platform: "win32" }
      )
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
    expect(
      assessToolApprovalRisk(
        "Write",
        { file_path: join(tmpdir(), "cxb-outside-write.txt"), content: "x" },
        { workspacePath }
      )
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
  });

  it("classifies routine shell commands separately from dangerous shell commands", () => {
    const workspacePath = join(tmpdir(), "cxb-risk-workspace");
    expect(assessToolApprovalRisk("Bash", { command: "pwd" })).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(assessToolApprovalRisk("PowerShell", { command: "Get-ChildItem" })).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(assessToolApprovalRisk("Bash", { command: "npm run dev" })).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(assessToolApprovalRisk("Bash", { command: "rm -rf build" })).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "deny"
    });
    expect(
      assessToolApprovalRisk("PowerShell", { command: "Remove-Item -Recurse build" })
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "deny"
    });
    for (const command of [
      "rmdir /s /q build",
      "del /s *.log",
      "format C:",
      'powershell -NoProfile -Command "Remove-Item -Recurse build"'
    ]) {
      expect(assessToolApprovalRisk("Bash", { command })).toMatchObject({
        risk: "high",
        requiresGate: true,
        smartVerdict: "deny"
      });
    }
    for (const command of ["taskkill /PID 1234 /T /F", "Stop-Process -Id 1234"]) {
      expect(assessToolApprovalRisk("Bash", { command })).toMatchObject({
        risk: "high",
        requiresGate: true,
        smartVerdict: "ask_user"
      });
    }
    for (const command of ["dir", "type package.json", "where node"]) {
      expect(assessToolApprovalRisk("Bash", { command })).toMatchObject({
        risk: "low",
        requiresGate: false
      });
    }
    expect(assessToolApprovalRisk("Bash", { command: "echo hi; echo bye" })).toMatchObject({
      risk: "medium",
      requiresGate: true,
      smartVerdict: "allow"
    });
  });
});

function failingShellCommand(exitCode: number): string {
  return process.platform === "win32" ? `exit /b ${exitCode}` : `exit ${exitCode}`;
}

function printWorkingDirectoryCommand(): string {
  return process.platform === "win32" ? "cd" : "pwd";
}

function delayedEchoCommand(text: string): string {
  return process.platform === "win32"
    ? `ping 127.0.0.1 -n 2 >nul & echo ${text}`
    : `sleep 0.2; echo ${text}`;
}

function shortDelayedEchoCommand(text: string): string {
  return process.platform === "win32"
    ? `powershell -NoProfile -Command "Start-Sleep -Milliseconds 200; Write-Output ${text}"`
    : `sleep 0.2; echo ${text}`;
}

function longCommandWithTrailingEcho(text: string): string {
  return process.platform === "win32"
    ? `ping 127.0.0.1 -n 6 >nul & echo ${text}`
    : `sleep 5; echo ${text}`;
}

function parseBackgroundId(result: string): string {
  const match = result.match(/后台命令 ID：(\S+)/);
  if (!match) {
    throw new Error(`未找到后台命令 ID: ${result}`);
  }
  return match[1];
}

function parseOutputPath(result: string): string {
  const match = result.match(/输出文件：(\S+)/);
  if (!match) {
    throw new Error(`未找到输出文件路径: ${result}`);
  }
  return match[1];
}

async function waitFor(assertion: () => Promise<void>, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
