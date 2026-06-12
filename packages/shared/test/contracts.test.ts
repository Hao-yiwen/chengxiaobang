import { describe, expect, it } from "vitest";
import {
  approvalDecisionSchema,
  askUserAnswerSchema,
  askUserArgsSchema,
  btwArgsSchema,
  proposePlanArgsSchema,
  runRequestSchema,
  sessionSchema,
  sessionUpdateSchema,
  streamEventSchema,
  toolNameSchema,
  updatePlanArgsSchema,
  useSkillArgsSchema,
  type Message,
  type Session,
  type StreamEvent,
  type ToolCall
} from "../src/index";

const message: Message = {
  id: "msg_1",
  sessionId: "session_1",
  role: "assistant",
  content: "你好",
  createdAt: "2026-06-11T00:00:00.000Z"
};

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
  it("接受本期新增的 5 个工具名", () => {
    for (const name of ["propose_plan", "update_plan", "ask_user", "btw", "use_skill"]) {
      expect(toolNameSchema.parse(name)).toBe(name);
    }
  });

  it("拒绝未知工具名", () => {
    expect(toolNameSchema.safeParse("rm_rf").success).toBe(false);
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
      answer: { optionLabel: "方案 A" }
    });
    expect(decision.answer).toEqual({ optionLabel: "方案 A" });
  });

  it("editedSteps 含非法步骤时报错", () => {
    expect(
      approvalDecisionSchema.safeParse({ approved: true, editedSteps: [{ id: "", title: "" }] })
        .success
    ).toBe(false);
  });
});

describe("askUserAnswerSchema", () => {
  it("选项与文字皆空时 refine 报错", () => {
    expect(askUserAnswerSchema.safeParse({}).success).toBe(false);
    expect(askUserAnswerSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("给选项或文字任一即可", () => {
    expect(askUserAnswerSchema.safeParse({ optionLabel: "方案 A" }).success).toBe(true);
    expect(askUserAnswerSchema.safeParse({ text: "自由回答" }).success).toBe(true);
  });
});

describe("新工具参数 schema", () => {
  it("proposePlanArgs 步骤 0 条报错", () => {
    expect(proposePlanArgsSchema.safeParse({ title: "计划", steps: [] }).success).toBe(false);
  });

  it("proposePlanArgs 步骤 21 条报错", () => {
    const steps = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, title: `步骤 ${i}` }));
    expect(proposePlanArgsSchema.safeParse({ title: "计划", steps }).success).toBe(false);
  });

  it("proposePlanArgs 正常解析并补默认 status", () => {
    const parsed = proposePlanArgsSchema.parse({
      title: "计划",
      steps: [{ id: "s1", title: "第一步", detail: "细节" }]
    });
    expect(parsed.steps[0]).toEqual({
      id: "s1",
      title: "第一步",
      status: "pending",
      detail: "细节"
    });
  });

  it("updatePlanArgs 解析且拒绝 pending 状态", () => {
    expect(updatePlanArgsSchema.parse({ stepId: "s1", status: "completed" })).toEqual({
      stepId: "s1",
      status: "completed"
    });
    expect(updatePlanArgsSchema.safeParse({ stepId: "s1", status: "pending" }).success).toBe(
      false
    );
  });

  it("askUserArgs 解析，allowFreeText 默认 true、选项最多 4 个", () => {
    expect(askUserArgsSchema.parse({ question: "选哪个？" })).toEqual({
      question: "选哪个？",
      allowFreeText: true
    });
    expect(
      askUserArgsSchema.safeParse({ question: "q", options: ["a", "b", "c", "d", "e"] }).success
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
});

describe("runRequestSchema", () => {
  it("planMode 默认 false、model/reasoningMode 可选", () => {
    const parsed = runRequestSchema.parse({ prompt: "你好" });
    expect(parsed.planMode).toBe(false);
    expect(parsed.model).toBeUndefined();
    expect(parsed.reasoningMode).toBeUndefined();
  });

  it("planMode/model/reasoningMode 显式传入生效", () => {
    const parsed = runRequestSchema.parse({
      prompt: "你好",
      planMode: true,
      model: "deepseek-chat",
      reasoningMode: "high"
    });
    expect(parsed.planMode).toBe(true);
    expect(parsed.model).toBe("deepseek-chat");
    expect(parsed.reasoningMode).toBe("high");
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
  it("解析线上事件模型的 6 种事件", () => {
    const events: StreamEvent[] = [
      { type: "run_started", runId: "run_1", sessionId: "session_1" },
      { type: "message", runId: "run_1", message },
      { type: "delta", runId: "run_1", channel: "text", delta: "好" },
      { type: "tool_call", runId: "run_1", toolCall },
      { type: "session_updated", runId: "run_1", session },
      {
        type: "run_end",
        runId: "run_1",
        status: "completed",
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
      }
    ];
    expect(events).toHaveLength(6);
    for (const event of events) {
      expect(streamEventSchema.parse(event)).toEqual(event);
    }
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

  it("未知 type 拒绝", () => {
    expect(streamEventSchema.safeParse({ type: "plan_started", runId: "run_1" }).success).toBe(
      false
    );
  });
});
