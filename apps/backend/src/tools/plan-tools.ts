import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  askUserAnswerItemText,
  type AskUserAnswer,
  type ProposePlanArgs
} from "@chengxiaobang/shared";
import { textResult } from "./tool-result";

const proposePlanParams = Type.Object({
  markdown: Type.String({
    description:
      "完整 Markdown 计划文本。必须包含 # 标题，以及 Summary、Key Changes、Test Plan、Assumptions 等分节。"
  })
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

const askUserQuestionParams = Type.Object({
  id: Type.Optional(Type.String({ description: "可选稳定问题 ID，例如 q1、q2" })),
  question: Type.String({ description: "需要用户确认的问题正文" }),
  options: Type.Optional(Type.Array(Type.String({ description: "选择题选项，最多 4 个" }))),
  allowFreeText: Type.Optional(
    Type.Boolean({ description: "是否允许用户自由输入，默认 true；纯选择题可设为 false" })
  )
});

const askUserParams = Type.Object({
  questions: Type.Array(askUserQuestionParams, {
    description: "一次性提出 1 到 4 个结构化问题；有多个澄清点时合并到这里。"
  })
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
    description: "在计划模式中提交完整 Markdown 计划，等待用户确认后再执行。",
    parameters: proposePlanParams,
    execute: async (toolCallId, params) => {
      const plan = runtime.getApprovedPlanArgs(toolCallId) ?? (params as ProposePlanArgs);
      console.info(`[plan-tools] 计划已确认 toolCallId=${toolCallId} chars=${plan.markdown.length}`);
      return textResult(`用户已确认此计划，请立即按计划执行。\n\n${plan.markdown}`);
    }
  };

  const updatePlan: AgentTool<typeof updatePlanParams> = {
    name: "update_plan",
    label: "更新计划",
    description: "旧版计划进度工具，仅用于历史兼容；新版计划模式不应调用。",
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
    description: "向用户提出 1 到 4 个结构化问题，支持选择题和自由文本回答。",
    parameters: askUserParams,
    execute: async (toolCallId) => {
      const answer = runtime.getAskUserAnswer(toolCallId);
      if (!answer) {
        console.warn(`[plan-tools] ask_user 缺少用户回答 toolCallId=${toolCallId}`);
        throw new Error("用户未提供回答");
      }
      const lines = answer.answers.map((item, index) => {
        const question = item.question ? `${item.question} ` : "";
        return `${index + 1}. ${question}${askUserAnswerItemText(item)}`;
      });
      console.info("[plan-tools] 收到用户结构化回答", {
        toolCallId,
        answerCount: answer.answers.length
      });
      return textResult(
        [
          "用户回答：",
          ...lines,
          "",
          `结构化回答 JSON：${JSON.stringify(answer.answers)}`
        ].join("\n")
      );
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

  return [proposePlan, updatePlan, askUser, useSkill];
}
