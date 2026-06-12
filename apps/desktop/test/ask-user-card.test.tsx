// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import { AskUserCard, OPTION_FLASH_MS } from "../src/renderer/components/AskUserCard";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function askToolCall(args: Record<string, unknown>): ToolCall {
  return {
    id: "tool_ask",
    runId: "run_1",
    name: "ask_user",
    args,
    status: "pending_approval",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}

const QUESTION = "用哪种方式处理旧的 API 兼容层？";
const OPTIONS = ["保留并标记 deprecated", "直接移除，major 版本升级"];

describe("AskUserCard（UI-SPEC §8 / ARCH-SPEC §3.5）", () => {
  it("renders the question, lettered options, free-text row and a skip button", () => {
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={vi.fn()}
      />
    );
    expect(screen.getByText("程小帮想确认一件事")).toBeInTheDocument();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText(OPTIONS[0]!)).toBeInTheDocument();
    expect(screen.getByLabelText("其他：")).toBeInTheDocument();
    expect(screen.getByText("答复")).toBeInTheDocument();
    expect(screen.getByText("跳过")).toBeInTheDocument();
  });

  it("submits an option after the 240ms cinnabar flash and collapses to a receipt", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByText(OPTIONS[0]!));
    expect(onDecide).not.toHaveBeenCalled(); // 闪现期内不提交

    act(() => {
      vi.advanceTimersByTime(OPTION_FLASH_MS);
    });
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { optionLabel: OPTIONS[0] }
    });
    // 塌缩为回执：¿ 问题 → A 答案
    expect(screen.queryByText("答复")).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`A ${OPTIONS[0]}`))).toBeInTheDocument();
  });

  it("hits an option directly with its letter key", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={onDecide}
      />
    );

    fireEvent.keyDown(window, { key: "b" });
    act(() => {
      vi.advanceTimersByTime(OPTION_FLASH_MS);
    });
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { optionLabel: OPTIONS[1] }
    });
  });

  it("navigates with arrow keys and submits the highlighted option on Enter", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={onDecide}
      />
    );

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    act(() => {
      vi.advanceTimersByTime(OPTION_FLASH_MS);
    });
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { optionLabel: OPTIONS[1] }
    });
  });

  it("does not hijack letter keys while the free-text input is focused", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={onDecide}
      />
    );

    fireEvent.keyDown(screen.getByLabelText("其他："), { key: "a" });
    act(() => {
      vi.advanceTimersByTime(OPTION_FLASH_MS);
    });
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("submits a custom answer via the 答复 button", () => {
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={onDecide}
      />
    );

    fireEvent.change(screen.getByLabelText("其他："), { target: { value: " 用我自己的话 " } });
    fireEvent.click(screen.getByText("答复"));
    expect(onDecide).toHaveBeenCalledWith({ approved: true, answer: { text: "用我自己的话" } });
  });

  it("submits a custom answer with Enter and ignores empty input", () => {
    const onDecide = vi.fn();
    render(
      <AskUserCard toolCall={askToolCall({ question: QUESTION })} onDecide={onDecide} />
    );
    const input = screen.getByLabelText("其他：");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDecide).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "继续" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDecide).toHaveBeenCalledWith({ approved: true, answer: { text: "继续" } });
  });

  it("skips the question via 跳过 → {approved:false}", () => {
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={onDecide}
      />
    );
    fireEvent.click(screen.getByText("跳过"));
    expect(onDecide).toHaveBeenCalledWith({ approved: false });
    expect(screen.getByText(/用户跳过了该问题/)).toBeInTheDocument();
  });

  it("locks after the first submission — no double decide", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByText(OPTIONS[0]!));
    fireEvent.click(screen.getByText(OPTIONS[1]!));
    act(() => {
      vi.advanceTimersByTime(OPTION_FLASH_MS * 2);
    });
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { optionLabel: OPTIONS[0] }
    });
  });

  it("hides the free-text row when allowFreeText is false", () => {
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS, allowFreeText: false })}
        onDecide={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("其他：")).not.toBeInTheDocument();
  });

  it("renders the resolved receipt without any interactive controls", () => {
    render(
      <AskUserCard
        toolCall={askToolCall({ question: QUESTION, options: OPTIONS })}
        onDecide={vi.fn()}
        resolved={{ optionLabel: OPTIONS[0] }}
      />
    );
    expect(screen.getByText(new RegExp(QUESTION))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`A ${OPTIONS[0]}`))).toBeInTheDocument();
    expect(screen.queryByText("答复")).not.toBeInTheDocument();
    expect(screen.queryByText("跳过")).not.toBeInTheDocument();
  });

  it("warns with the toolCallId on invalid args and still allows skipping", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onDecide = vi.fn();
    render(<AskUserCard toolCall={askToolCall({ options: 42 })} onDecide={onDecide} />);

    expect(warn).toHaveBeenCalledWith(
      "[AskUserCard] ask_user 参数解析失败",
      expect.objectContaining({ toolCallId: "tool_ask" })
    );
    expect(screen.getByText("问题内容解析失败")).toBeInTheDocument();

    fireEvent.click(screen.getByText("跳过"));
    expect(onDecide).toHaveBeenCalledWith({ approved: false });
  });
});
