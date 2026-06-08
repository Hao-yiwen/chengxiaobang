import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nowIso, type ToolCall, type ToolName } from "@chengxiaobang/shared";
import { ToolExecutor, parseToolRequest } from "../src/tools/tool-executor";

function toolCall(name: ToolName, args: Record<string, unknown>): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name,
    args,
    status: "running",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

describe("ToolExecutor", () => {
  let dir: string;
  const executor = new ToolExecutor();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-tools-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes, reads and edits files", async () => {
    const written = await executor.execute(
      toolCall("write_file", { path: "notes/todo.md", content: "hello" }),
      dir
    );
    expect(written.status).toBe("completed");
    await expect(readFile(join(dir, "notes/todo.md"), "utf8")).resolves.toBe("hello");

    const edited = await executor.execute(
      toolCall("edit_file", { path: "notes/todo.md", oldText: "hello", newText: "world" }),
      dir
    );
    expect(edited.status).toBe("completed");
    const read = await executor.execute(toolCall("read_file", { path: "notes/todo.md" }), dir);
    expect(read.result).toBe("world");
  });

  it("creates directories", async () => {
    const result = await executor.execute(toolCall("make_directory", { path: "a/b/c" }), dir);
    expect(result.status).toBe("completed");
    const listed = await executor.execute(toolCall("list_directory", { path: "a/b" }), dir);
    expect(listed.result).toContain("c");
  });

  it("globs files recursively and ignores node_modules", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "node_modules", "x"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "x", "utf8");
    await writeFile(join(dir, "src", "b.md"), "x", "utf8");
    await writeFile(join(dir, "node_modules", "x", "c.ts"), "x", "utf8");

    const result = await executor.execute(toolCall("glob", { pattern: "**/*.ts" }), dir);
    expect(result.result).toContain("src/a.ts");
    expect(result.result).not.toContain("node_modules");
  });

  it("searches file contents", async () => {
    await writeFile(join(dir, "a.txt"), "alpha\nNEEDLE here\nbeta", "utf8");
    const result = await executor.execute(toolCall("search", { query: "needle" }), dir);
    expect(result.result).toContain("a.txt:2");
  });

  it("generates a pptx file", async () => {
    const result = await executor.execute(
      toolCall("create_pptx", {
        path: "deck",
        deck: { title: "T", slides: [{ layout: "title", title: "T" }] }
      }),
      dir
    );
    expect(result.status).toBe("completed");
    const buffer = await readFile(join(dir, "deck.pptx"));
    expect(buffer[0]).toBe(0x50); // PK zip header
  });

  it("generates a docx file", async () => {
    const result = await executor.execute(
      toolCall("create_docx", {
        path: "report.docx",
        document: { title: "T", blocks: [{ type: "paragraph", text: "x" }] }
      }),
      dir
    );
    expect(result.status).toBe("completed");
    const buffer = await readFile(join(dir, "report.docx"));
    expect(buffer[0]).toBe(0x50);
  });

  it("generates an xlsx file", async () => {
    const result = await executor.execute(
      toolCall("create_xlsx", {
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
      }),
      dir
    );
    expect(result.status).toBe("completed");
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
      const result = await executor.execute(
        toolCall("fetch_url", { url: "https://example.com" }),
        dir
      );
      expect(result.result).toContain("标题");
      expect(result.result).toContain("正文");
      expect(result.result).not.toContain("ignore");
      expect(result.result).not.toContain("<");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects non-http urls for fetch_url", async () => {
    await expect(
      executor.execute(toolCall("fetch_url", { url: "file:///etc/passwd" }), dir)
    ).rejects.toThrow("仅支持 http");
  });

  it("rejects paths outside the workspace", async () => {
    await expect(
      executor.execute(toolCall("read_file", { path: "../../etc/passwd" }), dir)
    ).rejects.toThrow("超出当前项目范围");
  });
});

describe("parseToolRequest", () => {
  it("parses builtin slash commands", () => {
    expect(parseToolRequest("/ls src")).toEqual({
      name: "list_directory",
      args: { path: "src" }
    });
    expect(parseToolRequest("/git status")).toEqual({ name: "git_status", args: {} });
    expect(parseToolRequest("写一份报告")).toBeUndefined();
  });
});
