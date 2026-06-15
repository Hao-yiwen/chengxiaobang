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

describe("derivePlanState", () => {
  it("无 ExitPlanMode → undefined", () => {
    expect(derivePlanState([])).toBeUndefined();
    expect(
      derivePlanState([
        makeToolCall({
          name: "Read",
          status: "completed",
          args: { file_path: "README.md" },
          createdAt: "2026-06-11T00:00:00.000Z"
        })
      ])
    ).toBeUndefined();
  });

  it("pending 锚点解析 Markdown 计划，confirmed=false", () => {
    const anchor = makeToolCall({
      name: "ExitPlanMode",
      status: "pending_approval",
      args: { plan: markdownPlan },
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

  it("completed 锚点确认后即结束计划阶段", () => {
    const anchor = makeToolCall({
      name: "ExitPlanMode",
      status: "completed",
      args: { plan: markdownPlan },
      createdAt: "2026-06-11T00:01:00.000Z"
    });

    const state = derivePlanState([anchor]);

    expect(state).toMatchObject({
      confirmed: true,
      finished: true,
      markdown: markdownPlan
    });
  });

  it("最新 ExitPlanMode 是当前计划锚点，即使上一版已确认", () => {
    const approved = makeToolCall({
      name: "ExitPlanMode",
      status: "completed",
      args: { plan: "# 旧计划\n\n## Summary\n旧内容" },
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const rejected = makeToolCall({
      name: "ExitPlanMode",
      status: "rejected",
      args: { plan: "# 新计划\n\n## Summary\n用户要求继续调整" },
      createdAt: "2026-06-11T00:05:00.000Z"
    });

    const state = derivePlanState([approved, rejected]);

    expect(state!.toolCallId).toBe(rejected.id);
    expect(state!.title).toBe("新计划");
    expect(state!.confirmed).toBe(false);
  });

  it("锚点 args 非法时返回 undefined（不抛错）", () => {
    const anchor = makeToolCall({
      name: "ExitPlanMode",
      status: "completed",
      args: { plan: "   " },
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
