import { describe, expect, it } from "vitest";
import { parseToolRequest } from "../src/tools/direct-commands";

describe("parseToolRequest", () => {
  it("parses builtin slash commands", () => {
    expect(parseToolRequest("/ls src")).toEqual({
      name: "LS",
      args: { path: "src" }
    });
    expect(parseToolRequest("/ls")).toEqual({ name: "LS", args: { path: "." } });
    expect(parseToolRequest("/read a/b.txt")).toEqual({
      name: "Read",
      args: { file_path: "a/b.txt" }
    });
    expect(parseToolRequest("/write a.txt\nhello\nworld")).toEqual({
      name: "Write",
      args: { file_path: "a.txt", content: "hello\nworld" }
    });
    expect(parseToolRequest("/shell echo hi")).toEqual({
      name: "Bash",
      args: { command: "echo hi" }
    });
    expect(parseToolRequest("/git status")).toEqual({ name: "GitStatus", args: {} });
    expect(parseToolRequest("/git diff")).toEqual({ name: "GitDiff", args: {} });
    expect(parseToolRequest("写一份报告")).toBeUndefined();
  });
});
