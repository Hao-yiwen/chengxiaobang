import { z } from "zod";

/** 技能分类：市场按「编程」「办公」组织；解析不出来时归 other。 */
export const skillCategorySchema = z.enum(["coding", "office", "other"]);
export type SkillCategory = z.infer<typeof skillCategorySchema>;

/**
 * 技能来源：builtin 随应用内置且始终激活；market 随应用分发、由用户按需激活；
 * custom 是用户经 GitHub 链接导入或手动创建、落在 ~/.chengxiaobang/skills 的技能；
 * plugin 由已启用插件提供（随插件整包启停，可在技能页单项停用）。
 */
export const skillSourceSchema = z.enum(["builtin", "market", "custom", "plugin"]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

/** 技能页的单行条目：市场目录与「我的技能」共用这一形状。 */
export const skillSummarySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** 可选：更细的触发条件提示，来自 SKILL.md frontmatter 的 when_to_use。 */
  whenToUse: z.string().optional(),
  category: skillCategorySchema,
  source: skillSourceSchema,
  /** builtin 恒为 true；market 由激活状态决定；custom 安装即激活；plugin 随插件启停且可单项停用。 */
  enabled: z.boolean(),
  /** 技能被模型/用户调用的次数；用于后端排序与后续 UI 展示，缺失表示暂无记录。 */
  usageCount: z.number().int().nonnegative().optional(),
  /** 最近一次调用时间（ISO），缺失表示暂无记录。 */
  lastUsedAt: z.string().optional(),
  /** 当 source 为 plugin 时提供该技能所属插件名，用于 UI 标注来源与跳转插件页。 */
  pluginName: z.string().optional()
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

/** 注入模型上下文的轻量技能 discovery 项。正文仍通过 Skill 工具按需加载。 */
export const modelVisibleSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  whenToUse: z.string().optional()
});
export type ModelVisibleSkill = z.infer<typeof modelVisibleSkillSchema>;

/** 技能详情：在概要基础上带上 SKILL.md 的正文（去掉 frontmatter），供详情页渲染。 */
export const skillDetailSchema = skillSummarySchema.extend({
  /** SKILL.md 去掉 frontmatter 后的正文（Markdown）。 */
  content: z.string(),
  /** 技能 SKILL.md 在磁盘上的绝对路径，详情页展示文件位置。 */
  filePath: z.string()
});
export type SkillDetail = z.infer<typeof skillDetailSchema>;

/** 经 GitHub 链接导入自定义技能（仓库根或子目录下的 SKILL.md）。 */
export const skillImportInputSchema = z.object({
  url: z.string().min(1)
});
export type SkillImportInput = z.infer<typeof skillImportInputSchema>;

/** 手动创建自定义技能；name 同时作为安装目录名。 */
export const skillCreateInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "技能名只能包含小写字母、数字和连字符"),
  description: z.string().min(1).max(200),
  content: z.string().min(1)
});
export type SkillCreateInput = z.infer<typeof skillCreateInputSchema>;
