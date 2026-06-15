import { describe, expect, it } from "vitest";
import { deriveTodoState, todoCurrentItem, type ToolCall, type ToolName } from "../src/index";

let counter = 0;

function makeToolCall(input: {
  name: ToolName;
  status: ToolCall["status"];
  args: Record<string, unknown>;
  createdAt: string;
  runId?: string;
  id?: string;
}): ToolCall {
  counter += 1;
  return {
    id: input.id ?? `todo_tc_${counter}`,
    runId: input.runId ?? "run_1",
    name: input.name,
    args: input.args,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  };
}

const todos = (items: Array<{ content: string; status: "pending" | "in_progress" | "completed"; priority?: "high" | "medium" | "low" }>) => ({
  todos: items.map((item) => ({
    priority: item.priority ?? "medium",
    ...item
  }))
});

describe("deriveTodoState", () => {
  it("无 TodoWrite 时返回 undefined", () => {
    expect(deriveTodoState([])).toBeUndefined();
    expect(
      deriveTodoState([
        makeToolCall({
          name: "TodoRead",
          status: "completed",
          args: {},
          createdAt: "2026-06-13T00:00:00.000Z"
        })
      ])
    ).toBeUndefined();
  });

  it("从最新 TodoWrite 快照推导步骤状态", () => {
    const anchor = makeToolCall({
      name: "TodoWrite",
      status: "completed",
      args: todos([
        { content: "共享契约完成", status: "completed", priority: "high" },
        { content: "开始接 UI", status: "in_progress" },
        { content: "补测试", status: "pending", priority: "low" }
      ]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const state = deriveTodoState([anchor]);

    expect(state).toMatchObject({
      toolCallId: anchor.id,
      runId: "run_1",
      title: "执行清单",
      finished: false
    });
    expect(state!.items.map((item) => item.status)).toEqual([
      "completed",
      "in_progress",
      "pending"
    ]);
    expect(state!.items.map((item) => item.content)).toEqual([
      "共享契约完成",
      "开始接 UI",
      "补测试"
    ]);
  });

  it("重新 TodoWrite 后以最新有效快照为准", () => {
    const oldAnchor = makeToolCall({
      name: "TodoWrite",
      status: "completed",
      args: todos([{ content: "旧清单", status: "completed" }]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const newAnchor = makeToolCall({
      name: "TodoWrite",
      status: "completed",
      args: todos([
        { content: "新清单 1", status: "pending" },
        { content: "新清单 2", status: "pending" }
      ]),
      createdAt: "2026-06-13T00:02:00.000Z"
    });
    const state = deriveTodoState([oldAnchor, newAnchor]);
    expect(state!.toolCallId).toBe(newAnchor.id);
    expect(state!.items.map((item) => item.id)).toEqual(["todo_1", "todo_2"]);
    expect(state!.items.map((item) => item.status)).toEqual(["pending", "pending"]);
  });

  it("最新空 TodoWrite 快照会清空进度且不回退旧清单", () => {
    const oldAnchor = makeToolCall({
      name: "TodoWrite",
      status: "completed",
      args: todos([{ content: "旧清单", status: "in_progress" }]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const clearAnchor = makeToolCall({
      name: "TodoWrite",
      status: "completed",
      args: todos([]),
      createdAt: "2026-06-13T00:02:00.000Z"
    });

    expect(deriveTodoState([oldAnchor, clearAnchor])).toBeUndefined();
  });

  it("按 runId 只推导目标 run，未指定时回退最近一次 todo", () => {
    const first = makeToolCall({
      name: "TodoWrite",
      runId: "run_1",
      status: "completed",
      args: todos([{ content: "第一轮", status: "pending" }]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const second = makeToolCall({
      name: "TodoWrite",
      runId: "run_2",
      status: "completed",
      args: todos([{ content: "第二轮", status: "pending" }]),
      createdAt: "2026-06-13T00:01:00.000Z"
    });
    expect(deriveTodoState([first, second], { runId: "run_1" })!.items[0].content).toBe("第一轮");
    expect(deriveTodoState([first, second])!.items[0].content).toBe("第二轮");
  });

  it("非法快照会降级到更早的有效清单", () => {
    const valid = makeToolCall({
      name: "TodoWrite",
      status: "completed",
      args: todos([{ content: "有效清单", status: "pending" }]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const invalid = makeToolCall({
      name: "TodoWrite",
      status: "completed",
      args: todos([
        { content: "一", status: "in_progress" },
        { content: "二", status: "in_progress" }
      ]),
      createdAt: "2026-06-13T00:02:00.000Z"
    });
    const state = deriveTodoState([valid, invalid]);
    expect(state!.items[0].content).toBe("有效清单");
  });
});

describe("todoCurrentItem", () => {
  it("优先返回进行中步骤，其次第一个待办，最后返回末项", () => {
    const inProgress = deriveTodoState([
      makeToolCall({
        name: "TodoWrite",
        status: "completed",
        args: todos([
          { content: "一", status: "completed" },
          { content: "二", status: "in_progress" },
          { content: "三", status: "pending" }
        ]),
        createdAt: "2026-06-13T00:00:00.000Z"
      })
    ]);
    expect(todoCurrentItem(inProgress!)).toMatchObject({
      index: 2,
      total: 3,
      item: { id: "todo_2" }
    });

    const pending = deriveTodoState([
      makeToolCall({
        name: "TodoWrite",
        status: "completed",
        args: todos([
          { content: "一", status: "completed" },
          { content: "二", status: "pending" }
        ]),
        createdAt: "2026-06-13T00:00:00.000Z"
      })
    ]);
    expect(todoCurrentItem(pending!)).toMatchObject({ index: 2, item: { id: "todo_2" } });

    const done = deriveTodoState([
      makeToolCall({
        name: "TodoWrite",
        status: "completed",
        args: todos([
          { content: "一", status: "completed" },
          { content: "二", status: "completed" }
        ]),
        createdAt: "2026-06-13T00:00:00.000Z"
      })
    ]);
    expect(todoCurrentItem(done!)).toMatchObject({ index: 2, item: { id: "todo_2" } });
  });
});
