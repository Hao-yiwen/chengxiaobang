import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createAgentTools, findTool, requiresApproval } from "../src/tools/registry";

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
      "fetch_url",
      "create_pptx",
      "create_docx",
      "create_xlsx",
      "feishu_send_message"
    ]);
  });

  it("writes, reads and edits files", async () => {
    await expect(
      run(tools, "write_file", { path: "notes/todo.md", content: "hello" })
    ).resolves.toContain("已写入");
    await expect(readFile(join(dir, "notes/todo.md"), "utf8")).resolves.toBe("hello");

    await run(tools, "edit_file", { path: "notes/todo.md", oldText: "hello", newText: "world" });
    await expect(run(tools, "read_file", { path: "notes/todo.md" })).resolves.toBe("world");
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

  it("runs shell commands and throws on non-zero exit", async () => {
    await expect(run(tools, "shell", { command: "echo hi" })).resolves.toContain("hi");
    await expect(run(tools, "shell", { command: "exit 3" })).rejects.toThrow("退出码 3");
  });

  it("generates a pptx file", async () => {
    await run(tools, "create_pptx", {
      path: "deck",
      deck: { title: "T", slides: [{ layout: "title", title: "T" }] }
    });
    const buffer = await readFile(join(dir, "deck.pptx"));
    expect(buffer[0]).toBe(0x50); // PK zip header
  });

  it("generates a docx file", async () => {
    await run(tools, "create_docx", {
      path: "report.docx",
      document: { title: "T", blocks: [{ type: "paragraph", text: "x" }] }
    });
    const buffer = await readFile(join(dir, "report.docx"));
    expect(buffer[0]).toBe(0x50);
  });

  it("generates an xlsx file", async () => {
    await run(tools, "create_xlsx", {
      path: "data",
      workbook: {
        sheets: [
          {
            name: "S",
            columns: [{ header: "名称", key: "n" }],
            rows: [{ n: "甲" }, { n: "乙" }]
          }
        ]
      }
    });
    const buffer = await readFile(join(dir, "data.xlsx"));
    expect(buffer[0]).toBe(0x50); // PK zip header
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

  it("requires approval like other mutating tools", () => {
    expect(requiresApproval("feishu_send_message")).toBe(true);
    expect(requiresApproval("write_file")).toBe(true);
    expect(requiresApproval("shell")).toBe(true);
    expect(requiresApproval("read_file")).toBe(false);
    expect(requiresApproval("git_status")).toBe(false);
  });
});
