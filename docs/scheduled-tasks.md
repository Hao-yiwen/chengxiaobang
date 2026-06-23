# 定时任务（Scheduled Tasks）设计与实现

> 最后更新：2026-06-23（补齐一次性任务、全局事件和手机通道限制）

用户在**桌面端普通会话**里用自然语言描述一次性或周期性需求（"明天早上 9 点提醒我"、"每天早上 9 点生成 AI 日报"），由**模型调用工具**创建定时任务；任务绑定创建它的那个会话，到点后在**原会话中追加一次无人值守（headless）执行**，结果作为普通对话内容保留在会话里。侧边栏第三个固定入口「定时任务」提供统一的管理页。

核心取舍（来自需求澄清）：

- **创建走模型工具而不是表单**——用户怎么说都行，模型负责把时间表达换算成 `kind=once + run_at` 或 `kind=recurring + cron`；UI 只做管理（启停/立即运行/删除），不做创建表单。
- **执行复用原会话上下文**——不为每次执行新建会话；模型执行任务时能看到当初创建任务的完整对话背景。
- **应用关闭期间错过的任务，下次启动补跑一次**（at-most-once，绝不连环追赶）。

---

## 1. 总览（闭环链路）

```
会话中自然语言 ──→ 模型调用 ScheduleCreate（审批卡确认 run_at/cron）──→ scheduled_tasks 落库
                                                                       │ nextRunAt
        TasksView（侧边栏「定时任务」页）                                │
        启停 / 立即运行 / 删除  ←── /api/tasks ──┐                      ▼
                                                │            TaskScheduler（60s tick）
                                                └─ POST /:id/run ──→ execute(task)
                                                                       │
                                              先推进 nextRunAt 落盘（at-most-once）
                                                                       │
                                        runner.stream({sessionId, prompt…}, {headless: true})
                                                                       │
                                  原会话追加 user + assistant 消息（重拉会话详情可见）
                                                                       │
                                          回写 lastRunAt / lastStatus / lastError
                                                                       │
                                     EventHub 发布 scheduled_task_started/finished
```

复用的两个既有模式：

- **headless run 消费**：照搬手机通道的做法——直接迭代消费 `AgentRunner.stream()`，对 `pending_approval` / `pending_smart_approval` 事件自动拒绝，从 `run_end` 取终态。
- **run 级上下文工具**：照搬 `tools/plan-tools.ts` 的做法——schedule 工具在 `agent-runner.ts` 的工具装配处与 plan 工具并列挂入，经闭包拿到当前 `sessionId` 与 `StateStore`。

---

## 2. 契约（packages/shared/src/scheduled-task.ts）

```ts
scheduledTaskStatusSchema = z.enum(["completed", "failed", "aborted"]);
scheduledTaskKindSchema = z.enum(["once", "recurring"]);

scheduledTaskSchema = {
  id, sessionId,            // 任务绑定创建它的会话（会话删除时级联删除任务）
  name, prompt,             // prompt = 每次执行喂给模型的提示词
  kind,                     // once = 一次性任务；recurring = 周期任务
  cron?,                    // 周期任务的 5 字段 cron（分 时 日 月 周），按本地时区解释
  runAt?,                   // 一次性任务的执行时间（UTC ISO）
  fullAccess: boolean,      // false（默认）= 只读执行，写操作被自动拒绝
  enabled: boolean,
  nextRunAt?, lastRunAt?,   // UTC ISO
  lastStatus?, lastError?,
  createdAt, updatedAt
};

scheduledTaskUpdateSchema = { name?, cron?, runAt?, prompt?, enabled?, fullAccess?, nextRunAt? };  // PATCH 用
```

周期任务的 cron 锁定 **5 字段**：解析库 croner 同时兼容 6 字段（秒），`tasks/schedule.ts` 的 `validateCron` 显式校验字段数，防止模型生成 6 字段后语义偏移。一次性任务必须传带时区的 `run_at`，后端归一化为 UTC ISO 存入 `runAt/run_at`。

## 3. 存储（repository/）

`sqlite-state-store.ts` 的任务表：

```sql
create table if not exists scheduled_tasks (
  id text primary key,
  session_id text not null,        -- fk → sessions, on delete cascade
  name text not null,
  prompt text not null,
  kind text not null default 'recurring',
  cron text,
  run_at text,
  full_access integer not null default 0,
  enabled integer not null default 1,
  next_run_at text, last_run_at text, last_status text, last_error text,
  created_at text not null, updated_at text not null
);
-- 索引：(enabled, next_run_at)、(session_id)
```

`kind/run_at` 由 `ensureColumn` 兼容旧库；旧任务默认视为 `recurring`。

`StateStore` 接口新增 `listScheduledTasks / getScheduledTask / createScheduledTask / updateScheduledTask / deleteScheduledTask`。两个刻意的语义：

- `updateScheduledTask` 对**不存在的行返回 undefined 而不抛错**——任务可能在执行途中被删除，调度器收尾写 `lastStatus` 时必须容忍。
- `deleteSession` 沿用既有的手动级联风格，显式 `delete from scheduled_tasks where session_id = ?`（FK cascade 之外的双保险）。

## 4. cron 解析（tasks/schedule.ts + croner）

- 依赖选型：**croner**（零依赖、原生 ESM、支持 Bun），弃 cron-parser（带 luxon、有 CJS/ESM 双发坑）。已加入 `tsup.config.ts` 的 `noExternal`——生产环境没有 node_modules，新依赖必须打进 bundle。
- 全仓只在 `tasks/schedule.ts` 接触 croner，对外只暴露两个纯函数：
  - `validateCron(cron): string | undefined` —— 返回错误信息（含 5 字段校验）；
  - `computeNextRunAt(cron, from: Date): string` —— 从 from 起算的下一次触发（UTC ISO）。
  - `validateRunAt(runAt)` / `normalizeRunAt(runAt)` —— 校验一次性任务必须是带时区绝对时间，并归一化为 UTC ISO。

## 5. 模型工具（tools/schedule-tools.ts）

`createScheduleTools({ store, sessionId, feishuChatId?, wechatChatId? })`，TypeBox 参数，在 `agent-runner.ts` 工具装配处按 run 挂入：

| 工具 | 审批 | 行为 |
|---|---|---|
| `ScheduleCreate(kind, name, prompt, cron?, run_at?, full_access?)` | **mutating**（审批门控） | `kind=recurring` 校验 5 字段 cron → 落库（算好 nextRunAt）→ 返回任务 id + **接下来 1-2 次触发时间**；`kind=once` 校验带时区 `run_at` → 创建一次性任务 |
| `ScheduleList()` | read-only | 列出全部任务（id、类型、cron/runAt、启停、下次/上次执行、是否本会话） |
| `ScheduleCancel(id)` | **mutating** | 删除任务 |

配套改动：

- `packages/shared/src/tool.ts`：通过 `toolMetadata` 声明 `ScheduleCreate/ScheduleCancel` 为 mutating 且需要审批、`ScheduleList` 为 read-only；审批模式下用户会在审批卡上看到 `run_at` 或 `cron` 参数再确认。
- `system-prompt.ts` 注入**当前本地时间 + 时区**（一行，所有 run 受益）——模型没有时间就无法把"明早 9 点"换算成 cron。
- **飞书/微信绑定会话拒绝创建**：调度执行的产出只写进会话、不会回发手机群聊，对手机用户是静默黑洞，工具直接报错提示去桌面端创建。
- 渲染层 `chat.toolLine` 已配好三个工具的友好文案（"创建定时任务「{{name}}」"等）。

## 6. headless 执行（agent-runner.ts 的改造）

`AgentRunner.stream(input, internal?: { headless?: boolean })` 新增**进程内第二参数**——刻意不进 shared 的 `runRequestSchema`，不暴露到 HTTP API 面。`headless: true` 时：

1. **隐藏 `AskUserQuestion` 工具**（`selectAgentTools` 新增 `headless` 标志）。这是硬要求而不是优化：`pi-events.ts` 中 `AskUserQuestion` **无条件**进入 `pending_approval` 等待，无人值守的 run 一旦调用它就永久挂起（飞书链路曾踩过同一坑，`full_access` 也救不了）。
2. **跳过 run 起始的 `updateSession` 覆写**——正常 run 会把 `providerId/accessMode` 写回会话；调度 run 不得污染原会话设置（否则 fullAccess 任务每跑一次就把会话翻成 full_access）。
3. 系统提示追加无人值守说明（"独立完成、不要等待用户确认"）。

另暴露 `activeSessionIds: Set<string>`（stream 进入 add / finally delete），供调度器避让同会话并发。

## 7. 调度器（tasks/task-scheduler.ts）

`TaskScheduler({ store, runner, intervalMs = 60s, runTimeoutMs = 30min, now? })`，`main.ts` 在服务启动时构造并 `start()`。

- **start()**：立即 tick 一次 + `setInterval`。首个 tick 即**补跑**：`nextRunAt` 是持久化的，重启后发现已过期就执行。
- **tick()**：取 `enabled && nextRunAt <= now` 的任务**逐个 await 串行执行**（mac 睡眠唤醒后多任务同时到期，不能并发打模型 + 并发 flush sql.js）；tick 自身有防重入标志。
- **execute(task)** 顺序严格如下：
  1. 任务在 busy set 中 → 跳过（防同任务重入）；绑定会话在 `runner.activeSessionIds` 中 → 跳过且**不推进 nextRunAt**（下个 tick 重试，相当于延后执行）。
  2. **先推进/清空再执行**：周期任务 `nextRunAt = computeNextRunAt(cron, now)`、一次性任务 `nextRunAt = null` 且 `enabled = false`，同时写 `lastRunAt = now` 落盘。以 **now 为基**推进——宕机错过 N 个周期也只补跑一次；落盘先于执行——`bun --watch` 重启不会重复补跑。
  3. 发布 `scheduled_task_started` 到全局 `EventHub`，桌面端据此标记会话运行中并刷新任务页。
  4. 消费 headless run：`providerId` 显式取**会话自己的 provider**（避免 run 级 fallback 取"第一个有 key 的 provider"换模型执行）；`accessMode = fullAccess ? "full_access" : "approval"`；任何 `pending_approval` / `pending_smart_approval` 事件一律自动拒绝（非 fullAccess 的只读语义；fullAccess 下正常不出现，是防挂死兜底）。
  5. 看门狗：从执行开始计 30 分钟；拿到 `run_started` 后可显式 `runner.abort(runId)`，未拿到 runId 时也通过内部 abort signal 释放前置卡住的执行。
  6. 写 `lastStatus / lastError`（行已删则 no-op），发布 `scheduled_task_finished` 到全局 `EventHub`。
- **runNow(taskId)**：「立即运行」按钮的入口，跳过到期检查直接 execute。
- **stop()**：clearInterval + abort 在飞行的 run。`main.ts` 的关停顺序为 **scheduler → MCP → 微信 → 飞书 → server → store**，防止调度 run 向已关闭的 store 写入。

## 8. API（api/routes/tasks.ts）

`AppContext` 新增**可选** `taskScheduler?`（类比 feishuService，不破坏既有 createApp 测试调用点）。

| 端点 | 说明 |
|---|---|
| `GET /api/tasks` | 全部任务 |
| `PATCH /api/tasks/:id` | `scheduledTaskUpdateSchema`；cron/runAt 非法 → 400；时间字段变更或 enabled false→true 时重算/恢复 nextRunAt（停用很久的任务一启用不应立刻"补跑"陈旧时间点） |
| `DELETE /api/tasks/:id` | 删除 |
| `POST /api/tasks/:id/run` | fire-and-forget 调 `scheduler.runNow`，返回 **202**（执行可能耗时数分钟，结果经任务行 lastStatus 反映）；未注入调度器时 503 |

## 9. 桌面端

- `store/`：`View` 增加 `"tasks"`（不持久化）；`tasks` state + `loadTasks / updateTask / deleteTask / runTaskNow` actions；`handleAppEvent` 处理 `scheduled_task_started/finished`，刷新任务列表、标记会话运行中并发通知；`ApiClient` 对应四个任务方法。
- `Sidebar.tsx`：「新对话」「搜索」之后的第三个固定入口「定时任务」（Clock 图标）→ `setView("tasks")`。
- `App.tsx`：`view === "tasks"` 时主区域渲染 `TasksView`（侧边栏保留）；`RightPanel / RightPanelSwitch` 显示条件收紧为仅 `"chat"`。
- `TasksView.tsx`：任务卡片列表——名称、prompt、类型、cron/runAt、下次/上次执行时间、上次状态（失败时行内展示 lastError）、启停 Switch、立即运行、删除；头部手动刷新；挂载时拉取。文案在 i18n `tasks.*`（zh/en）。

## 10. 测试

全部用既有测试缝（临时目录 `SqliteStateStore` + 注入 pi `StreamFn` 的 scripted stream，不 mock 循环本身）：

| 文件 | 覆盖 |
|---|---|
| `test/schedule.test.ts` | cron 纯函数：合法/非法/6 字段拒绝、下次触发计算；runAt 校验与 UTC 归一化 |
| `test/task-scheduler.test.ts` | 到期执行进原会话并推进/清空 nextRunAt；一次性任务执行后停用；无 provider 时记录 failed；只读自动拒绝 mutating 工具且 run 完成；headless 不覆写会话设置；disabled/未到期不执行；会话忙跳过且不推进；busy 防重入；runNow 未知任务报错 |
| `test/schedule-tools.test.ts` | create 绑定会话 + 触发预览；非法 cron/run_at 友好报错；飞书/微信会话拒绝；list/cancel 往返 |
| `test/agent-runner.test.ts`（增量） | headless 过滤 AskUserQuestion、交互 run 保留；schedule 工具对两种 run 均可见 |
| `test/api-app.test.ts`（增量） | 路由 CRUD、非法 cron 400、重新启用重算 nextRunAt、run-now 202/503 |
| `test/sqlite-state-store.test.ts`（增量) | 跨重启持久化、部分更新、null 清空 lastError、行缺失 no-op、删会话级联删任务 |
| `apps/desktop/test/tasks-view.test.tsx` | 侧边栏入口切换视图、列表渲染、开关/立即运行/删除走 ApiClient、空态文案 |

手动闭环验证：会话里说"每分钟报一次时间"（模型应建 `* * * * *`）→ 审批卡批准 → 任务页可见 → 1 分钟后重进会话看到追加回复、lastStatus=成功 → 「立即运行」即时触发 → 重启应用验证补跑一次。

## 11. 已知限制与后续项

- **打开中的会话只收到任务生命周期提示，不直播 headless run 内容**：全局 SSE 已推送 `scheduled_task_started/finished`，任务页和通知会实时刷新；但后台 run 的 user/assistant 消息仍是进程内消费，当前打开的聊天内容需要重拉会话详情后看到。
- **飞书/微信会话不支持创建任务**：后续可在调度器里对手机绑定会话执行完后经对应 sender 回发摘要，解除创建限制。
- **用户在调度 run 执行中向同会话发消息**不受互斥保护（反向已由 `activeSessionIds` 避让）；概率低、后果同既有并发行为，未做会话级锁（锁会被审批等待长期持有，队列语义复杂）。
- 崩溃残留的 `status="running"` runs 行暂未做启动清扫（通用卫生项，与本功能无直接耦合）。
