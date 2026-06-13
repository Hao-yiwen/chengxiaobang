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

const todoArgs = (title: string, ids: string[]): Record<string, unknown> => ({
  title,
  items: ids.map((id) => ({ id, title: `任务 ${id}` }))
});

describe("deriveTodoState", () => {
  it("无 todo_create 时返回 undefined", () => {
    expect(deriveTodoState([])).toBeUndefined();
    expect(
      deriveTodoState([
        makeToolCall({
          name: "todo_update",
          status: "completed",
          args: { itemId: "s1", status: "completed" },
          createdAt: "2026-06-13T00:00:00.000Z"
        })
      ])
    ).toBeUndefined();
  });

  it("从 todo_create 和 todo_update 推导步骤状态与最近 note", () => {
    const anchor = makeToolCall({
      name: "todo_create",
      status: "completed",
      args: todoArgs("实现进度面板", ["s1", "s2", "s3"]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const state = deriveTodoState([
      anchor,
      makeToolCall({
        name: "todo_update",
        status: "completed",
        args: { itemId: "s1", status: "completed", note: "共享契约完成" },
        createdAt: "2026-06-13T00:01:00.000Z"
      }),
      makeToolCall({
        name: "todo_update",
        status: "completed",
        args: { itemId: "s2", status: "in_progress", note: "开始接 UI" },
        createdAt: "2026-06-13T00:02:00.000Z"
      }),
      makeToolCall({
        name: "todo_update",
        status: "failed",
        args: { itemId: "s3", status: "completed" },
        createdAt: "2026-06-13T00:03:00.000Z"
      })
    ]);

    expect(state).toMatchObject({
      toolCallId: anchor.id,
      runId: "run_1",
      title: "实现进度面板",
      finished: false,
      latestNote: { itemId: "s2", status: "in_progress", note: "开始接 UI" }
    });
    expect(state!.items.map((item) => item.status)).toEqual([
      "completed",
      "in_progress",
      "pending"
    ]);
  });

  it("重新创建 todo 后以最新有效锚点为准", () => {
    const oldAnchor = makeToolCall({
      name: "todo_create",
      status: "completed",
      args: todoArgs("旧清单", ["a1"]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const newAnchor = makeToolCall({
      name: "todo_create",
      status: "completed",
      args: todoArgs("新清单", ["b1", "b2"]),
      createdAt: "2026-06-13T00:02:00.000Z"
    });
    const state = deriveTodoState([
      oldAnchor,
      makeToolCall({
        name: "todo_update",
        status: "completed",
        args: { itemId: "a1", status: "completed" },
        createdAt: "2026-06-13T00:01:00.000Z"
      }),
      newAnchor
    ]);
    expect(state!.toolCallId).toBe(newAnchor.id);
    expect(state!.title).toBe("新清单");
    expect(state!.items.map((item) => item.id)).toEqual(["b1", "b2"]);
    expect(state!.items.map((item) => item.status)).toEqual(["pending", "pending"]);
  });

  it("按 runId 只推导目标 run，未指定时回退最近一次 todo", () => {
    const first = makeToolCall({
      name: "todo_create",
      runId: "run_1",
      status: "completed",
      args: todoArgs("第一轮", ["s1"]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const second = makeToolCall({
      name: "todo_create",
      runId: "run_2",
      status: "completed",
      args: todoArgs("第二轮", ["s2"]),
      createdAt: "2026-06-13T00:01:00.000Z"
    });
    expect(deriveTodoState([first, second], { runId: "run_1" })!.title).toBe("第一轮");
    expect(deriveTodoState([first, second])!.title).toBe("第二轮");
  });

  it("非法锚点会降级到更早的有效清单，非法 update 会被跳过", () => {
    const valid = makeToolCall({
      name: "todo_create",
      status: "completed",
      args: todoArgs("有效清单", ["s1"]),
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const invalid = makeToolCall({
      name: "todo_create",
      status: "completed",
      args: { title: "", items: [] },
      createdAt: "2026-06-13T00:02:00.000Z"
    });
    const state = deriveTodoState([
      valid,
      makeToolCall({
        name: "todo_update",
        status: "completed",
        args: { itemId: "missing", status: "completed" },
        createdAt: "2026-06-13T00:01:00.000Z"
      }),
      invalid
    ]);
    expect(state!.title).toBe("有效清单");
    expect(state!.items[0].status).toBe("pending");
  });
});

describe("todoCurrentItem", () => {
  it("优先返回进行中步骤，其次第一个待办，最后返回末项", () => {
    const inProgress = deriveTodoState([
      makeToolCall({
        name: "todo_create",
        status: "completed",
        args: {
          title: "清单",
          items: [
            { id: "s1", title: "一", status: "completed" },
            { id: "s2", title: "二", status: "in_progress" },
            { id: "s3", title: "三", status: "pending" }
          ]
        },
        createdAt: "2026-06-13T00:00:00.000Z"
      })
    ]);
    expect(todoCurrentItem(inProgress!)).toMatchObject({
      index: 2,
      total: 3,
      item: { id: "s2" }
    });

    const pending = deriveTodoState([
      makeToolCall({
        name: "todo_create",
        status: "completed",
        args: {
          title: "清单",
          items: [
            { id: "s1", title: "一", status: "completed" },
            { id: "s2", title: "二", status: "pending" }
          ]
        },
        createdAt: "2026-06-13T00:00:00.000Z"
      })
    ]);
    expect(todoCurrentItem(pending!)).toMatchObject({ index: 2, item: { id: "s2" } });

    const done = deriveTodoState([
      makeToolCall({
        name: "todo_create",
        status: "completed",
        args: {
          title: "清单",
          items: [
            { id: "s1", title: "一", status: "completed" },
            { id: "s2", title: "二", status: "skipped" }
          ]
        },
        createdAt: "2026-06-13T00:00:00.000Z"
      })
    ]);
    expect(todoCurrentItem(done!)).toMatchObject({ index: 2, item: { id: "s2" } });
  });
});
