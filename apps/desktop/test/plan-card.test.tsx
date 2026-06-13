// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PlanBookmark } from "../src/renderer/components/PlanBookmark";
import { PlanCard } from "../src/renderer/components/PlanCard";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

const markdown = `# 示例计划：登录页错误提示优化

## Summary
优化登录页在账号、密码或网络异常时的提示方式。

## Key Changes
- 在登录提交入口增加参数校验。
- 统一处理接口返回的登录失败、网络超时和未知异常。

## Test Plan
- 空账号时展示中文提示。
- 网络异常时展示可理解的错误文案。

## Assumptions
- 不修改后端接口。`;

describe("PlanCard", () => {
  it("渲染计划 Markdown 的标题和核心分节", () => {
    render(<PlanCard markdown={markdown} status="draft" />);

    expect(screen.getByTestId("plan-card")).toHaveAttribute("data-status", "draft");
    expect(screen.getByText("计划")).toBeInTheDocument();
    expect(screen.getByText("待确认")).toBeInTheDocument();
    expect(screen.getByText("示例计划：登录页错误提示优化")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Key Changes")).toBeInTheDocument();
    expect(screen.getByText("Test Plan")).toBeInTheDocument();
    expect(screen.getByText("Assumptions")).toBeInTheDocument();
  });

  it("长计划默认折叠并可展开/收起", () => {
    const longMarkdown = `${markdown}\n\n${Array.from(
      { length: 20 },
      (_, index) => `- 额外检查项 ${index + 1}`
    ).join("\n")}`;

    render(<PlanCard markdown={longMarkdown} status="approved" />);

    const button = screen.getByRole("button", { name: "展开计划" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "收起计划" })).toBeInTheDocument();
  });

  it("状态文案映射到待确认、已确认和已拒绝", () => {
    const { rerender } = render(<PlanCard markdown={markdown} status="awaiting" />);
    expect(screen.getByText("待确认")).toBeInTheDocument();
    rerender(<PlanCard markdown={markdown} status="approved" />);
    expect(screen.getByText("已确认")).toBeInTheDocument();
    rerender(<PlanCard markdown={markdown} status="rejected" />);
    expect(screen.getByText("已拒绝")).toBeInTheDocument();
  });
});

describe("PlanBookmark（历史组件）", () => {
  it("渲染补零进度与当前步标题，点击触发 onJump", () => {
    const onJump = vi.fn();
    render(
      <PlanBookmark current={{ index: 2, total: 4, title: "拆分 store 切片" }} onJump={onJump} />
    );
    const button = screen.getByRole("button", {
      name: "计划进度 02 / 04，点击回到计划卡"
    });
    expect(button).toHaveTextContent("02 / 04 · 拆分 store 切片");
    expect(button).toHaveAttribute("title", "拆分 store 切片");
    fireEvent.click(button);
    expect(onJump).toHaveBeenCalledTimes(1);
  });
});
