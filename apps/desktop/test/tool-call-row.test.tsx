// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import { ToolCallRow } from "../src/renderer/components/ToolCallRow";
import { setupI18n } from "../src/renderer/i18n";
import { resetAppStore } from "../src/renderer/store";

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  resetAppStore();
});

function toolCall(partial: Partial<ToolCall>): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name: "shell",
    args: {},
    status: "completed",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:01.200Z",
    ...partial
  };
}

describe("ToolCallRow", () => {
  it("shows the execution duration for finished calls", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({ startedAt: "2026-06-08T00:00:00.000Z", result: "/tmp" })}
      />
    );
    expect(screen.getByText("1.2s")).toBeInTheDocument();
  });

  it("shows no duration for legacy rows without startedAt", () => {
    render(<ToolCallRow toolCall={toolCall({ result: "/tmp" })} />);
    expect(screen.queryByText(/^\d+(\.\d+)?(ms|s)$/)).not.toBeInTheDocument();
  });

  it("renders localized statuses instead of raw enums", () => {
    const { rerender } = render(<ToolCallRow toolCall={toolCall({ result: "ok" })} />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.queryByText("completed")).not.toBeInTheDocument();

    rerender(<ToolCallRow toolCall={toolCall({ status: "failed", result: "boom" })} />);
    expect(screen.getByText("失败")).toBeInTheDocument();

    rerender(<ToolCallRow toolCall={toolCall({ status: "pending_approval" })} />);
    expect(screen.getByText("待批准")).toBeInTheDocument();
  });

  it("renders an edit_file call as a +/- diff when expanded", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "edit_file",
          args: { path: "a.ts", oldText: "x = 1", newText: "x = 2" },
          result: "已替换 a.ts 中的文本"
        })}
      />
    );

    fireEvent.click(screen.getByText("edit_file"));

    const diff = screen.getByLabelText("变更对比");
    expect(diff).toHaveTextContent("x = 1");
    expect(diff).toHaveTextContent("x = 2");
    expect(diff).toHaveTextContent("-");
    expect(diff).toHaveTextContent("+");
  });

  it("renders a write_file call as all-added lines when expanded", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "write_file",
          args: { path: "a.txt", content: "hello\nworld" },
          result: "已写入 a.txt"
        })}
      />
    );

    fireEvent.click(screen.getByText("write_file"));

    const diff = screen.getByLabelText("变更对比");
    expect(diff).toHaveTextContent("hello");
    expect(diff).toHaveTextContent("world");
  });

  it("keeps the raw result for non-file tools", () => {
    render(<ToolCallRow toolCall={toolCall({ name: "shell", result: "total 0" })} />);

    fireEvent.click(screen.getByText("shell"));

    expect(screen.queryByLabelText("变更对比")).not.toBeInTheDocument();
    expect(screen.getByText("total 0")).toBeInTheDocument();
  });
});
