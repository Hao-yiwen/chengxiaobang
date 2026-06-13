import { z } from "zod";

/** 技能分类：市场按「编程」「办公」组织；解析不出来时归 other。 */
export const skillCategorySchema = z.enum(["coding", "office", "other"]);
export type SkillCategory = z.infer<typeof skillCategorySchema>;

/**
 * 技能来源：builtin 随应用内置且始终激活；market 随应用分发、由用户按需激活；
 * custom 是用户经 GitHub 链接导入或手动创建、落在 ~/.chengxiaobang/skills 的技能。
 */
export const skillSourceSchema = z.enum(["builtin", "market", "custom"]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

/** 技能页的单行条目：市场目录与「我的技能」共用这一形状。 */
export const skillSummarySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  category: skillCategorySchema,
  source: skillSourceSchema,
  /** builtin 恒为 true；market 由激活状态决定；custom 安装即激活。 */
  enabled: z.boolean()
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

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
