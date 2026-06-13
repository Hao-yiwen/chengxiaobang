import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createAgentTools, findTool, requiresApproval } from "../src/tools/registry";
import { assessToolApprovalRisk } from "../src/tools/approval-policy";
import { createShellTools } from "../src/tools/shell-tools";

async function run(
  tools: AgentTool<any>[],
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = findTool(tools, name);
  if (!tool) {
    throw new Error(`tool not registered: ${name}`);
  }
  const result = await tool.execute("tool_1", args);
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
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
      "list_directory",
      "read_file",
      "write_file",
      "edit_file",
      "make_directory",
      "glob",
      "search",
      "shell",
      "git_status",
      "git_diff",
      "shell_status",
      "shell_cancel",
      "fetch_url",
      "feishu_send_message"
    ]);
  });

  it("registers memory only when a memoryDir is configured, exempt from approval", async () => {
    expect(tools.map((tool) => tool.name)).not.toContain("memory");

    const memoryDir = join(dir, "memories");
    const withMemory = createAgentTools(dir, { memoryDir });
    expect(withMemory.map((tool) => tool.name)).toContain("memory");
    // 记忆读写仅限专用目录，不进审批队列，否则 headless 定时任务会被自动拒绝。
    expect(requiresApproval("memory")).toBe(false);
    await expect(
      run(withMemory, "memory", {
        command: "create",
        path: "/memories/note.md",
        file_text: "记一笔"
      })
    ).resolves.toContain("已创建");
    await expect(readFile(join(memoryDir, "note.md"), "utf8")).resolves.toBe("记一笔");
  });

  it("registers web_search only when a Tavily searcher is injected", async () => {
    const tools = createAgentTools(dir, {
      webSearch: async ({ query }) => `结果：${query}`
    });

    expect(tools.map((tool) => tool.name)).toContain("web_search");
    await expect(run(tools, "web_search", { query: "Tavily", maxResults: 1 })).resolves.toContain(
      "结果：Tavily"
    );
  });

  it("writes, reads and edits files", async () => {
    await expect(
      run(tools, "write_file", { path: "notes/todo.md", content: "hello" })
    ).resolves.toContain("已写入");
    await expect(readFile(join(dir, "notes/todo.md"), "utf8")).resolves.toBe("hello");

    await run(tools, "edit_file", { path: "notes/todo.md", oldText: "hello", newText: "world" });
    await expect(run(tools, "read_file", { path: "notes/todo.md" })).resolves.toBe("world");
  });

  it("operates on explicit absolute file paths", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-tools-outside-"));
    try {
      const outsideFile = join(outsideDir, "resource.txt");
      await writeFile(outsideFile, "外部技能资源", "utf8");

      await expect(run(tools, "read_file", { path: outsideFile })).resolves.toBe("外部技能资源");
      await expect(run(tools, "list_directory", { path: outsideDir })).resolves.toContain(
        "file resource.txt"
      );
      const createdFile = join(outsideDir, "created.txt");
      await expect(
        run(tools, "write_file", { path: createdFile, content: "x" })
      ).resolves.toContain("已写入");
      await run(tools, "edit_file", { path: createdFile, oldText: "x", newText: "y" });
      await expect(readFile(createdFile, "utf8")).resolves.toBe("y");
      await expect(
        run(tools, "make_directory", { path: join(outsideDir, "nested") })
      ).resolves.toContain("已创建目录");
      await expect(run(tools, "list_directory", { path: outsideDir })).resolves.toContain(
        "dir  nested"
      );
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("reads file line ranges when requested", async () => {
    await writeFile(join(dir, "notes.txt"), "one\ntwo\nthree\nfour", "utf8");

    const result = await run(tools, "read_file", {
      path: "notes.txt",
      startLine: 2,
      lineLimit: 2
    });

    expect(result).toContain("notes.txt 的第 2-3 行（共 4 行）");
    expect(result).toContain("     2\ttwo");
    expect(result).toContain("     3\tthree");
    expect(result).toContain("startLine=4");
    expect(result).not.toContain("one");
  });

  it("returns a line-range hint instead of reading oversized files fully", async () => {
    await writeFile(join(dir, "large.txt"), "x".repeat(300 * 1024), "utf8");

    const result = await run(tools, "read_file", { path: "large.txt" });

    expect(result).toContain("超过完整读取上限");
    expect(result).toContain("startLine");
    expect(result).toContain("lineLimit");
  });

  it("writes file line ranges by inserting, replacing and appending", async () => {
    await writeFile(join(dir, "lines.txt"), "one\ntwo\nthree", "utf8");

    await run(tools, "write_file", {
      path: "lines.txt",
      startLine: 2,
      deleteLineCount: 0,
      content: "inserted"
    });
    await expect(readFile(join(dir, "lines.txt"), "utf8")).resolves.toBe(
      "one\ninserted\ntwo\nthree"
    );

    await run(tools, "write_file", {
      path: "lines.txt",
      startLine: 3,
      deleteLineCount: 1,
      content: "TWO"
    });
    await expect(readFile(join(dir, "lines.txt"), "utf8")).resolves.toBe(
      "one\ninserted\nTWO\nthree"
    );

    await run(tools, "write_file", {
      path: "lines.txt",
      startLine: 5,
      deleteLineCount: 0,
      content: "four\nfive\n"
    });
    await expect(readFile(join(dir, "lines.txt"), "utf8")).resolves.toBe(
      "one\ninserted\nTWO\nthree\nfour\nfive"
    );
  });

  it("creates a missing file through line-level write only at the first insert position", async () => {
    await run(tools, "write_file", {
      path: "new-lines.txt",
      startLine: 1,
      deleteLineCount: 0,
      content: "first\nsecond"
    });
    await expect(readFile(join(dir, "new-lines.txt"), "utf8")).resolves.toBe("first\nsecond");

    await expect(
      run(tools, "write_file", {
        path: "missing-lines.txt",
        startLine: 2,
        deleteLineCount: 0,
        content: "x"
      })
    ).rejects.toThrow("目标文件不存在");
  });

  it("rejects invalid line-level write ranges", async () => {
    await writeFile(join(dir, "invalid-lines.txt"), "one\ntwo", "utf8");

    await expect(
      run(tools, "write_file", {
        path: "invalid-lines.txt",
        startLine: 0,
        deleteLineCount: 0,
        content: "x"
      })
    ).rejects.toThrow("startLine");
    await expect(
      run(tools, "write_file", {
        path: "invalid-lines.txt",
        startLine: 2,
        deleteLineCount: -1,
        content: "x"
      })
    ).rejects.toThrow("deleteLineCount");
    await expect(
      run(tools, "write_file", {
        path: "invalid-lines.txt",
        startLine: 5,
        deleteLineCount: 0,
        content: "x"
      })
    ).rejects.toThrow("startLine 超出文件范围");
  });

  it("edits file line ranges by replacing and inserting", async () => {
    await writeFile(join(dir, "edit-lines.txt"), "one\ntwo\nthree", "utf8");

    await run(tools, "edit_file", {
      path: "edit-lines.txt",
      startLine: 2,
      deleteLineCount: 1,
      newText: "TWO\nTWO-B"
    });
    await expect(readFile(join(dir, "edit-lines.txt"), "utf8")).resolves.toBe(
      "one\nTWO\nTWO-B\nthree"
    );

    await run(tools, "edit_file", {
      path: "edit-lines.txt",
      startLine: 2,
      deleteLineCount: 0,
      newText: "inserted"
    });
    await expect(readFile(join(dir, "edit-lines.txt"), "utf8")).resolves.toBe(
      "one\ninserted\nTWO\nTWO-B\nthree"
    );
  });

  it("requires either oldText replacement args or complete line-level edit args", async () => {
    await writeFile(join(dir, "edit-args.txt"), "one\ntwo", "utf8");

    await expect(
      run(tools, "edit_file", { path: "edit-args.txt", newText: "x" })
    ).rejects.toThrow("oldText");
    await expect(
      run(tools, "edit_file", { path: "edit-args.txt", startLine: 1, newText: "x" })
    ).rejects.toThrow("deleteLineCount");
  });

  it("fails edit_file when the old text is missing", async () => {
    await writeFile(join(dir, "a.txt"), "abc", "utf8");
    await expect(
      run(tools, "edit_file", { path: "a.txt", oldText: "zzz", newText: "y" })
    ).rejects.toThrow("没有找到要替换的内容");
  });

  it("creates directories and lists them", async () => {
    await run(tools, "make_directory", { path: "a/b/c" });
    await expect(run(tools, "list_directory", { path: "a/b" })).resolves.toContain("c");
    // list_directory defaults to the workspace root.
    await expect(run(tools, "list_directory", {})).resolves.toContain("a");
  });

  it("globs files recursively and ignores node_modules", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "node_modules", "x"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "x", "utf8");
    await writeFile(join(dir, "src", "b.md"), "x", "utf8");
    await writeFile(join(dir, "node_modules", "x", "c.ts"), "x", "utf8");

    const result = await run(tools, "glob", { pattern: "**/*.ts" });
    expect(result).toContain("src/a.ts");
    expect(result).not.toContain("node_modules");
  });

  it("searches file contents", async () => {
    await writeFile(join(dir, "a.txt"), "alpha\nNEEDLE here\nbeta", "utf8");
    await expect(run(tools, "search", { query: "needle" })).resolves.toContain("a.txt:2");
  });

  it("searches and globs explicit absolute directories", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-tools-search-"));
    try {
      await mkdir(join(outsideDir, "src"), { recursive: true });
      await writeFile(join(outsideDir, "src", "outside.ts"), "const needle = true;", "utf8");
      await writeFile(join(outsideDir, "README.md"), "needle docs", "utf8");

      await expect(
        run(tools, "glob", { path: outsideDir, pattern: "**/*.ts" })
      ).resolves.toContain("src/outside.ts");
      await expect(run(tools, "search", { path: outsideDir, query: "needle" })).resolves.toContain(
        "src/outside.ts:1"
      );
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("runs shell commands and throws on non-zero exit", async () => {
    await expect(run(tools, "shell", { command: "echo hi" })).resolves.toContain("hi");
    await expect(run(tools, "shell", { command: failingShellCommand(3) })).rejects.toThrow(
      "退出码 3"
    );
  });

  it("runs shell commands with an explicit absolute cwd", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-tools-shell-"));
    try {
      await expect(
        run(tools, "shell", { command: printWorkingDirectoryCommand(), cwd: outsideDir })
      ).resolves.toContain(outsideDir);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("moves slow shell commands to the background and writes output to a file", async () => {
    const shellTools = createShellTools(dir, { backgroundAfterMs: 50 });

    const result = await run(shellTools, "shell", {
      command: delayedEchoCommand("background-done")
    });
    const id = parseBackgroundId(result);
    const outputPath = parseOutputPath(result);

    expect(result).toContain("已转入后台继续运行");
    expect(outputPath).toMatch(/^\.chengxiaobang\/shell-outputs\/shell_/);
    await waitFor(async () => {
      const status = await run(shellTools, "shell_status", { id });
      expect(status).toContain("状态：completed");
    });
    await expect(readFile(join(dir, outputPath), "utf8")).resolves.toContain("background-done");
  });

  it("starts shell commands in the background when requested", async () => {
    const shellTools = createShellTools(dir, { backgroundAfterMs: 10_000 });
    const startedAt = Date.now();

    const result = await run(shellTools, "shell", {
      command: longCommandWithTrailingEcho("should-not-print"),
      background: true
    });
    const id = parseBackgroundId(result);
    const outputPath = parseOutputPath(result);

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result).toContain("background=true");
    expect(outputPath).toMatch(/^\.chengxiaobang\/shell-outputs\/shell_/);
    const cancelled = await run(shellTools, "shell_cancel", { id });
    expect(cancelled).toContain("状态：aborted");
    await expect(readFile(join(dir, outputPath), "utf8")).resolves.not.toContain(
      "should-not-print"
    );
  });

  it("returns an absolute background output path for shell commands outside the workspace", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "cxb-tools-shell-outside-"));
    const shellTools = createShellTools(dir, { backgroundAfterMs: 10_000 });
    try {
      const result = await run(shellTools, "shell", {
        command: delayedEchoCommand("outside-background"),
        cwd: outsideDir,
        background: true
      });
      const id = parseBackgroundId(result);
      const outputPath = parseOutputPath(result);

      expect(outputPath).toContain(outsideDir);
      await waitFor(async () => {
        const status = await run(shellTools, "shell_status", { id });
        expect(status).toContain("状态：completed");
        expect(status).toContain(outputPath);
      });
      await expect(readFile(outputPath, "utf8")).resolves.toContain("outside-background");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("cancels a background shell command by id", async () => {
    const shellTools = createShellTools(dir, { backgroundAfterMs: 50 });

    const result = await run(shellTools, "shell", {
      command: longCommandWithTrailingEcho("should-not-print")
    });
    const id = parseBackgroundId(result);
    const outputPath = parseOutputPath(result);

    const cancelled = await run(shellTools, "shell_cancel", { id });
    expect(cancelled).toContain("状态：aborted");
    await waitFor(async () => {
      const status = await run(shellTools, "shell_status", { id });
      expect(status).toContain("状态：aborted");
    });
    await expect(readFile(join(dir, outputPath), "utf8")).resolves.not.toContain("should-not-print");
  });

  it("fetches a url and strips html to text", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<html><body><h1>标题</h1><script>ignore()</script><p>正文</p></body></html>", {
        headers: { "content-type": "text/html" }
      })) as typeof fetch;
    try {
      const result = await run(tools, "fetch_url", { url: "https://example.com" });
      expect(result).toContain("标题");
      expect(result).toContain("正文");
      expect(result).not.toContain("ignore");
      expect(result).not.toContain("<");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects non-http urls for fetch_url", async () => {
    await expect(run(tools, "fetch_url", { url: "file:///etc/passwd" })).rejects.toThrow(
      "仅支持 http"
    );
  });

  it("rejects paths outside the workspace", async () => {
    await expect(run(tools, "read_file", { path: "../../etc/passwd" })).rejects.toThrow(
      "超出当前项目范围"
    );
    await expect(
      run(tools, "write_file", {
        path: "../../tmp/out.txt",
        content: "x",
        startLine: 1,
        deleteLineCount: 0
      })
    ).rejects.toThrow("超出当前项目范围");
  });
});

describe("feishu_send_message tool", () => {
  it("sends through the injected sender and reports success", async () => {
    const sent: Array<{ chatId: string; text: string }> = [];
    const tools = createAgentTools("/tmp", () => ({
      async sendText(chatId: string, text: string) {
        sent.push({ chatId, text });
      }
    }));

    const result = await run(tools, "feishu_send_message", {
      chatId: "oc_123",
      content: "进度：已完成"
    });

    expect(sent).toEqual([{ chatId: "oc_123", text: "进度：已完成" }]);
    expect(result).toContain("oc_123");
  });

  it("fails with a configuration hint when no sender is available", async () => {
    const tools = createAgentTools("/tmp");
    await expect(
      run(tools, "feishu_send_message", { chatId: "oc_123", content: "hi" })
    ).rejects.toThrow("飞书未配置或未启用");
  });

  it("marks side-effect-capable tools for approval-aware contexts", () => {
    expect(requiresApproval("feishu_send_message")).toBe(true);
    expect(requiresApproval("write_file")).toBe(true);
    expect(requiresApproval("shell")).toBe(true);
    expect(requiresApproval("schedule_create")).toBe(true);
    expect(requiresApproval("shell_status")).toBe(false);
    expect(requiresApproval("shell_cancel")).toBe(false);
    expect(requiresApproval("read_file")).toBe(false);
    expect(requiresApproval("web_search")).toBe(false);
    expect(requiresApproval("git_status")).toBe(false);
  });

  it("classifies ordinary writes as low risk but keeps sensitive writes gated", () => {
    const workspacePath = join(tmpdir(), "cxb-risk-workspace");
    expect(
      assessToolApprovalRisk("write_file", { path: "src/app.ts", content: "x" }, { workspacePath })
    ).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(assessToolApprovalRisk("edit_file", { path: ".env", oldText: "A", newText: "B" }))
      .toMatchObject({
        risk: "high",
        requiresGate: true,
        smartVerdict: "ask_user"
      });
    expect(
      assessToolApprovalRisk("write_file", {
        path: "C:\\Users\\me\\repo\\.ssh\\id_rsa",
        content: "x"
      })
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
    expect(
      assessToolApprovalRisk("write_file", {
        path: "C:\\Users\\me\\repo\\credentials.json",
        content: "x"
      })
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
    expect(
      assessToolApprovalRisk(
        "write_file",
        { path: "c:\\users\\me\\repo\\src\\app.ts", content: "x" },
        { workspacePath: "C:\\Users\\Me\\Repo", platform: "win32" }
      )
    ).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(
      assessToolApprovalRisk(
        "write_file",
        { path: "C:\\Users\\Me\\Other\\app.ts", content: "x" },
        { workspacePath: "C:\\Users\\Me\\Repo", platform: "win32" }
      )
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
    expect(
      assessToolApprovalRisk(
        "write_file",
        { path: join(tmpdir(), "cxb-outside-write.txt"), content: "x" },
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
    expect(assessToolApprovalRisk("shell", { command: "pwd" })).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(assessToolApprovalRisk("shell", { command: "npm run dev" })).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(
      assessToolApprovalRisk(
        "shell",
        { command: "pwd", cwd: join(tmpdir(), "cxb-outside-cwd") },
        { workspacePath }
      )
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
    expect(
      assessToolApprovalRisk(
        "shell",
        { command: "dir", cwd: "c:\\users\\me\\repo\\src" },
        { workspacePath: "C:\\Users\\Me\\Repo", platform: "win32" }
      )
    ).toMatchObject({
      risk: "low",
      requiresGate: false
    });
    expect(
      assessToolApprovalRisk(
        "shell",
        { command: "dir", cwd: "C:\\Users\\Me\\Other" },
        { workspacePath: "C:\\Users\\Me\\Repo", platform: "win32" }
      )
    ).toMatchObject({
      risk: "high",
      requiresGate: true,
      smartVerdict: "ask_user"
    });
    expect(assessToolApprovalRisk("shell", { command: "rm -rf build" })).toMatchObject({
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
      expect(assessToolApprovalRisk("shell", { command })).toMatchObject({
        risk: "high",
        requiresGate: true,
        smartVerdict: "deny"
      });
    }
    for (const command of ["taskkill /PID 1234 /T /F", "Stop-Process -Id 1234"]) {
      expect(assessToolApprovalRisk("shell", { command })).toMatchObject({
        risk: "high",
        requiresGate: true,
        smartVerdict: "ask_user"
      });
    }
    for (const command of ["dir", "type package.json", "where node"]) {
      expect(assessToolApprovalRisk("shell", { command })).toMatchObject({
        risk: "low",
        requiresGate: false
      });
    }
    expect(assessToolApprovalRisk("shell", { command: "echo hi; echo bye" })).toMatchObject({
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
