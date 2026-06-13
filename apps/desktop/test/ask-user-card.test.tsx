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

function choiceArgs(): Record<string, unknown> {
  return { questions: [{ question: QUESTION, options: OPTIONS }] };
}

function textArgs(): Record<string, unknown> {
  return { questions: [{ question: QUESTION }] };
}

describe("AskUserCard", () => {
  it("渲染旧版单题选择题参数、字母选项和跳过按钮", () => {
    render(
      <AskUserCard
        toolCall={askToolCall(choiceArgs())}
        onDecide={vi.fn()}
      />
    );

    expect(screen.getByText("程小帮想确认一件事")).toBeInTheDocument();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText(OPTIONS[0]!)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("输入你的回答")).not.toBeInTheDocument();
    expect(screen.queryByText("答复")).not.toBeInTheDocument();
    expect(screen.getByText("跳过")).toBeInTheDocument();
  });

  it("单题选项点击后提交结构化 answers，并折叠为回执", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall(choiceArgs())}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByText(OPTIONS[0]!));
    expect(onDecide).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(OPTION_FLASH_MS);
    });
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { answers: [{ question: QUESTION, optionLabel: OPTIONS[0] }] }
    });
    expect(screen.queryByText("答复")).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${QUESTION} → ${OPTIONS[0]}`))).toBeInTheDocument();
  });

  it("单题可用字母键直达选项", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall(choiceArgs())}
        onDecide={onDecide}
      />
    );

    fireEvent.keyDown(window, { key: "b" });
    act(() => {
      vi.advanceTimersByTime(OPTION_FLASH_MS);
    });
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { answers: [{ question: QUESTION, optionLabel: OPTIONS[1] }] }
    });
  });

  it("单题可用方向键选择并按回车提交", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall(choiceArgs())}
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
      answer: { answers: [{ question: QUESTION, optionLabel: OPTIONS[1] }] }
    });
  });

  it("自由输入聚焦时不会被字母快捷键劫持", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall(textArgs())}
        onDecide={onDecide}
      />
    );

    fireEvent.keyDown(screen.getByPlaceholderText("输入你的回答"), { key: "a" });
    act(() => {
      vi.advanceTimersByTime(OPTION_FLASH_MS);
    });
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("单题可通过答复按钮提交自由回答", () => {
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall(textArgs())}
        onDecide={onDecide}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("输入你的回答"), {
      target: { value: " 用我自己的话 " }
    });
    fireEvent.click(screen.getByText("答复"));
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { answers: [{ question: QUESTION, text: "用我自己的话" }] }
    });
  });

  it("单题自由回答可用回车提交，并忽略空输入", () => {
    const onDecide = vi.fn();
    render(<AskUserCard toolCall={askToolCall(textArgs())} onDecide={onDecide} />);
    const input = screen.getByPlaceholderText("输入你的回答");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDecide).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "继续" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { answers: [{ question: QUESTION, text: "继续" }] }
    });
  });

  it("跳过提问时提交 {approved:false}", () => {
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall(choiceArgs())}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByText("跳过"));
    expect(onDecide).toHaveBeenCalledWith({ approved: false });
    expect(screen.getByText(/用户跳过了该问题/)).toBeInTheDocument();
  });

  it("首次提交后锁定，避免重复决议", () => {
    vi.useFakeTimers();
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall(choiceArgs())}
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
      answer: { answers: [{ question: QUESTION, optionLabel: OPTIONS[0] }] }
    });
  });

  it("选择题不显示底部自由输入", () => {
    render(
      <AskUserCard
        toolCall={askToolCall(choiceArgs())}
        onDecide={vi.fn()}
      />
    );
    expect(screen.queryByPlaceholderText("输入你的回答")).not.toBeInTheDocument();
  });

  it("resolved 回执不显示交互控件", () => {
    render(
      <AskUserCard
        toolCall={askToolCall(choiceArgs())}
        onDecide={vi.fn()}
        resolved={{ answers: [{ question: QUESTION, optionLabel: OPTIONS[0] }] }}
      />
    );
    expect(screen.getByText(new RegExp(QUESTION))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(OPTIONS[0]!))).toBeInTheDocument();
    expect(screen.queryByText("答复")).not.toBeInTheDocument();
    expect(screen.queryByText("跳过")).not.toBeInTheDocument();
  });

  it("参数非法时记录 toolCallId，仍允许跳过", () => {
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

  it("多题模式一次性提交 1 到 4 个结构化回答", () => {
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({
          questions: [
            { id: "q1", question: "预训练脚本类型？", options: ["GPT 风格", "BERT 风格"], allowFreeText: false },
            { id: "q2", question: "数据来源？", options: ["demo/gpt2/input.txt", "自定义路径"], allowFreeText: false },
            { id: "q3", question: "还要补充什么？" }
          ]
        })}
        onDecide={onDecide}
      />
    );

    expect(screen.getByText("程小帮想确认 3 件事")).toBeInTheDocument();
    fireEvent.click(screen.getByText("GPT 风格"));
    fireEvent.click(screen.getByText("demo/gpt2/input.txt"));
    fireEvent.change(screen.getByLabelText(/还要补充什么？/), { target: { value: "保持最小 demo" } });
    fireEvent.click(screen.getByText("提交回答"));

    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: {
        answers: [
          { id: "q1", question: "预训练脚本类型？", optionLabel: "GPT 风格" },
          { id: "q2", question: "数据来源？", optionLabel: "demo/gpt2/input.txt" },
          { id: "q3", question: "还要补充什么？", text: "保持最小 demo" }
        ]
      }
    });
  });

  it("多题模式会阻止未答完的提交并提示缺失项", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({
          questions: [
            { question: "第一个？", options: ["方案 A"], allowFreeText: false },
            { question: "第二个？" }
          ]
        })}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByText("方案 A"));
    fireEvent.click(screen.getByText("提交回答"));

    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByText("这个问题还没有回答")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      "[AskUserCard] 结构化提问仍有未回答项，已阻止提交",
      expect.objectContaining({ toolCallId: "tool_ask" })
    );
  });
});
