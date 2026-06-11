import { describe, expect, it } from "vitest";
import { parseToolRequest } from "../src/tools/direct-commands";

describe("parseToolRequest", () => {
  it("parses builtin slash commands", () => {
    expect(parseToolRequest("/ls src")).toEqual({
      name: "list_directory",
      args: { path: "src" }
    });
    expect(parseToolRequest("/ls")).toEqual({ name: "list_directory", args: { path: "." } });
    expect(parseToolRequest("/read a/b.txt")).toEqual({
      name: "read_file",
      args: { path: "a/b.txt" }
    });
    expect(parseToolRequest("/write a.txt\nhello\nworld")).toEqual({
      name: "write_file",
      args: { path: "a.txt", content: "hello\nworld" }
    });
    expect(parseToolRequest("/shell echo hi")).toEqual({
      name: "shell",
      args: { command: "echo hi" }
    });
    expect(parseToolRequest("/git status")).toEqual({ name: "git_status", args: {} });
    expect(parseToolRequest("/git diff")).toEqual({ name: "git_diff", args: {} });
    expect(parseToolRequest("写一份报告")).toBeUndefined();
  });
});
