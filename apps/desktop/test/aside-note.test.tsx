// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import {
  AsideNote,
  buildTaskDraft,
  type AsideNoteLayout
} from "../src/renderer/components/AsideNote";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function btwToolCall(args: Record<string, unknown>): ToolCall {
  return {
    id: "tool_btw",
    runId: "run_1",
    name: "btw",
    args,
    status: "completed",
    result: "已记录旁注",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}

describe("AsideNote（UI-SPEC §9 / ARCH-SPEC §4.5 btw 旁注）", () => {
  it("renders the note plus a 建议 line in the kai-script aside style", () => {
    const { container } = render(
      <AsideNote
        toolCall={btwToolCall({ note: "测试目录缺少覆盖率配置", suggestion: "补一个 vitest coverage" })}
        layout="inline"
        converted={false}
        onConvertToTask={vi.fn()}
      />
    );
    expect(screen.getByText("测试目录缺少覆盖率配置")).toBeInTheDocument();
    expect(screen.getByText(/建议：补一个 vitest coverage/)).toBeInTheDocument();
    const aside = container.querySelector("aside");
    expect(aside).toHaveClass("font-note", "border-ochre");
  });

  it("omits the 建议 line when no suggestion is given", () => {
    render(
      <AsideNote
        toolCall={btwToolCall({ note: "只有旁注" })}
        layout="inline"
        converted={false}
        onConvertToTask={vi.fn()}
      />
    );
    expect(screen.getByText("只有旁注")).toBeInTheDocument();
    expect(screen.queryByText(/建议：/)).not.toBeInTheDocument();
  });

  it("exposes the three layouts via data-layout and width classes", () => {
    const widths: Record<AsideNoteLayout, string> = {
      "gutter-wide": "w-[220px]",
      "gutter-narrow": "w-[180px]",
      inline: "ml-6"
    };
    for (const [layout, className] of Object.entries(widths) as [AsideNoteLayout, string][]) {
      const { container, unmount } = render(
        <AsideNote
          toolCall={btwToolCall({ note: "n" })}
          layout={layout}
          converted={false}
          onConvertToTask={vi.fn()}
        />
      );
      const aside = container.querySelector("aside");
      expect(aside).toHaveAttribute("data-layout", layout);
      expect(aside).toHaveClass(className);
      unmount();
    }
  });

  it("converts to a task with the ARCH-SPEC draft format (note + suggestion)", () => {
    const onConvertToTask = vi.fn();
    render(
      <AsideNote
        toolCall={btwToolCall({ note: "旧 util 可删", suggestion: "下个版本清理" })}
        layout="gutter-wide"
        converted={false}
        onConvertToTask={onConvertToTask}
      />
    );
    fireEvent.click(screen.getByText("转为任务"));
    expect(onConvertToTask).toHaveBeenCalledWith("接下来：旧 util 可删（建议：下个版本清理）");
  });

  it("builds the draft without the 建议 suffix when there is no suggestion", () => {
    expect(buildTaskDraft({ note: "旧 util 可删" })).toBe("接下来：旧 util 可删");
  });

  it("shows the 已转 stamp instead of the link once converted", () => {
    render(
      <AsideNote
        toolCall={btwToolCall({ note: "n" })}
        layout="inline"
        converted
        onConvertToTask={vi.fn()}
      />
    );
    expect(screen.getByText("已转")).toHaveAttribute("aria-label", "已转为任务");
    expect(screen.queryByText("转为任务")).not.toBeInTheDocument();
  });

  it("renders nothing and warns with the toolCallId on invalid args", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(
      <AsideNote
        toolCall={btwToolCall({ suggestion: "缺 note 字段" })}
        layout="inline"
        converted={false}
        onConvertToTask={vi.fn()}
      />
    );
    expect(container.querySelector("aside")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[AsideNote] btw 参数解析失败，跳过渲染",
      expect.objectContaining({ toolCallId: "tool_btw" })
    );
  });

  it("is visible immediately when animateIn is off (default)", () => {
    const { container } = render(
      <AsideNote
        toolCall={btwToolCall({ note: "n" })}
        layout="inline"
        converted={false}
        onConvertToTask={vi.fn()}
      />
    );
    expect(container.querySelector("aside")).toHaveClass("opacity-100");
  });
});
