# 运行中排队与引导实现文档

本文记录主聊天 Composer 在 run 运行期间继续接收用户输入的实现。这里的“排队”和“引导”是两条不同链路：

- **普通排队**：用户在当前 run 运行中继续输入并发送，消息先留在桌面端本地队列里。只有当前 run `completed` 后，才按顺序启动下一条 run。
- **运行中引导**：用户在队列面板里点击「引导」，消息会立即发给当前 active run。后端不会中止正在进行的模型请求或工具调用，而是在 pi agent 的下一次安全边界注入为新的用户消息。

`AskUserQuestion` 快捷回答优先级保持最高：如果当前 run 正在等待 `AskUserQuestion`，Composer 提交会继续作为 ask-user 回答，不进入普通队列。

## 目标与边界

目标：

- 运行中仍允许用户输入。
- 普通发送不启动并发 run，而是按会话排队。
- 队列只在当前 run `completed` 后自动消费下一条。
- 当前 run `failed` 或 `aborted` 后暂停队列，保留用户已经排队的消息。
- 引导消息可立即提交给当前 active run，并由后端在安全边界注入。
- 队列卡片支持引导、删除、更多菜单、关闭排队、暂停后继续运行。
- 编辑排队消息时撤回到 Composer 输入框，不使用弹窗。

边界：

- 普通队列是桌面端本地状态，不新增 SQLite 队列表。
- 引导队列是后端当前进程内的 run-scoped 状态，run 结束后清理。
- 引导不打断正在流式输出的 provider 请求，也不中止正在执行的工具。
- 无活跃 run 时，`POST /api/runs/:runId/steering` 返回 409，不静默丢弃。
- 队列项按“入队时”的 provider/model/accessMode/planMode/project 选择执行，不按消费时的 Composer 控件重新读取。推理档位由供应商与模型 YAML 配置决定，Composer 不提供手动覆盖入口。

## Shared 契约

相关文件：

- `packages/shared/src/run.ts`

`RunSteeringRequest` 是引导接口的请求体：

- `prompt`：实际注入模型上下文的文本，已经由桌面端把文本附件、图片附件等准备好。
- `displayContent?`：聊天时间线里用户气泡展示的原始文本；为空时后端回退到 `prompt`。
- `displayAttachments`：聊天时间线里展示的附件快照，不直接参与模型原生图片输入。
- `clientRequestId?`：桌面端生成的调试 ID，只用于日志和排查。
- `attachments`：桌面端按当前模型能力准备好的原生图片附件。

普通 run 仍走 `RunRequest`；引导只走 `RunSteeringRequest`。这样可以避免把引导误当成新 run，也避免把 provider/accessMode 等 run 级配置传进当前 active run。

## Backend 实现

相关文件：

- `apps/backend/src/api/routes/runs.ts`
- `apps/backend/src/agent/active-runs.ts`
- `apps/backend/src/agent/agent-runner.ts`

### ActiveRunRegistry

`ActiveRunRegistry` 维护两类进程内状态：

- `activeRuns: Map<runId, ActiveRunInfo>`
- `steeringQueues: Map<runId, RunSteeringRequest[]>`

`ActiveRunInfo` 记录当前 run 的 session/model 上下文：

- `sessionId`
- `providerId?`
- `model?`
- `reasoningMode?`：后端按 YAML/provider/session 解析出的实际推理档位，仅作为运行元信息回传。

run 启动后登记到 `activeRuns`；run 完成、失败或中止后调用 `forget()` 移除，同时删除该 run 的 steering queue，并在日志里记录丢弃的引导条数。

### POST /api/runs/:runId/steering

路由处理流程：

1. 解析 `runSteeringRequestSchema`。
2. 调用 `runner.enqueueSteering(runId, input)`。
3. 如果 run 不在当前进程的 `activeRuns` 中，返回 `409 { error: "当前运行已结束，无法注入引导" }`。
4. 接受成功后返回 `{ accepted: true }`。

这里故意只接受当前进程仍然活跃的 run。原因是引导要注入正在运行的 agent loop；如果 run 已结束或应用重启导致进程内状态消失，后端没有安全的注入目标，不能假装成功。

### getSteeringMessages 安全边界

`AgentRunner` 在调用 `runAgentLoopContinue()` 时传入 `getSteeringMessages`：

1. pi agent 到达安全边界时调用 `getSteeringMessages`。
2. `AgentRunner.drainSteeringMessages()` 从 `ActiveRunRegistry` drain 当前 run 的所有引导消息。
3. 对每条引导消息：
   - 用 `buildUserPiMessage(prompt, attachments)` 构造 pi `UserMessage`。
   - 先写入会话历史，role 为 `user`，content 为 `displayContent ?? prompt`。
   - 把原始 pi message 存到 backend-only `payload`，保证后续历史回放不丢原生图片等上下文。
   - 推送 `message` StreamEvent，让桌面端聊天时间线立即出现用户消息。
   - 返回 pi `UserMessage`，注入下一轮模型上下文。
4. 如果某条引导持久化失败，只跳过该条并记录错误，不影响同一批次其他引导。

同一安全边界 drain 到的多条引导会按入队顺序注入。

## Desktop Store 状态

相关文件：

- `apps/desktop/src/renderer/store/types.ts`
- `apps/desktop/src/renderer/store/initial-state.ts`
- `apps/desktop/src/renderer/store/persistence.ts`
- `apps/desktop/src/renderer/store/helpers/queues.ts`
- `apps/desktop/src/renderer/store/actions/run-actions.ts`

### QueuedRunItem

每条普通排队消息保存为 `QueuedRunItem`：

- `id`
- `sessionId`
- `projectId?`
- `content`
- `sourceAttachments`
- `displayAttachments`
- `providerId`
- `model?`
- `accessMode`
- `planMode`
- `createdAt`

`sourceAttachments` 用于之后重新准备模型输入；`displayAttachments` 用于用户气泡和队列 UI。队列只持久化附件描述和可见附件快照，不把图片 base64 长期写入 localStorage。

### 持久化范围

`appPersistOptions.partialize()` 会持久化：

- `queuedRunsBySession`
- `pausedRunQueuesBySession`

这保证刷新桌面端渲染层后，尚未消费的普通队列仍在。active run 本身仍由后端活跃快照和 run history 恢复；普通队列不依赖后端 SQLite。

## 普通排队流程

### submit()

`submit()` 的优先级如下：

1. 如果当前在等待 `AskUserQuestion`，Composer 内容作为 ask-user 回答提交。
2. 如果当前不是首页、存在运行中的 active run，且输入或附件非空，则创建 `QueuedRunItem`。
3. 否则按普通新 run 调用 `runPrompt()`。

运行中入队时会：

- 解析当前 provider/model。推理档位不从 Composer 读取，而是由后端根据本次选中的供应商与模型配置解析。
- 保存可见附件快照。
- 记录当前 accessMode、planMode、project。
- append 到 `queuedRunsBySession[sessionId]`。
- 取消该会话队列暂停状态。
- 清空当前 Composer 草稿。

### run_end 后自动消费

`handleRunEvent(run_end)` 清理当前运行态后，会刷新会话和 run history。只有当 `event.status === "completed"` 时，才调用 `startNextQueuedRun(sessionId)`。

`failed` 和 `aborted` 会调用 `pauseRunQueue()`：

- 队列项保留。
- `pausedRunQueuesBySession[sessionId] = true`。
- UI 显示暂停状态和「继续运行」入口。

### startNextQueuedRun()

自动消费下一条队列时：

1. 如果没有目标 session、当前仍有 run 在跑、或者队列处于暂停状态，直接跳过。
2. 取当前 session 队列第一条。
3. 检查该队列项入队时的 provider 是否仍可用；不可用则暂停队列并提示。
4. 根据队列项的 `displayAttachments` 重新准备模型输入。
5. 如果内容为空且没有原生附件，移除该条并递归尝试下一条。
6. 先从队列中移除该条。
7. 调用 `runPrompt(prompt, nativeAttachments, display, options)` 启动新 run。

`runPrompt()` 的 `options` 使用队列项入队时保存的配置：

- `sessionId`
- `projectId`
- `providerId`
- `model`
- `accessMode`
- `planMode`
- `preserveSelection`

## 运行中引导流程

### 前端发送引导

队列卡片点击「引导」后调用 `sendQueuedRunAsSteering(id)`：

1. 查找当前 `activeRunId` 和队列项。
2. 按队列项的 provider/model 重新准备 prompt 和原生附件。
3. 生成 `clientRequestId = createId("client_steer")`。
4. 调用 `apiClient.steerRun(activeRunId, request)`。
5. 成功后从普通队列移除该项。
6. 失败时保留队列项，并把错误写到 `notice`。

引导成功后不由前端立即伪造聊天消息，而是等待后端在安全边界持久化并推送 `message` 事件。这样聊天时间线只以真实后端持久化结果为准。

### 后端注入引导

后端接收引导后只入当前 run 的 steering queue。真正写入历史和注入模型发生在 `getSteeringMessages` 被 pi agent 调用时。

这个设计保证：

- 不中止当前 provider 请求。
- 不中止当前工具执行。
- 不破坏 pi agent 的 turn 边界。
- 多条引导按同一 run 内的入队顺序进入下一轮上下文。

## Composer UI

相关文件：

- `apps/desktop/src/renderer/components/Composer.tsx`
- `apps/desktop/src/renderer/components/composer/queued-run-stack.tsx`

运行中 Composer 保持可输入。按钮是互斥的：

- 有输入或附件时显示发送按钮，点击后普通入队或 ask-user 回答。
- 输入为空时显示停止按钮，用于 abort 当前 run。

队列面板显示在 Composer 上方，是一个紧凑的单面板：

- 每条队列项显示序号、内容预览和附件数量。
- 「引导」按钮只在当前有 active run 时显示。
- 删除按钮直接移除队列项。
- 三点菜单提供「编辑消息」和「关闭排队」。
- 暂停时第一条显示「继续运行」。

编辑排队消息不会弹窗。点击「编辑消息」后：

1. store 调用 `editQueuedRunInComposer(id)`。
2. 该队列项从队列中移除。
3. 原文和附件回填到 Composer 输入框。
4. provider/model/accessMode/planMode 回填到 Composer 控件；推理档位继续由 YAML/provider 默认值决定。
5. Composer 聚焦输入框，用户修改后再次发送即可重新入队。

## 清理与恢复

### 后端清理

run 完成、失败或中止时，`ActiveRunRegistry.forget(runId)` 会：

- 从 `activeRuns` 移除 run。
- 删除该 run 的 steering queue。
- 日志记录 `droppedSteeringCount`。

这避免已结束 run 继续接收引导。

### 前端清理

队列状态按 session 管理：

- 删除单条队列项：`dropQueuedRun()`。
- 关闭当前会话排队：`clearQueuedRuns(sessionId)`。
- 删除会话或项目时清理对应队列：`dropQueuedRunsForSessions()`。
- 加载会话列表后裁剪不存在 session 的队列：`pruneRunQueuesByLiveSessions()`。
- 队列最后一条被删除时，同时移除该 session 的暂停标记。

### 刷新后的语义

普通队列在 localStorage 中恢复。正在运行的 run 是否仍可恢复，依赖后端当前进程的 active run 快照和 run history。只有当前 active run 仍存在且处于 `running`，前端才恢复审批/运行状态；否则会清理陈旧运行态。

如果刷新后 active run 已经结束，普通队列仍然保留，但自动消费只会在新的 `run_end(completed)` 流程里触发。用户可以手动继续或重新发送。

## 日志与排查

关键日志前缀：

- `[store] 当前会话运行中，消息已加入排队`
- `[store] 启动下一条排队消息`
- `[store] 暂停会话排队运行`
- `[store] 恢复会话排队运行`
- `[store] 运行中引导已发送`
- `[store] 运行中引导发送失败，保留排队消息`
- `[store] 将排队消息撤回到输入框编辑`
- `[agent-runner] 已加入运行中引导队列`
- `[agent-runner] 开始注入运行中引导`
- `[agent-runner] 已注入运行中引导`
- `[agent-runner] 运行中引导持久化失败，已跳过该条`
- `[agent-runner] 移除活跃 run`
- `[run-routes] 收到运行中引导`

桌面端日志按 `logs/YYYY-MM-DD/HH-HH/` 分片；前端问题看对应时间段的 `renderer.log`，后端 agent 与 API 日志看同目录下的 `backend.log`。

## 测试覆盖

相关测试：

- `apps/backend/test/agent-runner.test.ts`
- `apps/backend/test/api-app.test.ts`
- `apps/desktop/test/composer.test.tsx`
- `apps/desktop/test/app-events.test.ts`

核心覆盖点：

- active run 接收 steering 后，在下一安全边界注入并持久化用户消息。
- inactive 或已结束 run 的 steering 返回 409，且不污染历史。
- 多条 steering 在同一安全边界按入队顺序注入。
- 运行中回车会入队，不启动第二个 `streamRun/startRun`。
- 当前 run `completed` 后自动启动队列第一条，后续队列继续等待。
- 当前 run `failed/aborted` 后暂停队列，不自动级联。
- 点击「引导」成功后从普通队列移除，失败时保留队列项并显示错误。
- 编辑排队消息时只从三点菜单进入，并撤回到 Composer 输入框。

建议定向验证命令：

```bash
pnpm test apps/backend/test/agent-runner.test.ts
pnpm test apps/backend/test/api-app.test.ts
pnpm test apps/desktop/test/composer.test.tsx
pnpm test apps/desktop/test/app-events.test.ts
```
