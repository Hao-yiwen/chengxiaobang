import { describe, expect, it } from "vitest";
import { derivePlanState, type ToolCall, type ToolName } from "../src/index";

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

const planArgs = (title: string, stepIds: string[]): Record<string, unknown> => ({
  title,
  steps: stepIds.map((id) => ({ id, title: `步骤 ${id}` }))
});

describe("derivePlanState", () => {
  it("无 propose_plan → undefined", () => {
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

  it("pending 锚点 → confirmed=false", () => {
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "pending_approval",
      args: planArgs("草案", ["s1", "s2"]),
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const state = derivePlanState([anchor]);
    expect(state).toBeDefined();
    expect(state!.toolCallId).toBe(anchor.id);
    expect(state!.confirmed).toBe(false);
    expect(state!.finished).toBe(false);
    expect(state!.steps.map((s) => s.status)).toEqual(["pending", "pending"]);
  });

  it("completed 锚点 + update_plan 叠放出正确步骤状态", () => {
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: planArgs("计划", ["s1", "s2", "s3"]),
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const updates = [
      makeToolCall({
        name: "update_plan",
        status: "completed",
        args: { stepId: "s1", status: "completed" },
        createdAt: "2026-06-11T00:01:00.000Z"
      }),
      makeToolCall({
        name: "update_plan",
        status: "completed",
        args: { stepId: "s2", status: "in_progress" },
        createdAt: "2026-06-11T00:02:00.000Z"
      }),
      // 工具调用本身未完成（failed），不叠放。
      makeToolCall({
        name: "update_plan",
        status: "failed",
        args: { stepId: "s3", status: "completed" },
        createdAt: "2026-06-11T00:03:00.000Z"
      }),
      // 未知 stepId 忽略。
      makeToolCall({
        name: "update_plan",
        status: "completed",
        args: { stepId: "s999", status: "completed" },
        createdAt: "2026-06-11T00:04:00.000Z"
      })
    ];
    const state = derivePlanState([anchor, ...updates]);
    expect(state!.confirmed).toBe(true);
    expect(state!.finished).toBe(false);
    expect(state!.steps.map((s) => s.status)).toEqual(["completed", "in_progress", "pending"]);
  });

  it("editedSteps 写回 args 后以 args 为准", () => {
    // 模拟 backend 在确认时把 editedSteps 写回锚点 args：派生结果即编辑后版本。
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: {
        title: "计划",
        steps: [
          { id: "s1", title: "用户改过的第一步", status: "pending" },
          { id: "s3", title: "用户新加的步骤", status: "pending" }
        ]
      },
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const state = derivePlanState([anchor]);
    expect(state!.steps.map((s) => ({ id: s.id, title: s.title }))).toEqual([
      { id: "s1", title: "用户改过的第一步" },
      { id: "s3", title: "用户新加的步骤" }
    ]);
  });

  it("驳回后重新 propose_plan 以新锚点为准（旧计划失效）", () => {
    const rejected = makeToolCall({
      name: "propose_plan",
      status: "rejected",
      args: planArgs("旧计划", ["a1"]),
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const newAnchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: planArgs("新计划", ["b1", "b2"]),
      createdAt: "2026-06-11T00:05:00.000Z"
    });
    const state = derivePlanState([rejected, newAnchor]);
    expect(state!.toolCallId).toBe(newAnchor.id);
    expect(state!.title).toBe("新计划");
    expect(state!.confirmed).toBe(true);
    expect(state!.steps.map((s) => s.id)).toEqual(["b1", "b2"]);
  });

  it("全部 completed/skipped → finished=true", () => {
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: planArgs("计划", ["s1", "s2"]),
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const state = derivePlanState([
      anchor,
      makeToolCall({
        name: "update_plan",
        status: "completed",
        args: { stepId: "s1", status: "completed" },
        createdAt: "2026-06-11T00:01:00.000Z"
      }),
      makeToolCall({
        name: "update_plan",
        status: "completed",
        args: { stepId: "s2", status: "skipped" },
        createdAt: "2026-06-11T00:02:00.000Z"
      })
    ]);
    expect(state!.finished).toBe(true);
  });

  it("锚点之前的 update_plan 不叠放", () => {
    // 旧计划的进度更新发生在新锚点确认之前，不得污染新计划。
    const staleUpdate = makeToolCall({
      name: "update_plan",
      status: "completed",
      args: { stepId: "s1", status: "completed" },
      createdAt: "2026-06-11T00:00:30.000Z"
    });
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: planArgs("计划", ["s1"]),
      createdAt: "2026-06-11T00:01:00.000Z"
    });
    const state = derivePlanState([staleUpdate, anchor]);
    expect(state!.steps[0].status).toBe("pending");
    expect(state!.finished).toBe(false);
  });

  it("锚点 args 非法时返回 undefined（不抛错）", () => {
    const anchor = makeToolCall({
      name: "propose_plan",
      status: "completed",
      args: { title: "", steps: [] },
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    expect(derivePlanState([anchor])).toBeUndefined();
  });
});
