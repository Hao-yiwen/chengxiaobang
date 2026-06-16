// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import { AskUserCard } from "../src/renderer/components/AskUserCard";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function askToolCall(args: Record<string, unknown>): ToolCall {
  return {
    id: "tool_ask",
    runId: "run_1",
    name: "AskUserQuestion",
    args,
    status: "pending_approval",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}

const QUESTION = "用哪种方式处理旧的 API 兼容层？";
const OPTIONS = ["保留并标记 deprecated", "直接移除，major 版本升级"];

function choiceArgs(): Record<string, unknown> {
  return { questions: [{ header: "处理方式", question: QUESTION, options: OPTIONS }] };
}

describe("AskUserCard", () => {
  it("一次只渲染当前选择题、题头、选项和操作按钮", () => {
    render(<AskUserCard toolCall={askToolCall(choiceArgs())} onDecide={vi.fn()} />);

    expect(screen.getByText("处理方式")).toBeInTheDocument();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("2.")).toBeInTheDocument();
    expect(screen.getByText(OPTIONS[0]!)).toBeInTheDocument();
    expect(screen.getByText(OPTIONS[1]!)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳过" })).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "继续" });
    expect(continueButton).toBeInTheDocument();
    expect(continueButton).toHaveClass(
      "inline-flex",
      "items-center",
      "justify-center",
      "text-primary-foreground"
    );
  });

  it("选项点击后不会立即提交，点继续才提交结构化 answers", () => {
    const onDecide = vi.fn();
    render(<AskUserCard toolCall={askToolCall(choiceArgs())} onDecide={onDecide} />);

    fireEvent.click(screen.getByText(OPTIONS[0]!));
    expect(onDecide).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { answers: [{ question: QUESTION, optionLabel: OPTIONS[0] }] }
    });
    expect(screen.getByText(new RegExp(`${QUESTION} → ${OPTIONS[0]}`))).toBeInTheDocument();
  });

  it("可用数字或字母键选择当前题选项，再点继续提交", () => {
    const onDecide = vi.fn();
    render(<AskUserCard toolCall={askToolCall(choiceArgs())} onDecide={onDecide} />);

    fireEvent.keyDown(window, { key: "2" });
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { answers: [{ question: QUESTION, optionLabel: OPTIONS[1] }] }
    });
  });

  it("可用上下键定位并回车选中当前高亮项", () => {
    const onDecide = vi.fn();
    render(<AskUserCard toolCall={askToolCall(choiceArgs())} onDecide={onDecide} />);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: { answers: [{ question: QUESTION, optionLabel: OPTIONS[1] }] }
    });
  });

  it("multiSelect 会提交多个选项", () => {
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({
          questions: [
            {
              id: "q1",
              question: "这次要改哪些范围？",
              options: ["shared 契约", "桌面弹窗", "发布脚本"],
              multiSelect: true
            }
          ]
        })}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByText("shared 契约"));
    fireEvent.click(screen.getByText("桌面弹窗"));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: {
        answers: [{ id: "q1", question: "这次要改哪些范围？", optionLabel: "shared 契约、桌面弹窗" }]
      }
    });
  });

  it("跳过提问时提交 { approved:false }", () => {
    const onDecide = vi.fn();
    render(<AskUserCard toolCall={askToolCall(choiceArgs())} onDecide={onDecide} />);

    fireEvent.click(screen.getByRole("button", { name: "跳过" }));

    expect(onDecide).toHaveBeenCalledWith({ approved: false });
    expect(screen.getByText(/用户跳过了该问题/)).toBeInTheDocument();
  });

  it("首次提交后锁定，避免重复决议", () => {
    const onDecide = vi.fn();
    render(<AskUserCard toolCall={askToolCall(choiceArgs())} onDecide={onDecide} />);
    const continueButton = screen.getByRole("button", { name: "继续" });

    fireEvent.click(screen.getByText(OPTIONS[0]!));
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);

    expect(onDecide).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByRole("button", { name: "继续" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "跳过" })).not.toBeInTheDocument();
  });

  it("参数非法时记录 toolCallId，仍允许跳过", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onDecide = vi.fn();
    render(<AskUserCard toolCall={askToolCall({ options: 42 })} onDecide={onDecide} />);

    expect(warn).toHaveBeenCalledWith(
      "[AskUserCard] AskUserQuestion 参数解析失败",
      expect.objectContaining({ toolCallId: "tool_ask" })
    );
    expect(screen.getByText("问题内容解析失败")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    expect(onDecide).toHaveBeenCalledWith({ approved: false });
  });

  it("多题模式只展示当前题，并通过右上角按钮切题后统一提交", () => {
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({
          questions: [
            { id: "q1", header: "行程天数", question: "计划玩几天？", options: ["5-7 天", "8-10 天"] },
            { id: "q2", header: "同行人", question: "和谁一起？", options: ["独自旅行", "朋友结伴"] },
            { id: "q3", header: "预算", question: "预算偏好？", options: ["经济实惠", "舒适优先"] }
          ]
        })}
        onDecide={onDecide}
      />
    );

    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByText("计划玩几天？")).toBeInTheDocument();
    expect(screen.queryByText("和谁一起？")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("5-7 天"));

    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByText("和谁一起？")).toBeInTheDocument();
    expect(screen.queryByText("计划玩几天？")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("独自旅行"));

    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByText("舒适优先"));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(onDecide).toHaveBeenCalledWith({
      approved: true,
      answer: {
        answers: [
          { id: "q1", question: "计划玩几天？", optionLabel: "5-7 天" },
          { id: "q2", question: "和谁一起？", optionLabel: "独自旅行" },
          { id: "q3", question: "预算偏好？", optionLabel: "舒适优先" }
        ]
      }
    });
  });

  it("多题模式从已回答当前题继续到下一题时不提前显示未答错误", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({
          questions: [
            { question: "第一个？", options: ["方案 A", "方案 B"] },
            { question: "第二个？", options: ["方案 C", "方案 D"] }
          ]
        })}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByText("方案 A"));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText("第二个？")).toBeInTheDocument();
    expect(screen.queryByText("这个问题还没有回答")).not.toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByText("这个问题还没有回答")).toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[AskUserCard] 当前题未回答，已阻止继续",
      expect.objectContaining({ questionIndex: 1, toolCallId: "tool_ask" })
    );
  });

  it("多题模式会阻止未答完的提交并跳回首个缺失题", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onDecide = vi.fn();
    render(
      <AskUserCard
        toolCall={askToolCall({
          questions: [
            { question: "第一个？", options: ["方案 A", "方案 B"] },
            { question: "第二个？", options: ["方案 C", "方案 D"] }
          ]
        })}
        onDecide={onDecide}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByText("方案 C"));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByText("第一个？")).toBeInTheDocument();
    expect(screen.getByText("这个问题还没有回答")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      "[AskUserCard] 结构化提问仍有未回答项，已阻止提交",
      expect.objectContaining({ toolCallId: "tool_ask" })
    );
  });
});
