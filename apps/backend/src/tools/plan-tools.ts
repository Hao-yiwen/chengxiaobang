import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AskUserAnswer, ProposePlanArgs } from "@chengxiaobang/shared";
import { textResult } from "./tool-result";

const planStepParams = Type.Object({
  id: Type.String({ description: "稳定步骤 ID，例如 s1、s2" }),
  title: Type.String({ description: "步骤标题，一句话描述" }),
  status: Type.Optional(
    Type.Union([
      Type.Literal("pending"),
      Type.Literal("in_progress"),
      Type.Literal("completed"),
      Type.Literal("skipped")
    ])
  ),
  detail: Type.Optional(Type.String({ description: "可选步骤细节" }))
});

const proposePlanParams = Type.Object({
  title: Type.String({ description: "计划标题" }),
  steps: Type.Array(planStepParams, { description: "1 到 20 个步骤" })
});

const updatePlanParams = Type.Object({
  stepId: Type.String({ description: "要更新的步骤 ID" }),
  status: Type.Union([
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("skipped")
  ]),
  note: Type.Optional(Type.String({ description: "可选进展说明" }))
});

const askUserParams = Type.Object({
  question: Type.String({ description: "需要用户确认的问题" }),
  options: Type.Optional(Type.Array(Type.String({ description: "可选项，最多 4 个" }))),
  allowFreeText: Type.Optional(Type.Boolean({ description: "是否允许用户自由输入，默认 true" }))
});

const btwParams = Type.Object({
  note: Type.String({ description: "顺手记录的旁注" }),
  suggestion: Type.Optional(Type.String({ description: "可选建议" }))
});

const useSkillParams = Type.Object({
  name: Type.String({ description: "要加载的技能名称" })
});

export interface PlanToolRuntime {
  getApprovedPlanArgs(toolCallId: string): ProposePlanArgs | undefined;
  getAskUserAnswer(toolCallId: string): AskUserAnswer | undefined;
  loadSkill(name: string): Promise<string | undefined>;
}

export function createPlanTools(runtime: PlanToolRuntime): AgentTool<any>[] {
  const proposePlan: AgentTool<typeof proposePlanParams> = {
    name: "propose_plan",
    label: "提交计划",
    description: "在计划模式中提交步骤清单，等待用户确认或修改后再执行。",
    parameters: proposePlanParams,
    execute: async (toolCallId, params) => {
      const plan = runtime.getApprovedPlanArgs(toolCallId) ?? (params as ProposePlanArgs);
      console.info(`[plan-tools] 计划已确认 toolCallId=${toolCallId} steps=${plan.steps.length}`);
      return textResult(
        [
          `用户已确认计划「${plan.title}」。`,
          ...plan.steps.map((step, index) => `${index + 1}. ${step.title}`)
        ].join("\n")
      );
    }
  };

  const updatePlan: AgentTool<typeof updatePlanParams> = {
    name: "update_plan",
    label: "更新计划",
    description: "在执行计划时更新某个步骤的状态，可标记进行中、已完成或已跳过。",
    parameters: updatePlanParams,
    execute: async (_toolCallId, params) => {
      console.info(
        `[plan-tools] 更新计划 stepId=${params.stepId} status=${params.status}` +
          (params.note ? ` note=${params.note}` : "")
      );
      return textResult(
        `已更新步骤 ${params.stepId} -> ${params.status}${params.note ? `（${params.note}）` : ""}`
      );
    }
  };

  const askUser: AgentTool<typeof askUserParams> = {
    name: "ask_user",
    label: "询问用户",
    description: "向用户提出一个需要确认的问题，支持选项或自由文本回答。",
    parameters: askUserParams,
    execute: async (toolCallId) => {
      const answer = runtime.getAskUserAnswer(toolCallId);
      if (!answer) {
        console.warn(`[plan-tools] ask_user 缺少用户回答 toolCallId=${toolCallId}`);
        throw new Error("用户未提供回答");
      }
      const text = answer.optionLabel ?? answer.text ?? "";
      console.info(`[plan-tools] 收到用户回答 toolCallId=${toolCallId} answer=${text}`);
      return textResult(`用户回答：${text}`);
    }
  };

  const btw: AgentTool<typeof btwParams> = {
    name: "btw",
    label: "记录旁注",
    description: "记录与当前任务相关但不应打断主线的简短旁注。",
    parameters: btwParams,
    execute: async (_toolCallId, params) => {
      console.info(
        `[plan-tools] 记录旁注 note=${params.note}` +
          (params.suggestion ? ` suggestion=${params.suggestion}` : "")
      );
      return textResult("已记录旁注");
    }
  };

  const useSkill: AgentTool<typeof useSkillParams> = {
    name: "use_skill",
    label: "加载技能",
    description: "按名称加载一个技能的完整说明，再根据说明继续执行任务。",
    parameters: useSkillParams,
    execute: async (_toolCallId, params) => {
      const content = await runtime.loadSkill(params.name);
      if (!content) {
        console.warn(`[plan-tools] 技能不存在 name=${params.name}`);
        throw new Error(`技能不存在：${params.name}`);
      }
      console.info(`[plan-tools] 加载技能 name=${params.name} chars=${content.length}`);
      return textResult(content);
    }
  };

  return [proposePlan, updatePlan, askUser, btw, useSkill];
}
