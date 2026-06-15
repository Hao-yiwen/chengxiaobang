import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { SkillMarketError, type SkillMarketService } from "./skill-market-service";
import { textResult } from "./tool-result";

const createParams = Type.Object({
  url: Type.Optional(
    Type.String({
      description:
        "GitHub 链接（仓库、目录或 SKILL.md 直链）。提供时直接抓取该处的 SKILL.md 并安装，无需再填 name/description/content。"
    })
  ),
  name: Type.Optional(
    Type.String({
      description:
        "技能名，小写字母/数字/连字符，例如 daily-report；安装后用户可在对话中以 /技能名 调用。手动创建时必填。"
    })
  ),
  description: Type.Optional(
    Type.String({ description: "一句话说明技能做什么、何时使用。手动创建时必填。" })
  ),
  content: Type.Optional(
    Type.String({
      description:
        "技能正文（Markdown），即模型调用该技能时读取的操作指令。手动创建时必填，应写清流程与规则。"
    })
  )
});

export interface SkillToolRuntime {
  skillMarketService: SkillMarketService;
}

/**
 * 让模型在对话中为用户创建/安装自定义技能：要么给 GitHub 链接由后端抓取 SKILL.md，
 * 要么直接给 name/description/content 现写一个。安装后落到全局技能目录，立即可用。
 */
export function createSkillTools(runtime: SkillToolRuntime): AgentTool<any>[] {
  const createSkill: AgentTool<typeof createParams> = {
    name: "CreateSkill",
    label: "创建技能",
    description:
      "为用户创建并安装一个自定义技能。两种用法：①传 url（GitHub 仓库/目录/SKILL.md 链接），后端会抓取该处 SKILL.md 并安装；②传 name + description + content 现写一个技能。安装成功后该技能立即生效，用户可在「技能」页看到、并在对话中以 /技能名 调用。",
    parameters: createParams,
    execute: async (_toolCallId, params) => {
      try {
        if (params.url?.trim()) {
          console.info(`[skill-tools] 经链接安装技能 url=${params.url}`);
          const skill = await runtime.skillMarketService.importFromUrl({ url: params.url.trim() });
          return textResult(
            `已从链接安装技能「${skill.name}」：${skill.description}。用户可在「技能」页查看，或在对话中用 /${skill.name} 调用。`
          );
        }
        if (!params.name?.trim() || !params.description?.trim() || !params.content?.trim()) {
          throw new SkillMarketError(
            "手动创建技能需要同时提供 name、description 和 content；或改用 url 从 GitHub 导入。"
          );
        }
        console.info(`[skill-tools] 手动创建技能 name=${params.name}`);
        const skill = await runtime.skillMarketService.createCustom({
          name: params.name.trim(),
          description: params.description.trim(),
          content: params.content.trim()
        });
        return textResult(
          `已创建并安装技能「${skill.name}」：${skill.description}。用户可在「技能」页查看，或在对话中用 /${skill.name} 调用。`
        );
      } catch (error) {
        if (error instanceof SkillMarketError) {
          console.warn(`[skill-tools] 创建技能失败：${error.message}`);
          throw new Error(error.message);
        }
        throw error;
      }
    }
  };

  return [createSkill];
}
