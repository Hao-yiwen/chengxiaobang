# 费用账本实现说明

## 目标

费用统计以“模型请求 attempt”为最小记账单位。session、设置页和统计图只查询账本，不再按 session 临时扫描 run 并重新估价。

## 核心口径

`usage_cost_entries` 是 Token usage 和费用统计的权威来源。新的统计、会话费用、设置页汇总、模型排行和排查明细都必须从账本查询，不再从 `runs.usage` 临时聚合或重新估价。

`runs.usage` 不参与费用统计，也不做历史回填。本应用当前还未上线，因此费用系统不背历史包袱：从这版开始，只有进入 `usage_cost_entries` 的 attempt 才会出现在费用统计里。

选择独立账本表而不是继续依赖 `runs.usage`，主要是因为一个 run 不一定等于一次模型请求：

- 自动压缩和 `/compact` 会产生额外模型请求。
- agent loop 中一次用户请求可能触发多次 LLM round。
- 失败或中止时上游可能没有 usage，但请求可能已经发出，需要按错误分类和输入 token 估算。
- 每次 attempt 都需要保存当时的 provider/model、HTTP status、错误分类、Token 来源和费用来源，避免后续 provider 配置变化影响历史统计。

## 数据表

`usage_cost_entries` 存储每一次模型请求 attempt 的费用明细，唯一键是 `(run_id, attempt_index)`。核心查询索引包括：

- `session_id, entry_created_at`：用于会话上下文费用。
- `entry_created_at`：用于设置页按天、周、月聚合。
- `provider_kind, model`：用于模型维度排行。
- `billable`：用于后续排查计费/非计费分布。

`runs` 表只保留运行历史、状态和调试快照，不提供费用统计查询入口。

## 写账流程

模型请求边界在 `AgentRunner` 的 `convertToLlm`：

1. 生成当前 run 内递增的 `attempt_index`。
2. 用 `TokenAccountingService` 统计即将发送的 `systemPrompt`、LLM messages、tools。
3. 写入 `pending` 账本行。
4. `onResponse` 捕获 HTTP status。
5. assistant `message_end` 收口：
   - 有 usage：按上游 usage 精确写入。
   - 无 usage 且失败/中止：进入错误分类，必要时按输入 token 估算。

`/compact` 和自动压缩也走同一套账本服务。普通 run 的自动压缩占用 attempt 0，后续主模型请求从 attempt 1 开始。

## Token 统计

`TokenAccountingService` 默认使用纯 JS `js-tiktoken`。如果 tokenizer 失败，会回退到字符估算，并在 `token_count_source` 中记录来源：

- `provider_usage`：上游返回 usage。
- `js_tiktoken`：本地 tokenizer 估算。
- `fallback_estimate`：字符估算。
- `none`：无 token 来源。

## 失败计费规则

有 usage 时永远按 usage 记账，哪怕 stop reason 是 error 或 aborted。

无 usage 时按 `usage-cost-errors.ts` 集中分类：

- `401/403/429/502/503/504`：明确不计费。
- 网络、DNS、TLS、连接失败：明确不计费。
- 请求未发出：不计费。
- 用户中止：attempt 已创建后按输入 token 估算。
- 上下文超限/token limit：按输入 token 估算。
- 已收到上游响应但未知错误：默认按输入 token 估算。

每次错误收口都会写中文日志，包含 runId、attemptIndex、statusCode、分类结果、估算 token 和费用。

## 查询入口

- `UsageCostLedgerService.getSessionCostCny(sessionId)`：会话上下文费用。
- `UsageCostLedgerService.buildUsageStats({ timezoneOffsetMinutes })`：设置页统计。
- `StateStore.listUsageCostEntries()`：排查明细。

`AgentRunner.buildSessionContextUsage()` 只负责上下文 token 和窗口状态，`sessionCostCny` 来自费用账本。
