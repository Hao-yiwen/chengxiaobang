import { describe, expect, it } from "vitest";
import {
  approvalDecisionSchema,
  activeRunSnapshotSchema,
  appEventSchema,
  askUserAnswerSchema,
  askUserArgsSchema,
  btwArgsSchema,
  messageSchema,
  proposePlanArgsSchema,
  runRecordSchema,
  runRequestSchema,
  sessionSchema,
  sessionUpdateSchema,
  scheduledTaskEventSchema,
  streamEventSchema,
  toolCallSchema,
  toolNameSchema,
  todoCreateArgsSchema,
  todoUpdateArgsSchema,
  webSearchConfigInputSchema,
  updatePlanArgsSchema,
  useSkillArgsSchema,
  type Message,
  type AppEvent,
  type Session,
  type StreamEvent,
  type ToolCall
} from "../src/index";

const message: Message = {
  id: "msg_1",
  sessionId: "session_1",
  role: "assistant",
  content: "你好",
  attachments: [],
  createdAt: "2026-06-11T00:00:00.000Z"
};

describe("messageSchema", () => {
  it("旧消息缺少附件字段时默认空数组", () => {
    const parsed = messageSchema.parse(message);
    expect(parsed.attachments).toEqual([]);
  });
});

const session: Session = {
  id: "session_1",
  projectId: null,
  title: "修复登录报错",
  accessMode: "approval",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z"
};

const toolCall: ToolCall = {
  id: "tc_1",
  runId: "run_1",
  name: "propose_plan",
  args: { title: "t", steps: [{ id: "s1", title: "第一步" }] },
  status: "pending_approval",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z"
};

describe("toolNameSchema", () => {
  it("接受新增工具名", () => {
    for (const name of [
      "propose_plan",
      "update_plan",
      "ask_user",
      "btw",
      "use_skill",
      "web_search",
      "todo_create",
      "todo_update",
      "memory",
      "shell_status",
      "shell_cancel"
    ]) {
      expect(toolNameSchema.parse(name)).toBe(name);
    }
  });

  it("拒绝未知工具名", () => {
    expect(toolNameSchema.safeParse("rm_rf").success).toBe(false);
  });
});

describe("webSearchConfigInputSchema", () => {
  it("解析 Tavily 网络搜索配置输入", () => {
    expect(webSearchConfigInputSchema.parse({ enabled: true, apiKey: "tvly-key" })).toEqual({
      enabled: true,
      apiKey: "tvly-key"
    });
    expect(webSearchConfigInputSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
});

describe("approvalDecisionSchema", () => {
  it("仅 approved 可解析（向后兼容老客户端）", () => {
    expect(approvalDecisionSchema.parse({ approved: true })).toEqual({ approved: true });
    expect(approvalDecisionSchema.parse({ approved: false })).toEqual({ approved: false });
  });

  it("携带 editedSteps 可解析，步骤 status 默认 pending", () => {
    const decision = approvalDecisionSchema.parse({
      approved: true,
      editedSteps: [{ id: "s1", title: "改后的第一步" }]
    });
    expect(decision.editedSteps).toEqual([
      { id: "s1", title: "改后的第一步", status: "pending" }
    ]);
  });

  it("携带 answer 可解析", () => {
    const decision = approvalDecisionSchema.parse({
      approved: true,
      answer: { answers: [{ optionLabel: "方案 A" }] }
    });
    expect(decision.answer).toEqual({ answers: [{ optionLabel: "方案 A" }] });
  });

  it("editedSteps 含非法步骤时报错", () => {
    expect(
      approvalDecisionSchema.safeParse({ approved: true, editedSteps: [{ id: "", title: "" }] })
        .success
    ).toBe(false);
  });
});

describe("activeRunSnapshotSchema", () => {
  it("解析活跃 run 快照", () => {
    const snapshot = activeRunSnapshotSchema.parse({
      run: {
        id: "run_1",
        sessionId: "session_1",
        status: "running",
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:00.000Z"
      },
      toolCalls: [toolCall]
    });

    expect(snapshot.run.status).toBe("running");
    expect(snapshot.toolCalls[0]?.status).toBe("pending_approval");
  });
});

describe("toolCallSchema", () => {
  it("解析智能审批等待态与裁决元数据", () => {
    const parsed = toolCallSchema.parse({
      ...toolCall,
      status: "pending_smart_approval",
      approval: {
        kind: "smart",
        source: "model",
        verdict: "ask_user",
        risk: "medium",
        score: 0.6,
        reason: "需要人工确认",
        decidedAt: "2026-06-13T00:00:00.000Z"
      }
    });

    expect(parsed.status).toBe("pending_smart_approval");
    expect(parsed.approval?.verdict).toBe("ask_user");
  });
});

describe("runRecordSchema", () => {
  it("解析运行时的模型快照字段", () => {
    const run = runRecordSchema.parse({
      id: "run_1",
      sessionId: "session_1",
      status: "completed",
      providerId: "deepseek",
      providerKind: "deepseek",
      model: "deepseek-v4-flash",
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15
      },
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    });

    expect(run).toMatchObject({
      providerId: "deepseek",
      providerKind: "deepseek",
      model: "deepseek-v4-flash"
    });
  });
});

describe("askUserAnswerSchema", () => {
  it("选项与文字皆空时 refine 报错", () => {
    expect(askUserAnswerSchema.safeParse({}).success).toBe(false);
    expect(askUserAnswerSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("只接受结构化 answers 数组", () => {
    expect(askUserAnswerSchema.safeParse({ optionLabel: "方案 A" }).success).toBe(false);
    expect(askUserAnswerSchema.safeParse({ text: "自由回答" }).success).toBe(false);
    expect(askUserAnswerSchema.safeParse({ answers: [{ optionLabel: "方案 A" }] }).success).toBe(
      true
    );
  });

  it("支持最多 4 个结构化回答", () => {
    expect(
      askUserAnswerSchema.parse({
        answers: [
          { id: "q1", question: "选哪个？", optionLabel: "A" },
          { id: "q2", question: "说明原因", text: "因为更稳" }
        ]
      })
    ).toEqual({
      answers: [
        { id: "q1", question: "选哪个？", optionLabel: "A" },
        { id: "q2", question: "说明原因", text: "因为更稳" }
      ]
    });
    expect(
      askUserAnswerSchema.safeParse({
        answers: [
          { text: "1" },
          { text: "2" },
          { text: "3" },
          { text: "4" },
          { text: "5" }
        ]
      }).success
    ).toBe(false);
  });

  it("结构化回答仍保留旧版非空校验", () => {
    expect(
      askUserAnswerSchema.safeParse({
        answers: [{ id: "q1", question: "请说明原因", text: "   " }]
      }).success
    ).toBe(false);
  });
});

describe("新工具参数 schema", () => {
  it("proposePlanArgs 解析 Markdown 计划并清理包裹标签", () => {
    const parsed = proposePlanArgsSchema.parse({
      markdown: `<proposed_plan>
# 示例计划

## Summary
先规划再执行。
</proposed_plan>`
    });
    expect(parsed.markdown).toContain("# 示例计划");
    expect(parsed.markdown).not.toContain("proposed_plan");
  });

  it("proposePlanArgs 拒绝空 Markdown", () => {
    expect(proposePlanArgsSchema.safeParse({ markdown: "   " }).success).toBe(false);
  });

  it("proposePlanArgs 兼容旧版步骤计划并转换为 Markdown", () => {
    const parsed = proposePlanArgsSchema.parse({
      title: "计划",
      steps: [{ id: "s1", title: "第一步", detail: "细节" }]
    });
    expect(parsed.markdown).toContain("# 计划");
    expect(parsed.markdown).toContain("- 第一步");
  });

  it("updatePlanArgs 作为旧版计划进度参数保留解析能力", () => {
    expect(updatePlanArgsSchema.parse({ stepId: "s1", status: "completed" })).toEqual({
      stepId: "s1",
      status: "completed"
    });
    expect(updatePlanArgsSchema.safeParse({ stepId: "s1", status: "pending" }).success).toBe(
      false
    );
  });

  it("askUserArgs 拒绝旧版单题，只接受 questions 数组", () => {
    expect(askUserArgsSchema.safeParse({ question: "选哪个？" }).success).toBe(false);
    expect(
      askUserArgsSchema.safeParse({
        questions: [{ question: "q", options: ["a", "b", "c", "d", "e"] }]
      }).success
    ).toBe(false);
  });

  it("askUserArgs 支持最多 4 个结构化问题", () => {
    expect(
      askUserArgsSchema.parse({
        questions: [
          { id: "q1", question: "类型？", options: ["A", "B"], allowFreeText: false },
          { id: "q2", question: "补充说明？" }
        ]
      })
    ).toEqual({
      questions: [
        { id: "q1", question: "类型？", options: ["A", "B"], allowFreeText: false },
        { id: "q2", question: "补充说明？", allowFreeText: true }
      ]
    });
    expect(
      askUserArgsSchema.safeParse({
        questions: [
          { question: "1" },
          { question: "2" },
          { question: "3" },
          { question: "4" },
          { question: "5" }
        ]
      }).success
    ).toBe(false);
  });

  it("btwArgs 解析", () => {
    expect(btwArgsSchema.parse({ note: "发现一个问题" })).toEqual({ note: "发现一个问题" });
    expect(btwArgsSchema.safeParse({ note: "" }).success).toBe(false);
  });

  it("useSkillArgs 解析", () => {
    expect(useSkillArgsSchema.parse({ name: "excel" })).toEqual({ name: "excel" });
    expect(useSkillArgsSchema.safeParse({}).success).toBe(false);
  });

  it("todoCreateArgs 解析并限制 1 到 20 项", () => {
    expect(
      todoCreateArgsSchema.parse({
        title: "实现右侧进度",
        items: [{ id: "s1", title: "新增契约", detail: "shared" }]
      })
    ).toEqual({
      title: "实现右侧进度",
      items: [{ id: "s1", title: "新增契约", status: "pending", detail: "shared" }]
    });
    expect(todoCreateArgsSchema.safeParse({ title: "空清单", items: [] }).success).toBe(false);
    expect(
      todoCreateArgsSchema.safeParse({
        title: "过长清单",
        items: Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, title: `任务 ${i}` }))
      }).success
    ).toBe(false);
  });

  it("todoUpdateArgs 解析且拒绝 pending 状态", () => {
    expect(todoUpdateArgsSchema.parse({ itemId: "s1", status: "completed" })).toEqual({
      itemId: "s1",
      status: "completed"
    });
    expect(todoUpdateArgsSchema.safeParse({ itemId: "s1", status: "pending" }).success).toBe(
      false
    );
  });
});

describe("runRequestSchema", () => {
  it("planMode 默认 false、model/reasoningMode/clientRequestId 可选", () => {
    const parsed = runRequestSchema.parse({ prompt: "你好" });
    expect(parsed.planMode).toBe(false);
    expect(parsed.model).toBeUndefined();
    expect(parsed.reasoningMode).toBeUndefined();
    expect(parsed.clientRequestId).toBeUndefined();
    expect(parsed.displayAttachments).toEqual([]);
  });

  it("planMode/model/reasoningMode/clientRequestId 显式传入生效", () => {
    const parsed = runRequestSchema.parse({
      prompt: "你好",
      displayContent: "用户看到的原文",
      displayAttachments: [
        {
          id: "att_1",
          name: "截图.png",
          kind: "image",
          mimeType: "image/png",
          size: 100,
          path: "/tmp/cxb/att_1.png"
        }
      ],
      clientRequestId: "client_1",
      planMode: true,
      model: "deepseek-chat",
      reasoningMode: "high"
    });
    expect(parsed.clientRequestId).toBe("client_1");
    expect(parsed.planMode).toBe(true);
    expect(parsed.model).toBe("deepseek-chat");
    expect(parsed.reasoningMode).toBe("high");
    expect(parsed.displayContent).toBe("用户看到的原文");
    expect(parsed.displayAttachments[0]).toMatchObject({ name: "截图.png", kind: "image" });
  });
});

describe("runRecordSchema", () => {
  it("failed run 可携带持久化错误详情", () => {
    expect(
      runRecordSchema.parse({
        id: "run_1",
        sessionId: "session_1",
        status: "failed",
        error: "模型 token 超限",
        createdAt: "2026-06-11T00:00:00.000Z",
        updatedAt: "2026-06-11T00:00:01.000Z"
      })
    ).toMatchObject({
      id: "run_1",
      status: "failed",
      error: "模型 token 超限"
    });
  });
});

describe("session 契约", () => {
  it("sessionSchema 的 model/reasoningMode 可选", () => {
    const base = {
      id: "session_1",
      projectId: null,
      title: "会话",
      accessMode: "approval",
      createdAt: "2026-06-11T00:00:00.000Z",
      updatedAt: "2026-06-11T00:00:00.000Z"
    };
    expect(sessionSchema.parse(base).model).toBeUndefined();
    expect(sessionSchema.parse(base).reasoningMode).toBeUndefined();
    expect(sessionSchema.parse({ ...base, accessMode: "smart_approval" }).accessMode).toBe(
      "smart_approval"
    );
    expect(sessionSchema.parse({ ...base, model: "kimi-k2.6", reasoningMode: "auto" }))
      .toMatchObject({ model: "kimi-k2.6", reasoningMode: "auto" });
  });

  it("sessionUpdate model/reasoningMode 可置 null", () => {
    expect(sessionUpdateSchema.parse({ model: null, reasoningMode: null })).toEqual({
      model: null,
      reasoningMode: null
    });
    expect(sessionUpdateSchema.parse({ model: "deepseek-chat", reasoningMode: "xhigh" })).toEqual({
      model: "deepseek-chat",
      reasoningMode: "xhigh"
    });
  });
});

describe("streamEventSchema", () => {
  it("解析线上事件模型的 7 种事件", () => {
    const events: StreamEvent[] = [
      { type: "run_started", runId: "run_1", sessionId: "session_1" },
      { type: "message", runId: "run_1", message },
      { type: "delta", runId: "run_1", channel: "text", delta: "好" },
      {
        type: "tool_activity",
        runId: "run_1",
        activity: {
          contentIndex: 0,
          toolCallId: "tc_1",
          name: "write_file",
          argsPreview: { path: "src/app.ts" },
          updatedAt: "2026-06-11T00:00:00.000Z"
        }
      },
      { type: "tool_call", runId: "run_1", toolCall },
      { type: "session_updated", runId: "run_1", session },
      {
        type: "run_end",
        runId: "run_1",
        status: "completed",
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
      }
    ];
    expect(events).toHaveLength(7);
    for (const event of events) {
      expect(streamEventSchema.parse(event)).toEqual(event);
    }
  });

  it("tool_activity 仅接受允许展示的预览字段", () => {
    expect(
      streamEventSchema.safeParse({
        type: "tool_activity",
        runId: "run_1",
        activity: {
          contentIndex: 0,
          name: "write_file",
          argsPreview: { path: "src/app.ts" },
          updatedAt: "2026-06-11T00:00:00.000Z"
        }
      }).success
    ).toBe(true);
    expect(
      streamEventSchema.safeParse({
        type: "tool_activity",
        runId: "run_1",
        activity: {
          contentIndex: 0,
          argsPreview: { path: 123 },
          updatedAt: "2026-06-11T00:00:00.000Z"
        }
      }).success
    ).toBe(false);
    expect(
      streamEventSchema.safeParse({
        type: "tool_activity",
        runId: "run_1",
        activity: {
          contentIndex: 0,
          argsPreview: { content: "大参数不能进入预览" },
          updatedAt: "2026-06-11T00:00:00.000Z"
        }
      }).success
    ).toBe(false);
  });

  it("run_started 可带 providerId/model 回执", () => {
    const event = streamEventSchema.parse({
      type: "run_started",
      runId: "run_1",
      sessionId: "session_1",
      providerId: "deepseek",
      model: "deepseek-chat",
      reasoningMode: "high"
    });
    expect(event).toMatchObject({
      providerId: "deepseek",
      model: "deepseek-chat",
      reasoningMode: "high"
    });
  });

  it("解析定时任务事件并纳入 AppEvent", () => {
    const events: AppEvent[] = [
      {
        type: "scheduled_task_started",
        taskId: "task_1",
        sessionId: "session_1",
        name: "AI 日报",
        trigger: "schedule",
        occurredAt: "2026-06-13T01:00:00.000Z"
      },
      {
        type: "scheduled_task_finished",
        taskId: "task_1",
        sessionId: "session_1",
        name: "AI 日报",
        trigger: "manual",
        status: "failed",
        runId: "run_1",
        error: "模型超时",
        occurredAt: "2026-06-13T01:01:00.000Z"
      }
    ];

    for (const event of events) {
      expect(scheduledTaskEventSchema.parse(event)).toEqual(event);
      expect(appEventSchema.parse(event)).toEqual(event);
    }
    expect(
      scheduledTaskEventSchema.safeParse({
        type: "scheduled_task_finished",
        taskId: "task_1",
        sessionId: "session_1",
        name: "AI 日报",
        trigger: "manual",
        status: "running",
        occurredAt: "2026-06-13T01:01:00.000Z"
      }).success
    ).toBe(false);
  });

  it("未知 type 拒绝", () => {
    expect(streamEventSchema.safeParse({ type: "plan_started", runId: "run_1" }).success).toBe(
      false
    );
  });
});
