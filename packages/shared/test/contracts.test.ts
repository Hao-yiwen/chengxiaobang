import { describe, expect, it } from "vitest";
import {
  approvalDecisionSchema,
  activeRunSnapshotSchema,
  appEventSchema,
  askUserAnswerSchema,
  askUserArgsSchema,
  DEFAULT_ACCESS_MODE,
  gitChangesResultSchema,
  messageFeedbackUpdateSchema,
  messageSchema,
  proposePlanArgsSchema,
  runRecordSchema,
  runRequestSchema,
  sessionInputSchema,
  sessionSchema,
  sessionUpdateSchema,
  scheduledTaskEventSchema,
  streamEventSchema,
  builtinToolMetadata,
  toolCallSchema,
  toolDisplayCategory,
  toolNameSchema,
  todoWriteArgsSchema,
  webSearchConfigInputSchema,
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

  it("解析助手回复反馈与反馈更新输入", () => {
    expect(messageSchema.parse({ ...message, feedback: "up" }).feedback).toBe("up");
    expect(messageSchema.safeParse({ ...message, feedback: "maybe" }).success).toBe(false);
    expect(messageFeedbackUpdateSchema.parse({ feedback: "down" })).toEqual({ feedback: "down" });
    expect(messageFeedbackUpdateSchema.parse({ feedback: null })).toEqual({ feedback: null });
    expect(messageFeedbackUpdateSchema.safeParse({ feedback: "maybe" }).success).toBe(false);
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

describe("sessionSchema", () => {
  it("接受微信绑定会话字段", () => {
    expect(
      sessionSchema.parse({
        ...session,
        wechatChatId: "wx_user1"
      }).wechatChatId
    ).toBe("wx_user1");
  });

  it("接受会话更新项目文件夹绑定", () => {
    expect(sessionUpdateSchema.parse({ projectId: "project_1" })).toEqual({
      projectId: "project_1"
    });
    expect(sessionUpdateSchema.parse({ projectId: null })).toEqual({
      projectId: null
    });
  });
});

describe("gitChangesResultSchema", () => {
  it("允许同一路径按 staged/unstaged scope 拆成多条记录", () => {
    const parsed = gitChangesResultSchema.parse({
      isRepo: true,
      files: [
        {
          path: "src/app.ts",
          scope: "staged",
          status: "MM",
          diff: "diff --git a/src/app.ts b/src/app.ts\n+staged\n",
          additions: 1,
          deletions: 0
        },
        {
          path: "src/app.ts",
          scope: "unstaged",
          status: "MM",
          diff: "diff --git a/src/app.ts b/src/app.ts\n+unstaged\n",
          additions: 1,
          deletions: 0
        }
      ]
    });

    expect(parsed.files.map((file) => `${file.scope}:${file.path}`)).toEqual([
      "staged:src/app.ts",
      "unstaged:src/app.ts"
    ]);
  });

  it("允许无可展示文本 diff 的 Git 变更记录不带行数统计", () => {
    const parsed = gitChangesResultSchema.parse({
      isRepo: true,
      files: [{ path: "blob.bin", scope: "unstaged", status: "??", diff: "" }]
    });

    expect(parsed.files[0]).toEqual({
      path: "blob.bin",
      scope: "unstaged",
      status: "??",
      diff: ""
    });
  });

  it("拒绝缺少 scope 的 Git 变更记录", () => {
    expect(
      gitChangesResultSchema.safeParse({
        isRepo: true,
        files: [{ path: "src/app.ts", status: " M", diff: "" }]
      }).success
    ).toBe(false);
  });
});

const toolCall: ToolCall = {
  id: "tc_1",
  runId: "run_1",
  name: "ExitPlanMode",
  args: { plan: "# 计划\n\n## Summary\n先规划再执行。" },
  status: "pending_approval",
  createdAt: "2026-06-11T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z"
};

const fileChange = {
  path: "src/app.ts",
  operation: "write" as const,
  patch: "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -0,0 +1 @@\n+hello\n",
  additions: 1,
  deletions: 0,
  toolCallIds: ["tc_1"]
};

describe("toolNameSchema", () => {
  it("接受新增工具名", () => {
    for (const name of [
      "Read",
      "Write",
      "Edit",
      "LS",
      "MakeDirectory",
      "Glob",
      "Grep",
      "Bash",
      "BashStatus",
      "BashCancel",
      "GitStatus",
      "GitDiff",
      "WebFetch",
      "WebSearch",
      "ToolSearch",
      "ExitPlanMode",
      "AskUserQuestion",
      "Skill",
      "TodoRead",
      "TodoWrite",
      "CreateSkill",
      "ScheduleCreate",
      "ScheduleList",
      "ScheduleCancel",
      "Memory",
      "OcrExtractText",
      "PowerShell"
    ]) {
      expect(toolNameSchema.parse(name)).toBe(name);
    }
  });

  it("每个内置工具都有治理元数据", () => {
    for (const name of toolNameSchema.options) {
      const metadata = builtinToolMetadata[name];
      expect(metadata, name).toBeTruthy();
      expect(metadata.searchHint, name).toEqual(expect.any(String));
      expect(metadata.maxInlineResultChars, name).toBeGreaterThan(0);
      expect(toolDisplayCategory(name), name).toBe(metadata.category);
      expect(metadata.readOnly && metadata.mutating, name).toBe(false);
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

  it("允许 approved 决议携带项目级审批作用域", () => {
    expect(approvalDecisionSchema.parse({ approved: true, approvalScope: "project" })).toEqual({
      approved: true,
      approvalScope: "project"
    });
  });

  it("拒绝 approvalScope 出现在拒绝决议上", () => {
    expect(
      approvalDecisionSchema.safeParse({ approved: false, approvalScope: "project" }).success
    ).toBe(false);
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

  it("解析工具产生的文本文件 diff 元数据", () => {
    const parsed = toolCallSchema.parse({
      ...toolCall,
      name: "Write",
      status: "completed",
      fileChange
    });

    expect(parsed.fileChange).toMatchObject({
      path: "src/app.ts",
      operation: "write",
      additions: 1,
      deletions: 0,
      toolCallIds: ["tc_1"]
    });
  });

  it("解析写入工具审批预览 diff", () => {
    for (const status of ["pending_approval", "completed", "failed"] as const) {
      const parsed = toolCallSchema.parse({
        ...toolCall,
        name: "Write",
        status,
        preview: {
          kind: "text_diff",
          path: "src/app.ts",
          oldText: "old\n",
          newText: "new\n"
        }
      });

      expect(parsed.preview).toEqual({
        kind: "text_diff",
        path: "src/app.ts",
        oldText: "old\n",
        newText: "new\n"
      });
    }
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
      fileChanges: [fileChange],
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:00:01.000Z"
    });

    expect(run).toMatchObject({
      providerId: "deepseek",
      providerKind: "deepseek",
      model: "deepseek-v4-flash"
    });
    expect(run.fileChanges?.[0]?.path).toBe("src/app.ts");
  });
});

describe("askUserAnswerSchema", () => {
  it("选项与文字皆空时 refine 报错", () => {
    expect(askUserAnswerSchema.safeParse({}).success).toBe(false);
    expect(askUserAnswerSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("只接受结构化 answers 数组", () => {
    expect(askUserAnswerSchema.safeParse({ optionLabel: "方案 A" }).success).toBe(false);
    expect(askUserAnswerSchema.safeParse({ text: "文字回答" }).success).toBe(false);
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

  it("文字型 answer payload 仍需非空", () => {
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
      plan: `<proposed_plan>
# 示例计划

## Summary
先规划再执行。
</proposed_plan>`
    });
    expect(parsed.markdown).toContain("# 示例计划");
    expect(parsed.markdown).not.toContain("proposed_plan");
  });

  it("proposePlanArgs 拒绝空 Markdown", () => {
    expect(proposePlanArgsSchema.safeParse({ plan: "   " }).success).toBe(false);
  });

  it("askUserArgs 拒绝旧版单题，只接受 questions 数组", () => {
    expect(askUserArgsSchema.safeParse({ question: "选哪个？" }).success).toBe(false);
    expect(askUserArgsSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(
      askUserArgsSchema.safeParse({
        questions: [{ question: "q", options: ["a", "b", "c", "d", "e"] }]
      }).success
    ).toBe(false);
    expect(
      askUserArgsSchema.safeParse({
        questions: [{ question: "q" }]
      }).success
    ).toBe(false);
    expect(
      askUserArgsSchema.safeParse({
        questions: [{ question: "q", options: ["a"] }]
      }).success
    ).toBe(false);
  });

  it("askUserArgs 支持 1 到 4 个结构化选择题", () => {
    expect(
      askUserArgsSchema.parse({
        questions: [
          { id: "q1", question: "类型？", options: ["A", "B"], multiSelect: true },
          {
            id: "q2",
            header: "补充",
            question: "补充说明？",
            options: [
              { label: "继续", description: "保持当前方向" },
              { label: "暂停", description: "等用户补充信息" }
            ]
          }
        ]
      })
    ).toEqual({
      questions: [
        { id: "q1", question: "类型？", options: ["A", "B"], multiSelect: true },
        {
          id: "q2",
          header: "补充",
          question: "补充说明？",
          options: [
            { label: "继续", description: "保持当前方向" },
            { label: "暂停", description: "等用户补充信息" }
          ]
        }
      ]
    });
    expect(
      askUserArgsSchema.safeParse({
        questions: [
          { question: "1", options: ["a", "b"] },
          { question: "2", options: ["a", "b"] },
          { question: "3", options: ["a", "b"] },
          { question: "4", options: ["a", "b"] },
          { question: "5", options: ["a", "b"] }
        ]
      }).success
    ).toBe(false);
  });

  it("useSkillArgs 解析", () => {
    expect(useSkillArgsSchema.parse({ skill: "excel", args: "表格" })).toEqual({
      skill: "excel",
      args: "表格"
    });
    expect(useSkillArgsSchema.safeParse({}).success).toBe(false);
  });

  it("todoWriteArgs 解析并限制最多一个 in_progress", () => {
    expect(
      todoWriteArgsSchema.parse({
        todos: [{ content: "新增契约", status: "in_progress", priority: "high" }]
      })
    ).toEqual({
      todos: [{ content: "新增契约", status: "in_progress", priority: "high" }]
    });
    expect(
      todoWriteArgsSchema.safeParse({
        todos: [
          { content: "一", status: "in_progress", priority: "high" },
          { content: "二", status: "in_progress", priority: "medium" }
        ]
      }).success
    ).toBe(false);
  });
});

describe("runRequestSchema", () => {
  it("accessMode 默认智能审批，planMode 默认 false、model/reasoningMode/clientRequestId 可选", () => {
    const parsed = runRequestSchema.parse({ prompt: "你好" });
    expect(parsed.accessMode).toBe(DEFAULT_ACCESS_MODE);
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

describe("sessionInputSchema", () => {
  it("省略 accessMode 时默认使用智能审批", () => {
    expect(sessionInputSchema.parse({ title: "新对话" }).accessMode).toBe(DEFAULT_ACCESS_MODE);
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
  it("解析线上事件模型的 8 种事件", () => {
    const events: StreamEvent[] = [
      { type: "setup_error", error: "请先配置至少一个模型" },
      { type: "run_started", runId: "run_1", sessionId: "session_1" },
      { type: "message", runId: "run_1", message },
      { type: "delta", runId: "run_1", channel: "text", delta: "好" },
      {
        type: "plan_delta",
        runId: "run_1",
        contentIndex: 0,
        toolCallId: "tc_plan",
        markdown: "# 计划\n\n## Summary\n先确认。",
        delta: "## Summary\n先确认。",
        updatedAt: "2026-06-11T00:00:00.000Z"
      },
      {
        type: "tool_activity",
        runId: "run_1",
        activity: {
          contentIndex: 0,
          toolCallId: "tc_1",
          name: "Write",
          argsPreview: { file_path: "src/app.ts" },
          updatedAt: "2026-06-11T00:00:00.000Z"
        }
      },
      { type: "tool_call", runId: "run_1", toolCall },
      { type: "session_updated", runId: "run_1", session },
      {
        type: "run_end",
        runId: "run_1",
        status: "completed",
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        fileChanges: [fileChange]
      }
    ];
    expect(events).toHaveLength(9);
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
          name: "Write",
          argsPreview: { file_path: "src/app.ts" },
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
          argsPreview: { file_path: 123 },
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
          name: "WebFetch",
          argsPreview: { url: "https://example.com" },
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
          name: "Bash",
          argsPreview: { command: "pnpm test" },
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
