# 供应商与模型静态配置 YAML

`packages/shared/provider-catalog.yaml` 是供应商默认值、模型能力目录、live 模型 fallback 规则、运行默认值和汇率的唯一人工维护源。前后端不在运行时读取这份仓库 YAML，而是消费提交进仓库的 `packages/shared/src/provider-catalog.generated.ts`。

应用运行时还会在用户目录创建 `~/.chengxiaobang/config.yaml`。这份文件由仓库 catalog 初始化而来，是本机实际 provider 配置源：用户通常只需要在设置页或文件里填 `baseURL` 和 API Key；模型能力、上下文、价格、推理默认值、最大工具调用轮数仍由 YAML 条目维护。

## 配置边界

适合放进 YAML 的内容：

- 供应商 `kind`、显示名、默认名称、默认 Base URL、默认模型、API Key 链接。
- 供应商区域 `region`：`cn`、`global`、`gateway`、`custom`，用于设置页分组。
- 供应商协议 `api`：`openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`。
- 认证方式 `auth`：Bearer、`x-api-key`、Anthropic 版本头等稳定请求头规则。
- 是否作为内置默认 provider 写入 `defaultProviders()`。
- `piProviderSlug` 这类稳定的静态映射。
- 模型 label、输入模态、推理模式、上下文窗口、价格、默认工具调用上限。
- 对 live/未知模型生效的正则 fallback 规则。
- 全局运行默认值，例如未知 live 模型回退使用的 `runtimeDefaults.maxToolIterations` 与 `runtimeDefaults.autoCompactThresholdRatio`。
- 用量统计展示人民币时使用的 `currency.usdToCnyExchangeRate`。

不放进 YAML 的内容：

- DeepSeek、Kimi、MiniMax、Qwen、豆包等协议 payload 兼容逻辑。
- 模型请求实现、`/models` 拉取、错误分类和 provider 特殊 payload hook。
- 图片/OCR 分流、工具审批、agent 循环等运行时策略。

这些逻辑仍保留在 TypeScript 中，YAML 只表达静态能力与默认配置。

## 运行时配置文件

后端启动时会检查 `~/.chengxiaobang/config.yaml`。如果不存在，会把 generated catalog 写成默认运行配置；如果存在，则直接读取这份文件。

常见字段：

```yaml
runtimeDefaults:
  maxToolIterations: 500
currency:
  usdToCnyExchangeRate: 6.7625
providers:
  deepseek:
    kind: deepseek
    name: DeepSeek
    region: cn
    api: openai-completions
    auth:
      type: bearer
    baseURL: https://api.deepseek.com
    model: deepseek-v4-flash
    apiKeyRef: keychain-or-memory-ref
    enabledModels:
      - deepseek-v4-flash
    models:
      - id: deepseek-v4-flash
        label: DeepSeek V4 Flash
        reasoningModes: [off, high, xhigh]
        defaultReasoningMode: off
        inputModalities: [text]
        contextWindowTokens: 1000000
        autoCompactThresholdTokens: 800000
        maxToolIterations: 500
```

- `providers.<id>.baseURL` 和 `apiKeyRef` 是设置页主要会改的字段。
- `enabledModels` 是可选启用列表；缺省表示该 provider YAML 里的模型都可选。
- `models[].autoCompactThresholdTokens` 是显式自动压缩点；不填时按 `contextWindowTokens * autoCompactThresholdRatio` 推导。
- `models[].autoCompactThresholdRatio` 可按模型覆盖全局默认比例；当前全局默认在 `runtimeDefaults.autoCompactThresholdRatio` 中配置为 `0.8`。
- `models[].maxToolIterations` 是模型级工具调用上限。当前默认是 `500`，不支持 `0 = 无限`。
- `modelFallbacks` 会用于 live 模型列表中的未知模型，按顺序合并匹配字段。
- 内置 provider 在设置页删除时只会清空密钥引用，保留 YAML 条目，方便以后重新配置。

## 常用命令

修改 `provider-catalog.yaml` 后生成：

```bash
pnpm --filter @chengxiaobang/shared catalog:generate
```

检查 YAML 与 generated TS 是否一致：

```bash
pnpm --filter @chengxiaobang/shared catalog:check
```

`packages/shared` 的 build 会先运行 `catalog:check`。如果 YAML 改了但没有重新生成，构建会失败，并提示重新运行 generate。

## 新增模型

1. 在对应 provider 的 `models` 下新增精确模型项。
2. 至少填写 `id`、`label`、`reasoningModes`、`inputModalities`。
3. 必须填写 `maxToolIterations`；当前默认值是 `500`，单模型可按供应商能力单独调整。
4. 如已知上下文窗口、压缩点或价格，填写 `contextWindowTokens`、`autoCompactThresholdTokens` / `autoCompactThresholdRatio`、`pricing`。
5. 运行 `catalog:generate`，再跑 shared/backend/desktop 的相关测试。

## 新增供应商

1. 在 `providers` 下新增 provider id。
2. 填写 `label`、`name`、`region`、`api`、`auth`、`defaultBaseURL`、`defaultModel`。
3. 如果它是首屏内置选项，设置 `builtinDefault: true`；网关或自定义兼容项可以不设。
4. 如果 pi 需要稳定 slug，填写 `piProviderSlug`。
5. 添加至少一个模型或 fallback 规则。OpenAI 兼容供应商一般可先配置少量默认模型，再用 fallback 兜 live 模型。
6. 运行 `catalog:generate` 和 `catalog:check`，确认 generated TS 已更新。

## 新增 fallback 规则

`modelFallbacks` 用于 live 模型列表中出现的新模型。解析顺序从上到下，后命中的字段会覆盖前面命中的字段。

示例：

```yaml
modelFallbacks:
  - pattern: (qwen|qwq)
    reasoningModes: [off, auto]
  - pattern: ^qwen3\.5-plus\b
    inputModalities: [text, image, video]
    contextWindowTokens: 1000000
    autoCompactThresholdTokens: 800000
```

完全未知模型的默认行为仍然保守：文本输入、无推理模式、自动压缩比例读取 `runtimeDefaults.autoCompactThresholdRatio`，工具调用上限读取 `runtimeDefaults.maxToolIterations`。如果未知模型没有上下文窗口，也没有 fallback 显式配置 `autoCompactThresholdTokens`，就不会自动压缩。
