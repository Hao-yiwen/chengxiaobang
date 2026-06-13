import { describe, expect, it } from "vitest";
import {
  derivePlanState,
  normalizeProposedPlanMarkdown,
  proposedPlanTitle,
  type ToolCall,
  type ToolName
} from "../src/index";

let counter = 0;

function makeToolCall(input: {
  name: ToolName;
  status: ToolCall["status"];
  args: Record<string, unknown>;
  createdAt: string;
  id?: string;
}): ToolCall {
  counter += 1;
  return {
    id: input.id ?? `tc_${counter}`,
    runId: "run_1",
    name: input.name,
    args: input.args,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

const markdownPlan = `# 示例计划：登录页错误提示优化

## Summary
优化登录失败提示。

## Key Changes
- 增加空账号校验。
- 统一异常提示。

## Test Plan
- 空账号时展示中文提示。

## Assumptions
- 不改后端接口。`;

const legacyPlanArgs = {
  title: "旧计划",
  steps: [
    { id: "s1", title: "梳理现状" },
    { id: "s2", title: "修改前端提示" }
  ]
};

describe("derivePlanState", () => {
  it("无 propose_plan → undefined，update_plan 不再单独产生计划状态", () => {
    expect(derivePlanState([])).toBeUndefined();
    expect(
      derivePlanState([
        makeToolCall({
          name: "update_plan",
          status: "completed",
          args: { stepId: "s1", status: "completed" },
          createdAt: "2026-06-11T00:00:00.000Z"
        })
      ])
    ).toBeUndefined();
  });

  it("pending 锚点解析 Markdown 计划，confirmed=false", () => {
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "pending_approval",
      args: { markdown: markdownPlan },
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const state = derivePlanState([anchor]);
    expect(state).toBeDefined();
    expect(state!.toolCallId).toBe(anchor.id);
    expect(state!.title).toBe("示例计划：登录页错误提示优化");
    expect(state!.markdown).toContain("## Key Changes");
    expect(state!.confirmed).toBe(false);
    expect(state!.finished).toBe(false);
  });

  it("completed 锚点确认后即结束计划阶段，update_plan 不再叠加状态", () => {
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: { markdown: markdownPlan },
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const update = makeToolCall({
      name: "update_plan",
      status: "completed",
      args: { stepId: "s1", status: "completed" },
      createdAt: "2026-06-11T00:01:00.000Z"
    });

    const state = derivePlanState([anchor, update]);

    expect(state).toMatchObject({
      confirmed: true,
      finished: true,
      markdown: markdownPlan
    });
  });

  it("旧版 {title, steps} 自动转换成 Markdown 展示", () => {
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: legacyPlanArgs,
      createdAt: "2026-06-11T00:00:00.000Z"
    });

    const state = derivePlanState([anchor]);

    expect(state!.title).toBe("旧计划");
    expect(state!.markdown).toContain("# 旧计划");
    expect(state!.markdown).toContain("- 梳理现状");
    expect(state!.markdown).toContain("## Assumptions");
  });

  it("最新 propose_plan 是当前计划锚点，即使上一版已确认", () => {
    const approved = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: { markdown: "# 旧计划\n\n## Summary\n旧内容" },
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const rejected = makeToolCall({
      name: "propose_plan",
      status: "rejected",
      args: { markdown: "# 新计划\n\n## Summary\n用户要求继续调整" },
      createdAt: "2026-06-11T00:05:00.000Z"
    });

    const state = derivePlanState([approved, rejected]);

    expect(state!.toolCallId).toBe(rejected.id);
    expect(state!.title).toBe("新计划");
    expect(state!.confirmed).toBe(false);
  });

  it("锚点 args 非法时返回 undefined（不抛错）", () => {
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: { markdown: "   " },
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    expect(derivePlanState([anchor])).toBeUndefined();
  });
});

describe("计划 Markdown helpers", () => {
  it("清理 proposed_plan 包裹标签", () => {
    expect(
      normalizeProposedPlanMarkdown(`<proposed_plan>
# 计划
</proposed_plan>`)
    ).toBe("# 计划");
  });

  it("优先用一级标题作为计划标题，没有标题时回退到首行", () => {
    expect(proposedPlanTitle(markdownPlan)).toBe("示例计划：登录页错误提示优化");
    expect(proposedPlanTitle("先做 A，再做 B")).toBe("先做 A，再做 B");
  });
});
