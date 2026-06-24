// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@chengxiaobang/shared";
import { ToolCallRow } from "../src/renderer/components/ToolCallRow";
import { setupI18n } from "../src/renderer/i18n";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "../src/renderer/lib/code-preview-settings";
import { resetAppStore, useAppStore } from "../src/renderer/store";

const shikiMock = vi.hoisted(() => ({
  bundledLanguages: {
    bash: {},
    shell: {}
  },
  codeToTokensWithThemes: vi.fn(async (text: string) =>
    text.replace(/\r\n?/g, "\n").split("\n").map((line) =>
      line
        ? [
            {
              content: line,
              variants: {
                light: { color: "#0969da" },
                dark: { color: "#79c0ff" }
              }
            }
          ]
        : []
    )
  )
}));

vi.mock("shiki", () => shikiMock);
vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { additionLines: string[]; deletionLines: string[] } }) =>
    [...fileDiff.deletionLines, ...fileDiff.additionLines].join("\n"),
  MultiFileDiff: ({
    oldFile,
    newFile
  }: {
    oldFile: { contents: string };
    newFile: { contents: string };
  }) => `-${oldFile.contents}\n+${newFile.contents}`
}));

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  resetAppStore();
  shikiMock.codeToTokensWithThemes.mockClear();
});

function toolCall(partial: Partial<ToolCall>): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name: "Shell",
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
    const onOpenFile = vi.fn();
    render(
      <ToolCallRow
        toolCall={toolCall({ name: "Read", args: { file_path: "apps/desktop/src/index.ts" } })}
        onOpenFile={onOpenFile}
      />
    );
    expect(screen.getByText("读取")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览文件 index.ts" })).toHaveTextContent("index.ts");
    expect(screen.queryByText("读取 …/src/index.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
  });

  it("shows localized status only for pending and error states", () => {
    const { rerender } = render(<ToolCallRow toolCall={toolCall({ result: "ok" })} />);
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();

    rerender(<ToolCallRow toolCall={toolCall({ status: "failed", result: "boom" })} />);
    expect(screen.getByText("失败")).toHaveClass("text-muted-slate");
    expect(screen.getByText("失败")).not.toHaveClass("text-destructive");

    rerender(<ToolCallRow toolCall={toolCall({ status: "rejected" })} />);
    expect(screen.getByText("已拒绝")).toHaveClass("text-muted-slate");
    expect(screen.getByText("已拒绝")).not.toHaveClass("text-destructive");

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

  it("renders skill load failures with neutral text instead of red", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "Skill",
          args: { skill: "ppt" },
          status: "failed",
          result: "加载失败：缺少文件"
        })}
      />
    );

    expect(screen.getByText("加载技能失败 ppt")).toBeInTheDocument();
    expect(screen.getByText("加载失败：缺少文件")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("加载失败：缺少文件")).not.toHaveClass("text-destructive");
  });

  it("renders an Edit call as a +/- diff when expanded", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "Edit",
          args: { file_path: "a.ts", old_string: "x = 1", new_string: "x = 2" },
          result: "已替换 a.ts 中的文本"
        })}
      />
    );

    fireEvent.click(screen.getByText("编辑"));

    const diff = screen.getByLabelText("变更对比");
    expect(diff).toHaveTextContent("x = 1");
    expect(diff).toHaveTextContent("x = 2");
    expect(diff).toHaveTextContent("-");
    expect(diff).toHaveTextContent("+");
  });

  it("renders a Write call as all-added lines when expanded", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "Write",
          args: { file_path: "a.txt", content: "hello\nworld" },
          result: "已写入 a.txt"
        })}
      />
    );

    fireEvent.click(screen.getByText("写入"));

    const diff = screen.getByLabelText("变更对比");
    expect(diff).toHaveTextContent("hello");
    expect(diff).toHaveTextContent("world");
  });

  it("renders HTML writes as normal tool rows instead of artifact cards", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "Write",
          args: { file_path: "page.html", content: "<!doctype html>" },
          result: "已写入 page.html"
        })}
      />
    );

    expect(screen.getByText("写入")).toBeInTheDocument();
    expect(screen.queryByText("点击在右侧预览")).not.toBeInTheDocument();
  });

  it("renders Shell command and result with the rewritten code block chrome", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });

    const { container } = render(
      <ToolCallRow
        toolCall={toolCall({ name: "Shell", args: { command: "ls -la" }, result: "total 0" })}
      />
    );

    fireEvent.click(screen.getByText("运行 ls -la"));

    expect(screen.queryByLabelText("变更对比")).not.toBeInTheDocument();
    expect(screen.getByText("执行命令")).toBeInTheDocument();
    expect(screen.getByText("执行产物")).toBeInTheDocument();
    expect(container).toHaveTextContent("ls -la");
    expect(container).toHaveTextContent("total 0");

    const codeBlocks = container.querySelectorAll(".tool-call-code-block");
    expect(codeBlocks).toHaveLength(2);
    expect(container.querySelectorAll(".tool-call-code-block [data-streamdown='code-block']")).toHaveLength(2);
    expect(screen.getAllByText("bash")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "自动换行" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "复制代码" })).toHaveLength(2);

    expect(codeBlocks[0]).toHaveAttribute("data-code-wrap", "false");
    expect(codeBlocks[0]).toHaveAttribute("data-code-line-numbers", "false");
    expect(codeBlocks[0]).toHaveAttribute("data-code-font-size", "12");
    expect(codeBlocks[0].querySelector(".cxb-code-line-number")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "自动换行" })[0]);
    expect(codeBlocks[0]).toHaveAttribute("data-code-wrap", "true");

    expect(container.querySelector("pre.rounded-sm.bg-canvas-soft-2")).toBeNull();

    const copyButtons = screen.getAllByRole("button", { name: "复制代码" });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ls -la"));

    fireEvent.click(copyButtons[1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("total 0"));
  });

  it("hides running arguments for non Write/Edit tools", () => {
    const onOpenFile = vi.fn();
    const { rerender } = render(
      <ToolCallRow
        toolCall={toolCall({
          name: "Shell",
          status: "running",
          args: { command: "pnpm test -- --secret" }
        })}
      />
    );

    expect(screen.getByText("运行命令中")).toBeInTheDocument();
    expect(screen.queryByText(/pnpm test/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("运行命令中"));
    expect(screen.queryByText("执行命令")).not.toBeInTheDocument();

    rerender(
      <ToolCallRow
        toolCall={toolCall({
          name: "WebFetch",
          status: "running",
          args: { url: "https://example.com/secret" }
        })}
      />
    );
    expect(screen.getByText("抓取网页中")).toBeInTheDocument();
    expect(screen.queryByText(/example\.com/)).not.toBeInTheDocument();

    rerender(
      <ToolCallRow
        toolCall={toolCall({
          name: "Read",
          status: "running",
          args: { file_path: "src/secret.ts" }
        })}
        onOpenFile={onOpenFile}
      />
    );
    expect(screen.getByText("读取文件中")).toBeInTheDocument();
    expect(screen.queryByText(/secret\.ts/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /预览文件/ })).not.toBeInTheDocument();
  });

  it("applies global code preview settings to expanded Shell details", async () => {
    useAppStore.setState({
      codePreviewSettings: {
        ...DEFAULT_CODE_PREVIEW_SETTINGS,
        darkTheme: "catppuccin-mocha",
        fontSize: 15,
        lightTheme: "catppuccin-latte",
        wrapLongLines: true
      }
    });

    const { container } = render(
      <ToolCallRow
        toolCall={toolCall({ name: "Shell", args: { command: "pnpm test" }, result: "ok" })}
      />
    );

    fireEvent.click(screen.getByText("运行 pnpm test"));

    const codeBlocks = container.querySelectorAll(".tool-call-code-block");
    expect(codeBlocks[0]).toHaveAttribute("data-code-wrap", "true");
    expect(codeBlocks[0]).toHaveAttribute("data-code-line-numbers", "false");
    expect(codeBlocks[0]).toHaveAttribute("data-code-font-size", "15");
    expect(codeBlocks[0].getAttribute("style")).toContain("font-size: 15px");
    expect(codeBlocks[0].querySelector(".cxb-code-line-number")).toBeNull();
    await waitFor(() =>
      expect(shikiMock.codeToTokensWithThemes).toHaveBeenCalledWith("pnpm test", {
        lang: "bash",
        themes: { light: "catppuccin-latte", dark: "catppuccin-mocha" }
      })
    );
  });

  it("shows the full shell command before the command artifact when expanded", () => {
    const command =
      "lsof -ti:3000 | xargs kill -9 2>/dev/null; lsof -ti:4000 | xargs kill -9 2>/dev/null";

    const { container } = render(
      <ToolCallRow
        toolCall={toolCall({
          name: "Shell",
          args: { command },
          result: "已生成 /tmp/report.xlsx"
        })}
      />
    );

    fireEvent.click(screen.getByText(/^运行 lsof/));

    expect(screen.getByText("执行命令")).toBeInTheDocument();
    expect(screen.getByText("执行产物")).toBeInTheDocument();
    expect(container).toHaveTextContent(command);
    expect(container).toHaveTextContent("已生成 /tmp/report.xlsx");
  });

  it("renders a completed AskUserQuestion as an expandable question and answer receipt", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "AskUserQuestion",
          args: {
            questions: [
              {
                question: "用哪种方式处理旧的 API 兼容层？",
                options: ["保留并标记 deprecated", "直接移除，major 版本升级"]
              }
            ],
            answer: {
              answers: [
                {
                  question: "用哪种方式处理旧的 API 兼容层？",
                  optionLabel: "保留并标记 deprecated"
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

  it("renders rejected and residual AskUserQuestion rows as historical receipts", () => {
    const { rerender } = render(
      <ToolCallRow
        toolCall={toolCall({
          name: "AskUserQuestion",
          status: "rejected",
          args: { questions: [{ question: "继续吗？", options: ["继续", "停止"] }] }
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
          name: "AskUserQuestion",
          status: "pending_approval",
          args: { questions: [{ question: "继续吗？", options: ["继续", "停止"] }] }
        })}
      />
    );

    expect(screen.getByText("继续吗？：问题未回答（运行已结束）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("答：问题未回答（运行已结束）")).toBeInTheDocument();
  });

  it("renders structured AskUserQuestion answers after expanding", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "AskUserQuestion",
          args: {
            questions: [
              { id: "q1", question: "脚本类型？", options: ["GPT", "BERT"] },
              { id: "q2", question: "补充说明？", options: ["保持 demo", "补充完整"] }
            ],
            answer: {
              answers: [
                { id: "q1", question: "脚本类型？", optionLabel: "GPT" },
                { id: "q2", question: "补充说明？", optionLabel: "保持 demo" }
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

  it("renders Skill as a compact chip without exposing the loaded skill body", () => {
    render(
      <ToolCallRow
        toolCall={toolCall({
          name: "Skill",
          args: { skill: "excel" },
          result: "# excel 技能\n这里是最长 32KB 的技能正文"
        })}
      />
    );

    expect(screen.getByText("已加载技能 excel")).toBeInTheDocument();
    expect(screen.queryByText(/技能正文/)).not.toBeInTheDocument();
  });

  it("shows Skill loading and failure details without expanding the skill body", () => {
    const { rerender } = render(
      <ToolCallRow toolCall={toolCall({ name: "Skill", args: { skill: "ppt" }, status: "running" })} />
    );

    expect(screen.getByText("正在加载技能 ppt")).toBeInTheDocument();

    rerender(
      <ToolCallRow
        toolCall={toolCall({
          name: "Skill",
          args: { skill: "excel" },
          status: "failed",
          result: "读取技能文件失败"
        })}
      />
    );

    expect(screen.getByText("加载技能失败 excel")).toBeInTheDocument();
    expect(screen.getByText("读取技能文件失败")).toBeInTheDocument();
  });

  it("opens file rows through the injected preview callback", async () => {
    const onOpenFile = vi.fn();
    render(
      <ToolCallRow
        toolCall={toolCall({ name: "Read", args: { file_path: "src/index.ts" }, result: "x" })}
        onOpenFile={onOpenFile}
      />
    );

    const previewButton = screen.getByRole("button", { name: "预览文件 index.ts" });
    expect(previewButton).toHaveTextContent("index.ts");
    expect(screen.queryByText(/src\/index\.ts/)).not.toBeInTheDocument();
    fireEvent.pointerMove(previewButton, { pointerType: "mouse" });
    fireEvent.mouseEnter(previewButton);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(await screen.findByRole("tooltip", undefined, { timeout: 2000 })).toHaveTextContent("src/index.ts");
    fireEvent.click(previewButton);
    expect(onOpenFile).toHaveBeenCalledWith("src/index.ts", "code");
  });

  it("hides the file preview button when no callback is wired", () => {
    render(
      <ToolCallRow toolCall={toolCall({ name: "Read", args: { file_path: "src/index.ts" }, result: "x" })} />
    );

    expect(screen.queryByRole("button", { name: /预览文件/ })).not.toBeInTheDocument();
  });
});
