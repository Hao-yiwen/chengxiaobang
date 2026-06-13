import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createMemoryTools,
  renderMemoryListing,
  resolveMemoryPath
} from "../src/tools/memory-tools";

async function run(tool: AgentTool<any>, args: Record<string, unknown>): Promise<string> {
  const result = await tool.execute("tool_1", args);
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

describe("memory tool", () => {
  let dir: string;
  let memory: AgentTool<any>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-memory-"));
    const tools = createMemoryTools(dir);
    expect(tools.map((tool) => tool.name)).toEqual(["memory"]);
    memory = tools[0];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("view 根目录：空目录给出空提示，有内容时按两层列出大小与路径", async () => {
    await expect(run(memory, { command: "view" })).resolves.toContain("目录为空");

    await mkdir(join(dir, "projects"), { recursive: true });
    await writeFile(join(dir, "user.md"), "用户喜欢简洁回复\n");
    await writeFile(join(dir, "projects", "demo.md"), "demo 项目约定\n");
    const listing = await run(memory, { command: "view", path: "/memories" });
    expect(listing).toContain("/memories/user.md");
    expect(listing).toContain("/memories/projects/");
    expect(listing).toContain("/memories/projects/demo.md");
  });

  it("view 文件：带 6 位右对齐行号，支持 view_range", async () => {
    await writeFile(join(dir, "notes.md"), "第一行\n第二行\n第三行");
    const full = await run(memory, { command: "view", path: "/memories/notes.md" });
    expect(full).toContain("     1\t第一行");
    expect(full).toContain("     3\t第三行");

    const ranged = await run(memory, {
      command: "view",
      path: "/memories/notes.md",
      view_range: [2, 2]
    });
    expect(ranged).toContain("     2\t第二行");
    expect(ranged).not.toContain("第一行");
    expect(ranged).not.toContain("第三行");
  });

  it("view 不存在的路径与非法 view_range 报错", async () => {
    await expect(run(memory, { command: "view", path: "/memories/none.md" })).rejects.toThrow(
      "不存在"
    );
    await writeFile(join(dir, "a.md"), "x");
    await expect(
      run(memory, { command: "view", path: "/memories/a.md", view_range: [3, 1] })
    ).rejects.toThrow("view_range");
  });

  it("create 自动创建父目录写入文件；已存在时拒绝覆盖", async () => {
    await run(memory, {
      command: "create",
      path: "/memories/projects/demo.md",
      file_text: "约定 A\n"
    });
    await expect(readFile(join(dir, "projects", "demo.md"), "utf8")).resolves.toBe("约定 A\n");
    await expect(
      run(memory, { command: "create", path: "/memories/projects/demo.md", file_text: "覆盖" })
    ).rejects.toThrow("已存在");
  });

  it("str_replace 做唯一精确替换；缺失或多处出现时报错", async () => {
    await writeFile(join(dir, "prefs.md"), "喜欢的颜色: 蓝色\n喜欢的语言: TypeScript\n");
    await run(memory, {
      command: "str_replace",
      path: "/memories/prefs.md",
      old_str: "蓝色",
      new_str: "绿色"
    });
    await expect(readFile(join(dir, "prefs.md"), "utf8")).resolves.toContain("绿色");

    await expect(
      run(memory, { command: "str_replace", path: "/memories/prefs.md", old_str: "紫色", new_str: "x" })
    ).rejects.toThrow("没有替换");
    await expect(
      run(memory, { command: "str_replace", path: "/memories/prefs.md", old_str: "喜欢的", new_str: "x" })
    ).rejects.toThrow("2 次");
  });

  it("insert 在指定行后插入文本并校验行号范围", async () => {
    await writeFile(join(dir, "todo.md"), "- 任务一\n- 任务三");
    await run(memory, {
      command: "insert",
      path: "/memories/todo.md",
      insert_line: 1,
      insert_text: "- 任务二"
    });
    await expect(readFile(join(dir, "todo.md"), "utf8")).resolves.toBe(
      "- 任务一\n- 任务二\n- 任务三"
    );
    await expect(
      run(memory, { command: "insert", path: "/memories/todo.md", insert_line: 99, insert_text: "x" })
    ).rejects.toThrow("insert_line 不合法");
  });

  it("delete 递归删除文件或目录，但拒绝删除根目录", async () => {
    await mkdir(join(dir, "old"), { recursive: true });
    await writeFile(join(dir, "old", "a.md"), "x");
    await run(memory, { command: "delete", path: "/memories/old" });
    await expect(stat(join(dir, "old"))).rejects.toThrow();

    await expect(run(memory, { command: "delete", path: "/memories" })).rejects.toThrow(
      "不能删除记忆根目录"
    );
    await expect(run(memory, { command: "delete", path: "/memories/none" })).rejects.toThrow(
      "不存在"
    );
  });

  it("rename 移动文件并拒绝覆盖已有目标", async () => {
    await writeFile(join(dir, "draft.md"), "草稿");
    await run(memory, {
      command: "rename",
      old_path: "/memories/draft.md",
      new_path: "/memories/archive/final.md"
    });
    await expect(readFile(join(dir, "archive", "final.md"), "utf8")).resolves.toBe("草稿");

    await writeFile(join(dir, "draft.md"), "新草稿");
    await expect(
      run(memory, {
        command: "rename",
        old_path: "/memories/draft.md",
        new_path: "/memories/archive/final.md"
      })
    ).rejects.toThrow("已存在");
  });

  it("拒绝路径穿越与 /memories 之外的路径", async () => {
    await expect(run(memory, { command: "view", path: "/etc/passwd" })).rejects.toThrow(
      "/memories 开头"
    );
    await expect(
      run(memory, { command: "view", path: "/memories/../escape.md" })
    ).rejects.toThrow("越出");
    await expect(
      run(memory, { command: "create", path: "/memories/../../escape.md", file_text: "x" })
    ).rejects.toThrow("越出");
    expect(() => resolveMemoryPath(dir, "/memories/a/../../b")).toThrow("越出");
  });

  it("缺少必需参数时给出可指导模型的报错", async () => {
    await expect(run(memory, { command: "create", path: "/memories/a.md" })).rejects.toThrow(
      "file_text"
    );
    await expect(run(memory, { command: "rename", old_path: "/memories/a.md" })).rejects.toThrow(
      "new_path"
    );
  });
});

describe("renderMemoryListing", () => {
  it("目录缺失或为空时返回 undefined，并跳过隐藏文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cxb-memory-listing-"));
    try {
      await expect(renderMemoryListing(join(dir, "missing"))).resolves.toBeUndefined();
      await writeFile(join(dir, ".hidden"), "x");
      await expect(renderMemoryListing(dir)).resolves.toBeUndefined();
      await writeFile(join(dir, "visible.md"), "x");
      await expect(renderMemoryListing(dir)).resolves.toContain("/memories/visible.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
