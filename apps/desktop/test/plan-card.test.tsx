// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PlanStep } from "@chengxiaobang/shared";
import { PlanCard, type PlanCardStatus } from "../src/renderer/components/PlanCard";
import { PlanBookmark } from "../src/renderer/components/PlanBookmark";
import { setupI18n } from "../src/renderer/i18n";

beforeAll(() => {
  setupI18n("zh");
});

const steps: PlanStep[] = [
  { id: "s1", title: "梳理现有 state 依赖", status: "completed" },
  { id: "s2", title: "拆分 store 为三个切片", status: "in_progress" },
  { id: "s3", title: "迁移组件订阅", status: "pending" }
];

function renderCard(
  overrides: Partial<React.ComponentProps<typeof PlanCard>> = {}
): ReturnType<typeof render> & {
  onConfirm: ReturnType<typeof vi.fn>;
  onReject: ReturnType<typeof vi.fn>;
  onUpdateSteps: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  const onReject = vi.fn();
  const onUpdateSteps = vi.fn();
  const utils = render(
    <PlanCard
      title="重构 store 模块"
      steps={steps}
      status="executing"
      onConfirm={onConfirm}
      onReject={onReject}
      onUpdateSteps={onUpdateSteps}
      {...overrides}
    />
  );
  return { ...utils, onConfirm, onReject, onUpdateSteps };
}

describe("PlanCard（UI-SPEC §7.1）", () => {
  it("渲染刊头、标题、补零序号与步骤标题", () => {
    renderCard();
    expect(screen.getByText("计划")).toBeInTheDocument();
    expect(screen.getByText("重构 store 模块")).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByText("拆分 store 为三个切片")).toBeInTheDocument();
  });

  it("五种状态映射到对应印章字与 tone", () => {
    const expected: Record<PlanCardStatus, { word: string; tone: string }> = {
      draft: { word: "草稿", tone: "ink" },
      awaiting: { word: "待确认", tone: "ochre" },
      executing: { word: "执行中", tone: "indigo" },
      completed: { word: "已完成", tone: "moss" },
      rejected: { word: "已拒绝", tone: "faint" }
    };
    for (const [status, { word, tone }] of Object.entries(expected) as [
      PlanCardStatus,
      { word: string; tone: string }
    ][]) {
      const { unmount, container } = renderCard({ status });
      expect(container.querySelector("section")).toHaveAttribute("data-status", status);
      expect(screen.getByText(word)).toHaveAttribute("data-tone", tone);
      unmount();
    }
  });

  it("完成步显示苔绿 ✓ 且序号转朱砂；跳过步有「已跳过」标注", () => {
    const withSkipped: PlanStep[] = [
      ...steps.slice(0, 2),
      { id: "s3", title: "迁移组件订阅", status: "skipped" }
    ];
    const { container } = renderCard({ steps: withSkipped });
    expect(screen.getByRole("img", { name: "已完成" })).toBeInTheDocument();
    const doneRow = container.querySelector('[data-step-id="s1"]');
    expect(doneRow?.querySelector(".text-cinnabar")).toHaveTextContent("01");
    expect(screen.getByLabelText("已跳过")).toBeInTheDocument();
  });

  it("进行中步渲染墨点；非 owner 时为静态（ink-caret-static）", () => {
    const first = renderCard({ inkOwner: false });
    expect(first.container.querySelector(".ink-caret")).toHaveClass("ink-caret-static");
    first.unmount();
    const second = renderCard({ inkOwner: true });
    expect(second.container.querySelector(".ink-caret")).toBeInTheDocument();
    expect(second.container.querySelector(".ink-caret")).not.toHaveClass("ink-caret-static");
  });

  it("executing 态页脚显示进度与剩余步数（tnum）", () => {
    renderCard();
    expect(screen.getByText("1 / 3 · 预计还需 2 步")).toBeInTheDocument();
  });

  it("draft 态点击「确认执行」「否决」触发对应回调", () => {
    const { onConfirm, onReject } = renderCard({ status: "draft" });
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "否决" }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("draft 态点击步骤标题进入行内编辑，回车提交新标题", () => {
    const drafts: PlanStep[] = [
      { id: "s1", title: "第一步", status: "pending" },
      { id: "s2", title: "第二步", status: "pending" }
    ];
    const { onUpdateSteps } = renderCard({ status: "draft", steps: drafts });
    fireEvent.click(screen.getByRole("button", { name: "第二步" }));
    const input = screen.getByRole("textbox", { name: "编辑步骤" });
    expect(input).toHaveValue("第二步");
    fireEvent.change(input, { target: { value: "改写后的第二步" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUpdateSteps).toHaveBeenCalledWith([
      drafts[0],
      { id: "s2", title: "改写后的第二步", status: "pending" }
    ]);
  });

  it("draft 态「修改」按钮让第一步进入编辑；Escape 取消不触发回调", () => {
    const drafts: PlanStep[] = [{ id: "s1", title: "第一步", status: "pending" }];
    const { onUpdateSteps } = renderCard({ status: "draft", steps: drafts });
    fireEvent.click(screen.getByRole("button", { name: "修改" }));
    const input = screen.getByRole("textbox", { name: "编辑步骤" });
    expect(input).toHaveValue("第一步");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onUpdateSteps).not.toHaveBeenCalled();
  });

  it("draft 态可删除步骤", () => {
    const drafts: PlanStep[] = [
      { id: "s1", title: "第一步", status: "pending" },
      { id: "s2", title: "第二步", status: "pending" }
    ];
    const { onUpdateSteps } = renderCard({ status: "draft", steps: drafts });
    fireEvent.click(screen.getByRole("button", { name: "删除步骤：第一步" }));
    expect(onUpdateSteps).toHaveBeenCalledWith([drafts[1]]);
  });

  it("draft 态「＋ 添加步骤」追加 pending 新步，id 不与现有冲突", () => {
    const drafts: PlanStep[] = [
      { id: "s1", title: "第一步", status: "pending" },
      { id: "s2", title: "第二步", status: "pending" }
    ];
    const { onUpdateSteps } = renderCard({ status: "draft", steps: drafts });
    fireEvent.click(screen.getByRole("button", { name: "＋ 添加步骤" }));
    const input = screen.getByRole("textbox", { name: "添加步骤" });
    fireEvent.change(input, { target: { value: "收尾验证" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUpdateSteps).toHaveBeenCalledWith([
      ...drafts,
      { id: "s3", title: "收尾验证", status: "pending" }
    ]);
  });

  it("awaiting 残留态不可交互：无按钮、不可编辑，提示运行已结束（ARCH §2.5 评委修正 6）", () => {
    renderCard({ status: "awaiting" });
    expect(screen.getByText("计划未确认（运行已结束）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "否决" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "拆分 store 为三个切片" })
    ).not.toBeInTheDocument();
  });

  it("非 draft 态不暴露编辑入口", () => {
    renderCard({ status: "executing" });
    expect(screen.queryByRole("button", { name: "＋ 添加步骤" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除步骤/ })).not.toBeInTheDocument();
  });
});

describe("PlanBookmark（UI-SPEC §7.2）", () => {
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
