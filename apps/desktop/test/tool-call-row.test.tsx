// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("renders a human-readable description instead of the raw tool name", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({ name: "read_file", args: { path: "apps/desktop/src/index.ts" } })}
      />
    );
    expect(screen.getByText("读取 …/src/index.ts")).toBeInTheDocument();
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("shows localized status only for pending and error states", () => {
    const { rerender } = render(<ToolCallRow toolCall={toolCall({ result: "ok" })} />);
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();

    rerender(<ToolCallRow toolCall={toolCall({ status: "failed", result: "boom" })} />);
    expect(screen.getByText("失败")).toBeInTheDocument();

    rerender(<ToolCallRow toolCall={toolCall({ status: "rejected" })} />);
    expect(screen.getByText("已拒绝")).toBeInTheDocument();

    rerender(<ToolCallRow toolCall={toolCall({ status: "pending_approval" })} />);
    expect(screen.getByText("待批准")).toBeInTheDocument();

    rerender(<ToolCallRow toolCall={toolCall({ status: "pending_smart_approval" })} />);
    expect(screen.getByText("智能审批中")).toBeInTheDocument();
  });

  it("does not show smart approval internals on the tool line", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          status: "rejected",
          approval: {
            kind: "smart",
            source: "model",
            verdict: "deny",
            risk: "high",
            score: 0.9,
            reason: "命令会删除文件",
            decidedAt: "2026-06-13T00:00:00.000Z"
          }
        })}
      />
    );

    expect(screen.queryByText("智能审批：命令会删除文件")).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByText("编辑 a.ts"));

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

    fireEvent.click(screen.getByText("写入 a.txt"));

    const diff = screen.getByLabelText("变更对比");
    expect(diff).toHaveTextContent("hello");
    expect(diff).toHaveTextContent("world");
  });

  it("renders HTML writes as normal tool rows instead of artifact cards", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "write_file",
          args: { path: "page.html", content: "<!doctype html>" },
          result: "已写入 page.html"
        })}
      />
    );

    expect(screen.getByText("写入 page.html")).toBeInTheDocument();
    expect(screen.queryByText("点击在右侧预览")).not.toBeInTheDocument();
  });

  it("keeps the raw result for non-file tools", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({ name: "shell", args: { command: "ls -la" }, result: "total 0" })}
      />
    );

    fireEvent.click(screen.getByText("运行 ls -la"));

    expect(screen.queryByLabelText("变更对比")).not.toBeInTheDocument();
    expect(screen.getByText("total 0")).toBeInTheDocument();
  });

  it("shows the full shell command before the command artifact when expanded", () => {
    const command =
      "lsof -ti:3000 | xargs kill -9 2>/dev/null; lsof -ti:4000 | xargs kill -9 2>/dev/null";

    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "shell",
          args: { command },
          result: "已生成 /tmp/report.xlsx"
        })}
      />
    );

    fireEvent.click(screen.getByText(/^运行 lsof/));

    expect(screen.getByText("执行命令")).toBeInTheDocument();
    expect(screen.getByText(command)).toBeInTheDocument();
    expect(screen.getByText("执行产物")).toBeInTheDocument();
    expect(screen.getByText("已生成 /tmp/report.xlsx")).toBeInTheDocument();
  });

  it("renders a completed ask_user as an expandable question and answer receipt", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "ask_user",
          args: {
            questions: [{ question: "用哪种方式处理旧的 API 兼容层？" }],
            answer: {
              answers: [
                {
                  question: "用哪种方式处理旧的 API 兼容层？",
                  text: "保留并标记 deprecated"
                }
              ]
            }
          }
        })}
      />
    );

    expect(screen.getByText(/用哪种方式处理旧的 API 兼容层？：保留并标记 deprecated/)).toBeInTheDocument();
    expect(screen.queryByText(/问：用哪种方式处理旧的 API 兼容层？/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText(/问：用哪种方式处理旧的 API 兼容层？/)).toBeInTheDocument();
    expect(screen.getByText(/答：保留并标记 deprecated/)).toBeInTheDocument();
  });

  it("renders rejected and residual ask_user rows as historical receipts", () => {
    const { rerender } = render(
      <ToolCallRow
        toolCall={toolCall({
          name: "ask_user",
          status: "rejected",
          args: { questions: [{ question: "继续吗？" }] }
        })}
      />
    );

    expect(screen.getByText("已跳过：继续吗？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("答：用户跳过了该问题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: true }));

    rerender(
      <ToolCallRow
        toolCall={toolCall({
          name: "ask_user",
          status: "pending_approval",
          args: { questions: [{ question: "继续吗？" }] }
        })}
      />
    );

    expect(screen.getByText("继续吗？：问题未回答（运行已结束）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("答：问题未回答（运行已结束）")).toBeInTheDocument();
  });

  it("renders structured ask_user answers after expanding", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "ask_user",
          args: {
            questions: [
              { id: "q1", question: "脚本类型？", options: ["GPT", "BERT"], allowFreeText: false },
              { id: "q2", question: "补充说明？" }
            ],
            answer: {
              answers: [
                { id: "q1", question: "脚本类型？", optionLabel: "GPT" },
                { id: "q2", question: "补充说明？", text: "保持 demo" }
              ]
            }
          }
        })}
      />
    );

    expect(screen.getByText("已回答 2/2 个问题")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("问：脚本类型？")).toBeInTheDocument();
    expect(screen.getByText("答：GPT")).toBeInTheDocument();
    expect(screen.getByText("问：补充说明？")).toBeInTheDocument();
    expect(screen.getByText("答：保持 demo")).toBeInTheDocument();
  });

  it("renders use_skill as a compact chip without exposing the loaded skill body", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "use_skill",
          args: { name: "excel" },
          result: "# excel 技能\n这里是最长 32KB 的技能正文"
        })}
      />
    );

    expect(screen.getByText("已加载技能 excel")).toBeInTheDocument();
    expect(screen.queryByText(/技能正文/)).not.toBeInTheDocument();
  });

  it("shows use_skill loading and failure details without expanding the skill body", () => {
    const { rerender } = render(
      <ToolCallRow toolCall={toolCall({ name: "use_skill", args: { name: "ppt" }, status: "running" })} />
    );

    expect(screen.getByText("正在加载技能 ppt")).toBeInTheDocument();

    rerender(
      <ToolCallRow
        toolCall={toolCall({
          name: "use_skill",
          args: { name: "excel" },
          status: "failed",
          result: "读取技能文件失败"
        })}
      />
    );

    expect(screen.getByText("加载技能失败 excel")).toBeInTheDocument();
    expect(screen.getByText("读取技能文件失败")).toBeInTheDocument();
  });

  it("opens file rows through the injected preview callback", () => {
    const onOpenFile = vi.fn();
    render(
      <ToolCallRow
        toolCall={toolCall({ name: "read_file", args: { path: "src/index.ts" }, result: "x" })}
        onOpenFile={onOpenFile}
      />
    );

    fireEvent.click(screen.getByTitle("预览文件"));
    expect(onOpenFile).toHaveBeenCalledWith("src/index.ts", "code");
  });

  it("hides the file preview button when no callback is wired", () => {
    render(
      <ToolCallRow toolCall={toolCall({ name: "read_file", args: { path: "src/index.ts" }, result: "x" })} />
    );

    expect(screen.queryByTitle("预览文件")).not.toBeInTheDocument();
  });
});
