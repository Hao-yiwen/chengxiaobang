// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ToolCall } from "@chengxiaobang/shared";
import { ApprovalDock } from "../src/renderer/components/ApprovalDock";
import { setupI18n } from "../src/renderer/i18n";
import { resetAppStore, useAppStore } from "../src/renderer/store";

beforeAll(() => {
  setupI18n("zh");
});

beforeEach(() => {
  resetAppStore();
});

function pendingTool(partial: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "tool_1",
    runId: "run_1",
    name: "Bash",
    args: { command: "rm -rf dist" },
    status: "pending_approval",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
    ...partial
  };
}

function project(): Project {
  return {
    id: "project_1",
    name: "demo",
    path: "/tmp/demo",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z"
  };
}

describe("ApprovalDock", () => {
  it("renders nothing without a pending tool", () => {
    const { container } = render(<ApprovalDock />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render while a tool is pending smart approval", () => {
    useAppStore.setState({
      pendingTool: pendingTool({ status: "pending_smart_approval" }),
      approve: vi.fn()
    });
    const { container } = render(<ApprovalDock />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the shell command preview and submits an approval", () => {
    const approve = vi.fn();
    useAppStore.setState({ pendingTool: pendingTool(), approve });
    render(<ApprovalDock />);

    expect(screen.getByText("需要权限")).toBeInTheDocument();
    expect(screen.getByText("运行 rm -rf dist")).toBeInTheDocument();
    expect(screen.getByText("等待确认")).toBeInTheDocument();
    expect(screen.getAllByText(/rm -rf dist/).length).toBeGreaterThan(0);
    expect(screen.queryByText("始终允许本项目")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(approve).toHaveBeenCalledWith("tool_1", { approved: true });
  });

  it("submits a rejection and hides immediately after deciding", () => {
    const approve = vi.fn();
    useAppStore.setState({ pendingTool: pendingTool(), approve });
    render(<ApprovalDock />);

    fireEvent.click(screen.getByText("拒绝"));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(approve).toHaveBeenCalledWith("tool_1", { approved: false });
    expect(screen.queryByTestId("approval-dock")).not.toBeInTheDocument();
  });

  it("submits a project-scoped approval when a project is active", () => {
    const approve = vi.fn();
    const activeProject = project();
    useAppStore.setState({
      projects: [activeProject],
      activeProjectId: activeProject.id,
      pendingTool: pendingTool(),
      approve
    });
    render(<ApprovalDock />);

    fireEvent.click(screen.getByText("始终允许本项目"));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(approve).toHaveBeenCalledWith("tool_1", {
      approved: true,
      approvalScope: "project"
    });
  });

  it("supports arrow key selection and Enter confirmation", () => {
    const approve = vi.fn();
    const activeProject = project();
    useAppStore.setState({
      projects: [activeProject],
      activeProjectId: activeProject.id,
      pendingTool: pendingTool(),
      approve
    });
    render(<ApprovalDock />);

    fireEvent.keyDown(screen.getByTestId("approval-dock"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByTestId("approval-dock"), { key: "Enter" });

    expect(approve).toHaveBeenCalledWith("tool_1", {
      approved: true,
      approvalScope: "project"
    });
  });

  it("previews Edit approvals as a path plus diff", () => {
    useAppStore.setState({
      pendingTool: pendingTool({
        name: "Edit",
        args: { file_path: "src/a.ts", old_string: "x = 1", new_string: "x = 2" }
      }),
      approve: vi.fn()
    });
    render(<ApprovalDock />);

    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    const diff = screen.getByLabelText("变更对比");
    expect(diff).toHaveTextContent("x = 1");
    expect(diff).toHaveTextContent("x = 2");
  });

  it("renders AskUserQuestion as the option card and forwards the picked answer", async () => {
    const approve = vi.fn();
    useAppStore.setState({
      pendingTool: pendingTool({
        name: "AskUserQuestion",
        args: { questions: [{ question: "继续吗？", options: ["同意", "停止"] }] }
      }),
      approve
    });
    render(<ApprovalDock />);

    expect(screen.getByText("继续吗？")).toBeInTheDocument();
    fireEvent.click(screen.getByText("同意"));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith("tool_1", {
        approved: true,
        answer: { answers: [{ question: "继续吗？", optionLabel: "同意" }] }
      })
    );
    expect(screen.queryByTestId("approval-dock")).not.toBeInTheDocument();
  });

  it("renders ExitPlanMode as an implementation choice and turns off plan mode when approved", () => {
    const approve = vi.fn();
    useAppStore.setState({
      planMode: true,
      pendingTool: pendingTool({
        name: "ExitPlanMode",
        args: { plan: "# 示例计划\n\n## Summary\n先确认。" }
      }),
      approve
    });
    render(<ApprovalDock />);

    expect(screen.getByTestId("plan-approval-dock")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /是，实施此计划/ }));

    expect(approve).toHaveBeenCalledWith("tool_1", { approved: true });
    expect(useAppStore.getState().planMode).toBe(false);
    expect(screen.queryByTestId("plan-approval-dock")).not.toBeInTheDocument();
  });

  it("forwards ExitPlanMode adjustment text without turning off plan mode", () => {
    const approve = vi.fn();
    useAppStore.setState({
      planMode: true,
      pendingTool: pendingTool({
        name: "ExitPlanMode",
        args: { plan: "# 示例计划\n\n## Summary\n先确认。" }
      }),
      approve
    });
    render(<ApprovalDock />);

    fireEvent.change(screen.getByLabelText("否，请告知程小帮如何调整"), {
      target: { value: "请补充测试计划" }
    });
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    expect(approve).toHaveBeenCalledWith("tool_1", {
      approved: false,
      answer: {
        answers: [
          {
            id: "plan_adjustment",
            question: "否，请告知程小帮如何调整",
            text: "请补充测试计划"
          }
        ]
      }
    });
    expect(useAppStore.getState().planMode).toBe(true);
  });
});
