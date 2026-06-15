// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import { ToolCallGroup } from "../src/renderer/components/ToolCallGroup";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

let counter = 0;

function toolCall(partial: Partial<ToolCall>): ToolCall {
  counter += 1;
  return {
    id: `tool_${counter}`,
    runId: "run_1",
    name: "Read",
    args: { file_path: "a.ts" },
    status: "completed",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:01.000Z",
    ...partial
  };
}

describe("ToolCallGroup", () => {
  it("collapses to a category summary by default", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          toolCall({ name: "Read" }),
          toolCall({ name: "Read", args: { file_path: "b.ts" } }),
          toolCall({ name: "Bash", args: { command: "pnpm test" } })
        ]}
      />
    );

    expect(screen.getByText("读取 2 个文件 · 运行 1 条命令")).toBeInTheDocument();
    expect(screen.queryByText("读取 a.ts")).not.toBeInTheDocument();
  });

  it("expands to one description line per call, each expandable to its result", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          toolCall({ name: "Read", result: "file body" }),
          toolCall({ name: "Grep", args: { pattern: "foo" }, result: "3 matches" })
        ]}
      />
    );

    fireEvent.click(screen.getByText("读取 1 个文件 · 检索 1 次"));
    expect(screen.getByText("读取 a.ts")).toBeInTheDocument();
    expect(screen.getByText("搜索 foo")).toBeInTheDocument();
    expect(screen.queryByText("3 matches")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("搜索 foo"));
    expect(screen.getByText("3 matches")).toBeInTheDocument();
  });

  it("appends the running call's description to the header", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          toolCall({ name: "Read" }),
          toolCall({ name: "Bash", args: { command: "pnpm dev" }, status: "running" })
        ]}
      />
    );

    expect(
      screen.getByText("读取 1 个文件 · 运行 1 条命令 · 运行 pnpm dev")
    ).toBeInTheDocument();
  });

  it("surfaces a failure count but stays collapsed", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          toolCall({ name: "Read" }),
          toolCall({ name: "Bash", args: { command: "x" }, status: "failed", result: "boom" })
        ]}
      />
    );

    expect(screen.getByText("1 失败")).toBeInTheDocument();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("keeps the expanded state when a new call streams into the group", () => {
    const first = toolCall({ name: "Read" });
    const second = toolCall({ name: "Read", args: { file_path: "b.ts" } });
    const { rerender } = render(<ToolCallGroup toolCalls={[first, second]} />);

    fireEvent.click(screen.getByText("读取 2 个文件"));
    expect(screen.getByText("读取 a.ts")).toBeInTheDocument();

    rerender(
      <ToolCallGroup
        toolCalls={[first, second, toolCall({ name: "Bash", args: { command: "pnpm test" } })]}
      />
    );
    expect(screen.getByText("读取 a.ts")).toBeInTheDocument();
    expect(screen.getByText("运行 pnpm test")).toBeInTheDocument();
  });

  it("wires the file preview callback through to inner lines", () => {
    const onOpenFile = vi.fn();
    render(
      <ToolCallGroup
        toolCalls={[
          toolCall({ name: "Read", args: { file_path: "src/index.ts" } }),
          toolCall({ name: "Bash", args: { command: "ls" } })
        ]}
        onOpenFile={onOpenFile}
      />
    );

    fireEvent.click(screen.getByText("读取 1 个文件 · 运行 1 条命令"));
    fireEvent.click(screen.getByTitle("预览文件"));
    expect(onOpenFile).toHaveBeenCalledWith("src/index.ts", "code");
  });
});
