import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  askUserAnswerItemText,
  proposePlanArgsSchema,
  type AskUserAnswer,
  type ProposePlanArgs
} from "@chengxiaobang/shared";
import { textResult } from "./tool-result";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "tools/plan-tools" });

const proposePlanParams = Type.Object({
  plan: Type.String({
    description:
      "完整 Markdown 计划文本。必须包含 # 标题，以及 Summary、Key Changes、Test Plan、Assumptions 等分节。"
  }),
  allowedPrompts: Type.Optional(
    Type.Array(
      Type.Object({
        tool: Type.Literal("Bash"),
        prompt: Type.String({ description: "允许执行的 Bash 命令前缀或命令说明" })
      }),
      { description: "可选，计划确认后允许的 Bash 提示白名单" }
    )
  )
});

const askUserQuestionParams = Type.Object({
  id: Type.Optional(Type.String({ description: "可选稳定问题 ID，例如 q1、q2" })),
  header: Type.Optional(Type.String({ description: "短标题，例如 路径、范围、确认" })),
  question: Type.String({ description: "需要用户确认的问题正文" }),
  options: Type.Array(
    Type.Union([
      Type.String({ description: "选项标签" }),
      Type.Object({
        label: Type.String({ description: "选项标签" }),
        description: Type.Optional(Type.String({ description: "选项影响或取舍" }))
      })
    ]),
    { minItems: 2, maxItems: 4, description: "单选或多选的候选项，必须 2 到 4 个" }
  ),
  multiSelect: Type.Optional(Type.Boolean({ description: "是否允许多选，默认 false" }))
});

const askUserParams = Type.Object({
  questions: Type.Array(askUserQuestionParams, {
    minItems: 1,
    maxItems: 4,
    description: "一次性提出 1 到 4 个结构化问题；有多个澄清点时合并到这里。"
  }),
  answers: Type.Optional(
    Type.Record(Type.String(), Type.String(), { description: "兼容式答案映射，通常由审批通道填入" })
  ),
  annotations: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Object({
        preview: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String())
      })
    )
  ),
  metadata: Type.Optional(
    Type.Object({
      source: Type.Optional(Type.String())
    })
  )
});

const useSkillParams = Type.Object({
  skill: Type.String({ description: "要加载的技能名称" }),
  args: Type.Optional(Type.String({ description: "可选，传给技能说明的上下文参数" }))
});

export interface PlanToolRuntime {
  getApprovedPlanArgs(toolCallId: string): ProposePlanArgs | undefined;
  getAskUserAnswer(toolCallId: string): AskUserAnswer | undefined;
  loadSkill(skill: string, args?: string): Promise<string | undefined>;
}

export function createPlanTools(runtime: PlanToolRuntime): AgentTool<any>[] {
  const proposePlan: AgentTool<typeof proposePlanParams> = {
    name: "ExitPlanMode",
    label: "提交计划",
    description: "在计划模式中提交完整 Markdown 计划，等待用户确认后再执行。",
    parameters: proposePlanParams,
    execute: async (toolCallId, params) => {
      const plan = runtime.getApprovedPlanArgs(toolCallId) ?? proposePlanArgsSchema.parse(params);
      log.info(`[plan-tools] 计划已确认 toolCallId=${toolCallId} chars=${plan.markdown.length}`);
      return textResult(`用户已确认此计划，请立即按计划执行。\n\n${plan.markdown}`);
    }
  };

  const askUser: AgentTool<typeof askUserParams> = {
    name: "AskUserQuestion",
    label: "询问用户",
    description: "向用户提出 1 到 4 个真正需要决策的结构化问题。每题必须提供 2 到 4 个选项；multiSelect=true 时允许多选。",
    parameters: askUserParams,
    execute: async (toolCallId) => {
      const answer = runtime.getAskUserAnswer(toolCallId);
      if (!answer) {
        log.warn(`[plan-tools] AskUserQuestion 缺少用户回答 toolCallId=${toolCallId}`);
        throw new Error("用户未提供回答");
      }
      const lines = answer.answers.map((item, index) => {
        const question = item.question ? `${item.question} ` : "";
        return `${index + 1}. ${question}${askUserAnswerItemText(item)}`;
      });
      log.info("[plan-tools] 收到用户结构化回答", {
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
    name: "Skill",
    label: "加载技能",
    description: "按名称加载一个技能的完整说明，再根据说明继续执行任务。",
    parameters: useSkillParams,
    execute: async (_toolCallId, params) => {
      const content = await runtime.loadSkill(params.skill, params.args);
      if (!content) {
        log.warn(`[plan-tools] 技能不存在 skill=${params.skill}`);
        throw new Error(`技能不存在：${params.skill}`);
      }
      log.info(`[plan-tools] 加载技能 skill=${params.skill} chars=${content.length}`);
      return textResult(content);
    }
  };

  return [proposePlan, askUser, useSkill];
}
