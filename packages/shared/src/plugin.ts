import { z } from "zod";

/**
 * 插件来源：builtin 随应用内置（落在打包资源的 plugins/ 下）；
 * installed 是用户经本地文件夹/zip 或 GitHub 链接安装、落在 ~/.chengxiaobang/plugins 的插件。
 */
export const pluginSourceSchema = z.enum(["builtin", "installed"]);
export type PluginSource = z.infer<typeof pluginSourceSchema>;

/** 插件作者：兼容字符串简写与结构化对象（对齐 Claude Code plugin.json）。 */
export const pluginAuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    email: z.string().optional(),
    url: z.string().optional()
  })
]);
export type PluginAuthor = z.infer<typeof pluginAuthorSchema>;

/**
 * plugin.json 里 userConfig 的单项定义（对齐常见插件 manifest 的 `key → 定义` 形状）。
 * 宽松解析：未知字段 passthrough，避免插件用了我们暂不识别的约束就整体解析失败。
 */
export const pluginUserConfigFieldSchema = z
  .object({
    type: z.enum(["string", "number", "boolean"]).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    description: z.string().optional()
  })
  .passthrough();
export type PluginUserConfigField = z.infer<typeof pluginUserConfigFieldSchema>;

/**
 * plugin.json manifest。宽松解析：未知字段 passthrough，坏字段交由服务层 safeParse 容错跳过，
 * 不因单个插件 manifest 不规范而拖垮整个插件发现。
 */
export const pluginManifestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "插件名只能包含小写字母、数字和连字符"),
    version: z.string().optional(),
    description: z.string().optional(),
    author: pluginAuthorSchema.optional(),
    license: z.string().optional(),
    homepage: z.string().optional(),
    repository: z.union([z.string(), z.object({ url: z.string() })]).optional(),
    keywords: z.array(z.string()).optional(),
    /** 可选显式声明；缺省时按约定目录（skills/、commands/）发现。可为目录名字符串或数组。 */
    skills: z.union([z.string(), z.array(z.string())]).optional(),
    commands: z.union([z.string(), z.array(z.string())]).optional(),
    hooks: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
    userConfig: z.record(z.string(), pluginUserConfigFieldSchema).optional()
  })
  .passthrough();
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** 插件提供的资源计数，用于插件卡片一眼看清「这插件给了什么」。 */
export const pluginContributionsSchema = z.object({
  skills: z.number().int().nonnegative(),
  commands: z.number().int().nonnegative(),
  mcpServers: z.number().int().nonnegative(),
  hooks: z.number().int().nonnegative()
});
export type PluginContributions = z.infer<typeof pluginContributionsSchema>;

/** 插件页的单行条目。 */
export const pluginSummarySchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string(),
  /** 归一化后的作者展示名（manifest.author 可能是对象）。 */
  author: z.string().optional(),
  source: pluginSourceSchema,
  enabled: z.boolean(),
  /** userConfig 非空时为 true，UI 据此显示「配置」入口。 */
  hasConfig: z.boolean(),
  contributions: pluginContributionsSchema
});
export type PluginSummary = z.infer<typeof pluginSummarySchema>;

/** 给前端配置表单的有序字段（由 manifest.userConfig 这个 record 展开并带上 key）。 */
export const pluginConfigFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional()
});
export type PluginConfigField = z.infer<typeof pluginConfigFieldSchema>;

/** userConfig 的运行时取值（settings KV `plugins.options` 持久化、喂给插件 MCP server env）。 */
export const pluginConfigValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const pluginConfigValuesSchema = z.record(z.string(), pluginConfigValueSchema);
export type PluginConfigValues = z.infer<typeof pluginConfigValuesSchema>;

/** 插件提供的技能清单项（详情页列出）。 */
export const pluginSkillRefSchema = z.object({
  name: z.string(),
  description: z.string()
});

/** 插件提供的斜杠入口清单项（详情页列出，含提示词命令与技能入口）。 */
export const pluginCommandRefKindSchema = z.enum(["prompt_template", "skill"]);
export type PluginCommandRefKind = z.infer<typeof pluginCommandRefKindSchema>;
export const pluginCommandRefSchema = z.object({
  name: z.string(),
  kind: pluginCommandRefKindSchema,
  description: z.string(),
  argumentHint: z.string().optional()
});
export type PluginCommandRef = z.infer<typeof pluginCommandRefSchema>;

/** 插件声明的 MCP server 清单项（详情页列出，运行状态由 /settings/mcp/servers 单独提供）。 */
export const pluginMcpServerRefSchema = z.object({
  name: z.string()
});

/** 插件详情：概要 + manifest 全量 + 资源清单 + 配置字段与当前值 + 安装路径。 */
export const pluginDetailSchema = pluginSummarySchema.extend({
  manifest: pluginManifestSchema,
  installPath: z.string(),
  configFields: z.array(pluginConfigFieldSchema),
  configValues: pluginConfigValuesSchema,
  skills: z.array(pluginSkillRefSchema),
  commands: z.array(pluginCommandRefSchema),
  mcpServers: z.array(pluginMcpServerRefSchema)
});
export type PluginDetail = z.infer<typeof pluginDetailSchema>;

/** 安装插件：本地目录/zip 的绝对路径，或 GitHub 链接，二选一。 */
export const pluginInstallInputSchema = z
  .object({
    path: z.string().optional(),
    url: z.string().optional()
  })
  .refine((value) => Boolean(value.path) || Boolean(value.url), "需提供本地路径或 GitHub 链接");
export type PluginInstallInput = z.infer<typeof pluginInstallInputSchema>;

/** 启停插件输入。 */
export const pluginToggleInputSchema = z.object({ enabled: z.boolean() });
export type PluginToggleInput = z.infer<typeof pluginToggleInputSchema>;

/** 更新插件 userConfig 取值输入。 */
export const pluginConfigUpdateInputSchema = z.object({ values: pluginConfigValuesSchema });
export type PluginConfigUpdateInput = z.infer<typeof pluginConfigUpdateInputSchema>;
