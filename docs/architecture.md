# 程小帮 架构设计文档

> 最后更新:2026-06-23(与当前事件、工具、任务和插件体系对齐)

程小帮是一个 macOS / Windows Electron 桌面 AI 助手(agentic coding companion):模型通过工具真实地读写本地文件、执行命令、生成 Office 文档,并可通过桌面端、飞书或微信绑定会话对话。

技术栈:pnpm + TypeScript monorepo,全仓 ESM;后端运行在 **Bun**;agent 循环与模型调用基于 **pi 框架**(`@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`);持久化用 sql.js(SQLite);前端 React + Vite + Tailwind + zustand;测试 Vitest。

---

## 1. 总览

三层架构,`@chengxiaobang/shared` 是前后端之间唯一的契约:

```
┌─────────────────────────── apps/desktop (Electron) ───────────────────────────┐
│  main 进程                     preload                renderer (React)         │
│  · 拉起/监督后端子进程          · window.chengxiaobang  · store/ (zustand 状态)  │
│  · 随机端口 + 随机 token        bridge(backend info、  · components/ (视图)     │
│  · backend-info IPC              文件选择器、读文件)    · lib/ (ApiClient、SSE)  │
└──────────────────────────────────┬─────────────────────────────────────────────┘
                                   │ HTTP + SSE(x-chengxiaobang-token 鉴权)
┌──────────────────────────────────▼─────────────────────────────────────────────┐
│                        apps/backend(无头本地 HTTP 服务,Bun)                   │
│                                                                                 │
│  api/(Hono 路由)→ AgentRunner ──→ pi runAgentLoopContinue(agent 循环本体)   │
│                        │                    │ AgentEvent                        │
│                        │            RunEventTranslator(pi-events.ts)           │
│                        │                    │ StreamEvent                       │
│                        └──── AsyncEventQueue ──→ /api/runs/stream 或 EventHub    │
│                                                                                 │
│  tools/(内置 + deferred + MCP) model/(config YAML + pi-ai) repository/(sql.js) │
│  agent/history.ts(无损历史) events/(AppEvent) secrets/(系统凭据)              │
│  feishu/(长连接机器人) wechat/(本机桥接) tasks/(定时任务) plugins/mcp/skills  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                   ▲
                packages/shared:实体 Zod schema、StreamEvent/AppEvent 契约、SSE codec
```

设计原则(见根目录 CLAUDE.md):

- **契约只声明一次**:所有实体与事件类型只存在于 shared,后端 `.parse()` 校验请求,渲染层导入同一份类型。
- **副作用在边缘**:IO/IPC/网络/模型调用收在模块边界,中间是可单测的纯逻辑。
- **不自研已被框架解决的东西**:agent 循环、OpenAI 兼容流解析、provider 兼容性差异、工具参数校验全部交给 pi。

---

## 2. 仓库布局

```
chengxiaobang/
├── packages/shared/          # 契约层(必须先 build,其 dist/ 类型被两端消费)
│   └── src/{stream,message,tool,run,model,session,project,provider,
│            access-mode,scheduled-task,plugin,skill,todo,usage-stats,
│            web-search,feishu,connect-phone,slash-command,terminal,utils}.ts
├── apps/backend/
│   └── src/
│       ├── main.ts           # CLI 入口与依赖装配(startBackend)
│       ├── server.ts         # Bun.serve(必须 Bun;idleTimeout 255s 保 SSE)
│       ├── paths.ts          # 数据目录、会话工作目录、内置资源定位
│       ├── api/              # Hono app + routes/(projects/sessions/runs/
│       │                     #   slash-commands/plugins/skills/tasks/
│       │                     #   terminal/settings/messages)
│       ├── agent/            # agent-runner / pi-events / history / compaction /
│       │                     #   system-prompt / approval-queue / smart-approval /
│       │                     #   project-approval-trust / async-queue
│       ├── tools/            # registry + fs/shell/web/memory/schedule/
│       │                     #   ocr/todo/skill 工具工厂、插件与技能服务
│       ├── mcp/              # 插件 MCP server 加载与工具桥接
│       ├── events/           # 全局 AppEvent EventHub
│       ├── tasks/            # 定时任务调度与 cron/run_at 解析
│       ├── model/            # provider-config-file、provider-service、pi-model
│       ├── repository/       # state-store 接口 + sqlite-state-store(sql.js)
│       ├── secrets/          # secret-store(Keychain / Credential Manager / 内存)
│       ├── feishu/           # feishu-service / feishu-bridge / config / text
│       ├── wechat/           # 微信配置、本机桥接与会话消费
│       ├── web-search/       # Tavily 配置与搜索执行器
│       └── usage/            # token 用量与人民币成本账本
└── apps/desktop/
    └── src/{main,preload,renderer}/
```

---

## 3. 契约层:packages/shared

### 3.1 StreamEvent / AppEvent(SSE 事件契约)

agent 循环对外的运行事件是 `StreamEvent`;应用级全局 SSE 还会广播定时任务事件,合并类型是 `AppEvent`。`packages/shared/src/stream.ts`:

```ts
type StreamEvent =
  | { type: "setup_error"; error }
  | { type: "run_started"; runId; sessionId; clientRequestId?; providerId?; model?; reasoningMode? }
  | { type: "delta"; runId; channel: "text" | "thinking"; delta }
  | { type: "plan_delta"; runId; contentIndex; toolCallId?; markdown; delta; updatedAt }
  | { type: "message"; runId; message: Message }
  | { type: "tool_activity"; runId; activity: ToolActivity }
  | { type: "tool_call"; runId; toolCall: ToolCall }
  | { type: "session_updated"; runId; session: Session }
  | { type: "run_end"; runId; status; usage?; error?; fileChanges? };

type AppEvent =
  | StreamEvent
  | { type: "scheduled_task_started"; taskId; sessionId; name; trigger; occurredAt }
  | { type: "scheduled_task_finished"; taskId; sessionId; name; trigger; status; runId?; error?; occurredAt };
```

- `setup_error`:run 尚未创建时的启动失败提示,不写入 run 历史。
- `run_started`:run 已落库并启动;全局 SSE 路径会携带客户端生成的 `clientRequestId` 方便前端归属过滤。
- `delta`:模型增量输出,text/thinking 双通道。
- `plan_delta`:计划模式中 `ExitPlanMode` 参数里的计划正文增量,用于计划卡直播。
- `message`:user 回显、assistant 中间叙述与最终回答(中止时含已流出的部分回答)。
- `tool_activity`:工具执行前的轻量活动预览,目前只允许 `Write/Edit` 暴露路径预览,不把 URL、搜索词、命令等敏感参数提前塞进时间线。
- `tool_call`:状态机由 `ToolCall.status` 携带——`pending_approval | pending_smart_approval | running | completed | failed | rejected`,每次迁移发一次事件,渲染层据此驱动审批、智能审批和工具历史。
- `session_updated`:run 中途的会话元数据变更(目前是 AI 生成的会话标题),渲染层据此即时更新侧边栏而无需整表刷新。
- `run_end`:唯一终态事件;completed 时可带 `usage`,有文件改动时可带 `fileChanges`。
- `scheduled_task_started/finished`:由 `TaskScheduler` 发布到全局 `EventHub`,用于桌面端刷新任务页、标记会话运行中和发通知。

SSE 编解码(`encodeSseEvent`/`parseSseChunk`)同在此文件,前后端共用。

### 3.2 核心实体(均为 Zod schema + 推导类型)

| 实体 | 要点 |
|---|---|
| `Message` | `role: user/assistant/tool/system`、`content`、`kind?: "compaction_summary"`、`reasoning?/reasoningMs?/durationMs?` |
| `ToolCall` | `name` 为自由字符串(模型可能请求未知工具,照常落库渲染为 failed)、`status` 包含普通审批与智能审批状态、`argsPreview` 只放允许提前展示的参数摘要、`startedAt` 只在真正开始执行时落(审批等待不计时) |
| `RunRequest` | `prompt`、`sessionId?`、`projectId?`、`clientRequestId?`、`providerId?`、`model?`、`reasoningMode?`、`accessMode: approval/full_access`、`planMode`、原生图片附件与展示附件 |
| `ProviderConfig` | 运行时 provider 快照:`kind`、`region/api/auth`、`baseURL`、`model`、`catalog`、`apiKeyRef`(密钥引用,非明文) |
| `TokenUsage` | `promptTokens/completionTokens/totalTokens/cachedPromptTokens?` |
| `ScheduledTask` | `kind: once/recurring`;周期任务用 5 字段 `cron`,一次性任务用 `runAt`,调度器统一看 `nextRunAt` |
| `ApprovalDecision` | `{ approved, answer?, editedSteps?, approvalScope? }`;`approvalScope: "project"` 表示把同项目内同签名工具调用记为可信 |

`toolNameSchema` 当前列出内置工具名,但 `ToolCall.name` 仍是普通 string:模型未知工具、插件 MCP 工具(`mcp__...`)都可以落库并由 `toolMetadata(name)` 给出兜底展示与审批策略。

---

## 4. 后端

### 4.1 服务器与 API 层

- `server.ts`:`Bun.serve`,**强制 Bun 运行时**(非 Bun 直接抛错);`idleTimeout: 255` 防止安静的 SSE 流(如审批等待)被 Bun 默认 10s 空闲超时杀掉。
- `api/app.ts`:Hono。本机服务只放行可信来源:空 origin、`null`、`file://`、`localhost`、`127.0.0.1`、`::1`;token 中间件(`x-chengxiaobang-token`,`/api/health` 豁免)、统一 404/500 JSON。
- 路由一览:

| 路由 | 职责 |
|---|---|
| `GET /api/health` | 健康检查(无鉴权,desktop 启动探活) |
| `POST /api/runs` | 默认桌面入口:发起 run,首个 `run_started` 后返回 `RunStartResponse`,后续事件走全局 `/api/events` |
| `GET /api/events` | 应用级全局 SSE,广播 `AppEvent`;15s 注释心跳保活,不做历史 replay |
| `POST /api/runs/stream` | 旧流式入口:请求独占 SSE 返回 `StreamEvent`;仍用于回退路径、测试和部分进程内消费 |
| `GET /api/runs/active` | 返回活跃 run 快照,供前端重连后按 DB 恢复 pending/running 工具 |
| `POST /api/runs/:runId/abort` | 中止 run |
| `POST /api/runs/:runId/steering` | 向运行中 run 注入用户引导 |
| `POST /api/approvals/:toolCallId` | 审批/ask-user/计划确认决定,支持 `approvalScope: "project"` |
| `/api/projects*` | 项目 CRUD、Git 改动摘要/详情、`/files` 与 `/files/tree` 文件树 |
| `/api/sessions*` | 会话 CRUD、搜索、messages、已读、反馈、上下文用量、runs+toolCalls、debug-context、rewind、fork、side-chats |
| `/api/messages*` | 消息级右侧小聊天读取与发送 |
| `/api/slash-commands*` | 内置 + pi 模板/技能命令列表,以及命令禁用设置 |
| `/api/plugins*` | 插件列表、安装、启停、配置与删除 |
| `/api/skills*` | 内置/市场/自定义技能列表、详情、启停、导入、创建与删除 |
| `/api/tasks*` | 定时任务列表、更新、删除、立即运行 |
| `/api/terminal/exec` | 终端面板在项目目录执行命令 |
| `/api/settings/*` | provider 配置/模型选项、飞书与微信状态、手机连接安装、网页搜索配置与测试、用量统计 |

会话 messages 接口序列化时**剥离 `payload` 列**(模型上下文内部数据,不暴露给客户端)。

### 4.2 Agent 运行核心(本项目的心脏)

`POST /api/runs` 或 `POST /api/runs/stream` → `AgentRunner.stream(input): AsyncGenerator<StreamEvent>`:

1. **从 `~/.chengxiaobang/config.yaml` 解析 provider,再用 SecretStore 解析 API key**,无可用模型直接抛错(路由层转成 `run_end(failed)` 的 SSE)。
2. **解析/创建会话**,确定工作目录:项目会话用项目路径,独立会话用 `~/.chengxiaobang/<sessionId>`。
3. **斜杠命令展开**(`SlashCommandService`,基于 pi-agent-core 的 prompt 模板/技能加载,项目级 `.chengxiaobang/prompts|skills` 覆盖全局)。
4. `/compact` 是元命令,走独立的压缩流程(见 4.6),不落 user 消息。
5. 落库 run + user 消息,发 `run_started` + `message`。桌面默认路径会把这些事件发布到 `EventHub`;旧 `/runs/stream` 路径直接写入当前 SSE 响应。
6. **pi 循环**:`runPiLoop` 用 `agent/history.ts` 从持久化行重建 pi 对话,调 pi 的 `runAgentLoopContinue(context, config, emit, signal, streamFn)`。文件、shell、Git 等能力只作为模型可调用的内部工具存在,不再暴露 `/ls`、`/read`、`/shell` 等用户斜杠快捷命令。

关键配置:

```ts
{
  model: buildModel(provider),        // pi-ai Model
  apiKey,
  convertToLlm: identity,             // 历史已是真正的 pi 消息(见 4.4)
  toolExecution: "sequential",        // 渲染层一次只支持一个 pendingTool
  beforeToolCall: translator.beforeToolCall,      // 审批门控
  shouldStopAfterTurn: translator.shouldStopAfterTurn  // 中止 + 模型级工具调用上限
}
```

**事件翻译层 `agent/pi-events.ts`(`RunEventTranslator`)**:实现 pi 的 `AgentEventSink`,把 pi `AgentEvent` 翻译成 StreamEvent 推入 `AsyncEventQueue`(push 生产 / pull 消费的桥),并**独占全部 run 级持久化**(assistant/tool 消息含 payload、ToolCall 实体、run 终态)。核心映射:

| pi 事件 | 翻译 |
|---|---|
| `message_update` text/thinking delta | `delta`(thinking 首增量起算 reasoningMs) |
| `message_end`(assistant) | 落库(content/reasoning/计时/payload);文本非空才发 `message`;stopReason=error 记错误标志;aborted 落部分文本并记中止标志 |
| `message_end`(toolResult) | 落 tool 行(含 payload),不发事件(UI 用 ToolCall 实体渲染) |
| `tool_execution_start` | 建 ToolCall 实体:普通审批→`pending_approval`(无 startedAt);智能审批待判定→`pending_smart_approval`;可直接执行→`running`+startedAt;发 `tool_call` |
| `beforeToolCall` 钩子 | 检查项目级信任、智能审批与普通审批;需要用户确认时等 `ApprovalQueue.wait()`;通过→可记录项目级信任并置 `running`;拒绝→实体 `rejected` + 返回 `{block:true, reason}`,pi 把 reason 作为错误工具结果喂回模型(**run 继续,不中断**) |
| `tool_execution_end` | 实体置 completed/failed(已 rejected 的跳过,不覆盖) |
| `agent_end` | **唯一终态决策点**:中止→aborted;错误→failed;模型级工具调用上限→failed(中文报错);否则 completed+usage |

pi 对模型错误/中止**从不抛异常**(以 `stopReason` 表达),所以 `agent_end` 必达;循环 Promise 真正 reject 只可能是基础设施故障(落库失败等),runner 兜底将 run 关为 failed/aborted,绝不留 "running" 僵尸。

### 4.3 审批、智能审批与中止语义

- **普通审批**:`ApprovalQueue`——`wait(toolCallId, signal)` 挂起直到 `decide()`;支持"先决定后等待"(早到的决定缓存);signal 中止时 resolve(false)。客户端通过 `POST /api/approvals/:toolCallId` 决定。
- **项目级信任**:桌面审批可提交 `{ approved: true, approvalScope: "project" }`;后端按 `projectId + toolName + args` 签名写入设置,同项目内相同签名的后续工具调用自动放行。
- **智能审批**:`smart-approval.ts` 会在 approval 模式下对部分工具给出 allow/deny/ask_user 判定;需要用户介入时实体处于 `pending_smart_approval`,时间线显示执行态但底部普通审批 dock 不展示它。
- **手机/无人值守兜底**:飞书只读模式、微信绑定会话与定时任务 headless run 遇到待审批工具时自动拒绝,避免无人回答导致 run 永久挂起。
- **中止**:`AgentRunner` 持有 `Map<runId, AbortController>`,signal 贯穿 pi 循环与工具执行:
  - 模型流中途:部分回答照常落库并以 `message` 发出(平静收尾),再 `run_end(aborted)`;
  - 审批等待中:wait→false→工具 rejected,`shouldStopAfterTurn` 见 signal.aborted 阻止再次调模型;
  - 工具执行中:signal 透传给 `AgentTool.execute`,顺序执行器在当前工具后停止。

### 4.4 消息持久化与无损历史(payload 方案)

messages 表有一个 **backend-only 的 `payload` 列**,存 pi 原始消息 JSON(`AssistantMessage` / `ToolResultMessage`):

- **写**:翻译层落 assistant/tool 行时同时写 payload;UI 字段(content=拼接文本、reasoning=拼接 thinking、计时)照常冗余存储供渲染。
- **读**(`agent/history.ts` `buildAgentMessages`):有 payload 的行直接反序列化为 pi 消息——assistant 的 toolCall 块与 toolResult 消息**无损配对回放**,模型在后续 run 中看到完整的工具调用历史;无 payload 的行(旧数据或异常路径留下的孤儿工具结果)回退为纯文本消息(tool 行折叠为 `【工具结果】` user 上下文,因为孤儿 toolResult 会被 provider 拒收)。
- **修复**:中止可能留下"有 toolCall 无 toolResult"的悬空 assistant 行,重建时合成 `(运行中止,无结果)` 的错误 toolResult;反向孤儿(toolResult 无配对 toolCall)直接丢弃。
- 压缩指针(`compactedUpToMessageId`)之前的行被最新摘要替代,摘要以 `【此前对话的摘要】` user 消息前置。
- `forkSession` 克隆 payload;sessions API 序列化时剥离。

### 4.5 工具系统

内置工具全部是 pi `AgentTool`(TypeBox 参数 schema + `execute` 函数,**失败用 throw**,pi 自动转为错误工具结果喂回模型):

| 文件 | 工具 | 审批 |
|---|---|---|
| `fs-tools.ts` | Read、Glob、Grep | 否 |
| | Write、Edit | **是** |
| `shell-tools.ts` | Shell(action=run/status/cancel) | run 按命令风险;status/cancel 否 |
| `web-tools.ts` | WebFetch(模型辅助网页抽取)、WebSearch(Tavily 搜索)、ToolSearch(加载 deferred/MCP 工具) | 否 |
| `memory-tools.ts` | Memory(`/memories` 下 view/create/str_replace/insert/delete/rename) | 否(只限专用目录) |
| `plan-tools.ts` | ExitPlanMode、AskUserQuestion、Skill | 否 |
| `schedule-tools.ts` | Schedule(action=create/list/cancel) | create/cancel 是;list 否 |
| `todo-tools.ts` | TodoRead、TodoWrite | 否(运行内计划进度) |
| `ocr-tools.ts` | OcrExtractText | 否,deferred 且仅模型/附件条件满足时可见 |

- `packages/shared/src/tool.ts` 的 `toolMetadata(name)` 是展示、审批、deferred、计划草稿可见性和分类的统一事实源;未知工具与 `mcp__...` 工具走保守兜底策略。
- `registry.ts`:`createAgentTools(workspacePath, options)` 汇集文件、Shell、Web、Memory、OCR、MCP 等基础工具;`AgentRunner` 再按 run 追加计划、技能加载、Todo、定时任务等工具。`requiresApproval(name)` / `isMutatingTool(name)` 由 `toolMetadata` 与 MCP 规则共同决定。
- `selectAgentTools()` 会按计划阶段、飞书/headless 通道、OCR 条件、deferred 工具启用集合裁剪模型可见工具。计划草稿阶段只开放 read-only 与 `planDraftVisible` 工具;正式执行阶段隐藏 `ExitPlanMode`;飞书/headless 隐藏会阻塞的提问/计划工具。
- `workspace.ts`:`safeResolve` 强制路径不逃逸工作目录;Glob/Grep 的路径边界与忽略规则(忽略 node_modules/.git/dist 等);`listProjectFiles` 供 @-mention 自动补全。`Grep` 依赖 ripgrep,桌面打包时随平台 `rg/rg.exe` 打入并通过 `CHENGXIAOBANG_RG_PATH` 传给后端。
- Shell 命令通过 `Shell action=run` 的 `timeout` / `run_in_background` 选择等待策略：默认前台等待 15 秒后转后台，`run_in_background=true` 立即转后台，`timeout` 最多等待 600000ms 后转后台；输出持续写入 `dataDir` 下的全局运行产物文件,再由 `Shell action=status` 查询状态、`Shell action=cancel` 主动终止;详见 [Shell 执行与后台命令](./shell-background-execution.md)。
- 参数校验由 pi 在执行前按 TypeBox schema 完成,非法参数直接变成错误工具结果(不经 beforeToolCall)。

### 4.5.1 插件、MCP 与技能市场

- 插件由 `PluginService` 管理安装、启停和配置;已启用插件可声明 MCP server,`McpManager` 懒加载后通过 `mcp-tool-bridge.ts` 转成 `mcp__...` pi 工具。
- MCP 工具默认按 mutating/deferred/requiresApproval 处理,避免外部服务能力自报不完整时越权执行。
- 技能市场由 `SkillMarketService` 管理启用状态、禁用命令和技能使用记录;内置技能、市场技能、插件技能与用户自定义技能共同进入 `SlashCommandService`。
- 技能创建、导入和安装走技能页/API;模型只通过 `Skill` 加载已存在技能。自定义技能落在用户数据目录并立即被后续命令/技能发现。

### 4.6 模型层与压缩

- 静态模型/供应商目录以 `packages/shared/provider-catalog.yaml` 为人工维护源,生成 `provider-catalog.generated.ts`;模型 label、输入模态、上下文窗口、价格、工具调用上限、provider 默认值、用量人民币展示汇率与 fallback 正则都来自这里。字段说明见 [供应商与模型静态配置 YAML](./provider-catalog-yaml.md)。
- 后端启动时用 `model/provider-config-file.ts` 管理 `~/.chengxiaobang/config.yaml`。文件不存在时由 generated catalog 初始化；存在时直接作为本机 provider 真值源。设置页只写 Base URL 和 API Key 等连接字段,模型能力和最大工具调用轮数仍来自 YAML。
- `model/pi-model.ts`:`buildModel(provider)` 把 `ProviderConfig` 映射为 pi-ai `Model<Api>`。`api` 来自 YAML,当前支持 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`;协议 payload hook、DeepSeek/Qwen/豆包/Kimi/MiniMax 等兼容逻辑仍留在 TS 中。内置 kind 的 pi slug 来自 YAML 的 `piProviderSlug`,未配置则原样传递 kind。
- `reasoning: false` 表示不发 thinking 请求参数,但 provider 自己返回的 reasoning 增量照常透出。默认推理模式由 YAML 的 `defaultReasoningMode` 决定,前端不提供手动推理档位控件。
- usage 语义:pi 的 `input` 已扣除缓存命中,`toTokenUsage` 还原为"全量 prompt + cachedPromptTokens"以保持 UI 口径。
- `testProvider`:廉价的 `GET {baseURL}/models` 探活(pi 无免费探针)。
- **压缩 `/compact`**(`agent/compaction.ts`):可见历史保留最近 4 条,其余 + 既有摘要折叠进一次 pi-ai `streamSimple` 总结调用;摘要文本以 `delta(thinking)` 实时流出(渲染进思考面板),完成后落 `kind: "compaction_summary"` 行并推进会话指针。短会话不调模型直接答复"无需压缩"。

### 4.7 持久化与密钥

- `repository/sqlite-state-store.ts`(sql.js,整库内存 + 每次写后 flush 到文件):projects / sessions / messages / runs / usage_cost_entries / tool_calls / settings / scheduled_tasks 等运行状态。会话和 run 中的 `provider_id/provider_kind/model` 是当次快照字段,不再把 provider 配置作为 SQLite 运行时真值源。
- provider 连接配置由 `~/.chengxiaobang/config.yaml` 管理；密钥仍只保存 `apiKeyRef` 引用,不落明文。
- 一切经 `StateStore` 接口,测试与实现解耦。
- `secrets/secret-store.ts`:darwin 用 macOS Keychain(`security` CLI),win32 用 Windows Credential Manager,其他平台内存实现;库里只存 `apiKeyRef` 引用,永不落明文。

### 4.8 手机通道:飞书与微信

`feishu/feishu-service.ts`:长连接机器人(lark SDK,`feishu-bridge.ts` 封装)。入站文本消息 → 绑定到 per-chat 会话(`feishuChatId`)→ 无头消费 `runner.stream()`:

- 默认**只读**:`tool_call` 且 `status === "pending_approval"` 时自动 `approvals.decide(id, false)`,模型收到拒绝说明后以纯文本方式继续(配置 `fullAccess` 可放开);
- 收集 assistant `message` 文本拼成单条回复(超长按飞书限制分片);`run_end` 的 failed/aborted 转为中文提示。
- 群聊只在 @机器人 时响应;同一 chat 串行(busy 提示)。

`wechat/wechat-service.ts`:通过本机桥接运行微信绑定会话,配置与状态走 `/api/settings/wechat*`。语义与飞书类似:外部消息绑定到专用会话、串行消费 runner 输出、结果回发到手机通道。定时任务创建工具会拒绝飞书/微信绑定会话,因为后台执行结果只写入桌面会话,不会主动回发手机群聊。

---

## 5. 桌面端:apps/desktop

- **main 进程**(`main/backend-process.ts`):随机端口(30000–50000)+ 随机 token 拉起后端子进程——dev 用 `node_modules/.bin/bun --watch src/main.ts`(后端改动自动重启),打包后用捆绑的 Bun binary 跑 `resources/backend/main.js`;同时把随包携带的 `rg/rg.exe` 路径注入 `CHENGXIAOBANG_RG_PATH`;轮询 `/api/health` 就绪后经 `backend-info` IPC 把 `{baseURL, token}` 交给渲染层。每次启动 = 全新端口的全新后端。
- **preload**:沙箱渲染层只拿到最小 `window.chengxiaobang` bridge(backend info、原生文件/目录选择器、读文件)。
- **渲染层**:
  - `lib/api.ts`:类型化 `ApiClient`(从 shared 导入全部类型)。桌面默认用 `startRun(POST /api/runs)` 启动,再用 `subscribeAppEvents(GET /api/events)` 接收全局 `AppEvent`;保留 `streamRun(POST /api/runs/stream)` 作为测试/旧客户端回退。
  - `store/`(zustand):`handleAppEvent` 先拆分 `StreamEvent` 与定时任务事件。运行事件由 `handleRunEvent` 处理——`delta` 本地合帧后累积 `streamText`/`thinking`;`tool_activity` 更新允许展示的路径预览;`message` 追加消息并清空流式缓冲;`tool_call` 按 `pending_approval/pending_smart_approval/running/completed/failed/rejected` 维护 `pendingTool`、`runningTool` 与 `toolHistory`;`run_end` 收尾并刷新 usage/runMeta。定时任务事件会标记会话运行中、刷新任务列表并发应用内/系统通知。
  - `recoverActiveRunSnapshot()`：全局 SSE 重连后按当前 `activeRunId` 从 DB 拉 messages/runs/toolCalls,只恢复当前 run 的 pending/running 工具,不把历史残留 running 行误判成活跃运行。
  - `components/`:ChatView(时间线 + 流式 Markdown)、ApprovalDock(底部审批/ask-user/计划确认)、ToolCallRow(按 status 渲染)、ReasoningPanel(DeepSeek 风格思考面板,250ms 计时)、Composer 等;`lib/timeline.ts` 把消息与 ToolCall 按时间合并(tool 行与空 content 的 assistant 行不渲染气泡);
  - i18n:react-i18next,zh/en,默认必须是 zh(有测试钉住)。

---

## 6. 一次 run 的完整时序(桌面默认路径,approval 模式 + 一次工具调用)

```
renderer                    EventHub / API              backend AgentRunner / pi              SQLite
   │ GET /api/events           │
   │──────────────────────────▶ subscribe()
   │ POST /api/runs            │
   │───────────────────────────────────────────────▶ 建 run、落 user 消息 ─────────────▶ runs, messages
   │ ◀ RunStartResponse        │ ◀ publish(run_started/message)
   │ ◀ SSE run_started,message │
   │ ◀ SSE delta(thinking/text)│                          pi 流式模型输出
   │ ◀ SSE message(assistant)  │                          message_end:落中间叙述+payload ─▶ messages
   │ ◀ SSE tool_call(pending)  │                          tool_execution_start:建实体 ─────▶ tool_calls
   │                           │                          beforeToolCall 挂起等审批…
   │ POST /approvals/:id ───────────────────────────────▶ ApprovalQueue.decide(true)
   │ ◀ SSE tool_call(running)  │                          实体置 running+startedAt ───────▶ tool_calls
   │                           │                          AgentTool.execute(…)
   │ ◀ SSE tool_call(completed)│                          tool_execution_end ─────────────▶ tool_calls
   │                           │                          toolResult 落库(含 payload)────▶ messages
   │ ◀ SSE delta(text)         │                          下一轮模型输出(看得到工具结果)
   │ ◀ SSE message(assistant)  │                          最终回答落库 ───────────────────▶ messages
   │ ◀ SSE run_end(completed)  │                          agent_end → run 置 completed ───▶ runs
```

防呆边界:工具调用上限按模型配置解析,默认 500 轮(超出 → `run_end(failed)` 中文报错);全局 SSE 与旧 `/api/runs/stream` 都有 15s 心跳 + Bun idleTimeout 255s 保审批长等待;`agent_end` 兜底保证 run 永有终态。

---

## 7. 测试策略

- **模型测试缝是注入 pi `StreamFn`**(`AgentRunner` 的 `streamFn` option),不 mock 循环本身:`test/helpers/scripted-stream.ts` 的 `scriptedStreamFn(turns)` 回放脚本化轮次(thinking/text/toolCalls/usage/error/abort),并记录每次 `(model, context, options)` 调用——"模型这一轮看到了什么"是核心断言点(如:拒绝后下一轮 context 必须含 `用户拒绝` 的错误 toolResult;压缩后下一轮必须含摘要而非旧消息)。
- 关键行为钉死在:黄金事件序列(全事件顺序)、审批通过/拒绝、流中/审批中中止、模型级工具调用上限、payload 无损回放与孤儿修复、DeepSeek wire 测试(stub fetch 喂真实 SSE 字节,走真实 pi-ai 解析)、SSE 端到端(经 `createApp` + `parseSseChunk`)。
- 渲染层:`@testing-library/react` + jsdom + mock `ApiClient`;shared:SSE 往返与公共 API 导出。
- 运行:`pnpm test`(全部)/ `pnpm test <file>` / `pnpm test -t "<name>"`。

---

## 8. 构建、打包与运行时

- **构建顺序**:shared → backend → desktop(`pnpm build`);shared 必须先 build,其 `dist/` 类型被两端 typecheck 消费(`pnpm typecheck` 已编排)。
- **后端打包**(`apps/backend/tsup.config.ts`):单文件 `dist/main.js`;`noExternal` 强制打入 `sql.js`、`@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`pptxgenjs`、`docx`、`exceljs`、lark SDK、`hono`;banner 重建 `require`/`__dirname`/`__filename`(打入的 CJS 依赖需要)。`ws` 的可选原生 peer(`bufferutil`/`utf-8-validate`)标记 external。
- **运行时是 Bun,不是 Node**:打入的依赖含动态 require,纯 `node dist/main.js` 会崩;`server.ts` 也只接受 `Bun.serve`。dev 与生产统一由 desktop main 进程用 Bun 拉起;开发冒烟可用 `node_modules/.bin/bun dist/main.js`,打包冒烟用 `apps/desktop/scripts/smoke-packaged-backend.mjs` 从 `resources/bun(.exe)` 启动 `backend/main.js` 并轮询 `/api/health`。
- **打包桌面应用**:`pnpm package:mac` 产出 dmg + zip,`pnpm package:win` 产出 Windows x64 NSIS;后端 `dist/`、平台对应 Bun binary、平台对应 `rg/rg.exe`、OCR 模型和 `node-pty`/`sharp`/`onnxruntime-node`/`@napi-rs/canvas` 等 native 依赖一同打入。Windows 包在 Windows runner / Windows 本机构建,Windows v1 不启用自动更新入口。
- **开发**:`pnpm dev` 一条命令——Vite(渲染层 HMR)+ tsup --watch(main/preload)+ Electron(自动拉起 `bun --watch` 后端),三层全部热更新。
- 后端也可独立运行:`bun src/main.ts --port <n> --data-dir <dir> --token <t>`。

---

## 9. 历史决策记录

| 决策 | 理由 |
|---|---|
| 用 pi 低层 `runAgentLoopContinue` 而非有状态 `Agent` 类 | 会话存 SQLite 且被桌面端/飞书共享,还有 fork/rewind;每个请求从库重建上下文的无状态模式不需要内存态 Agent(及其缓存失效问题) |
| 用 `StreamEvent` 表达 run 生命周期、用 `AppEvent` 承载应用级通知 | run 事件仍贴近 pi 与持久化语义;定时任务这类非 run 生命周期事件不硬塞进 `StreamEvent`,而是在全局 SSE 层合并广播 |
| 桌面默认用 `POST /api/runs` + 全局 `/api/events`,保留 `/api/runs/stream` | 前者让 run 与单个 HTTP 请求解耦,刷新/断线后可通过 DB 快照恢复;后者保留简单流式消费路径,方便测试、回退和进程内消费者 |
| payload 列而非改 shared `Message` 结构 | 渲染契约零破坏;模型上下文保真与 UI 展示解耦;旧数据自动回退 |
| `toolExecution: "sequential"` | 渲染层一次只渲染一个审批卡片;避免并发 pending 工具的 UI 竞态 |
| 审批放在 pi `beforeToolCall` 钩子 | 钩子可阻塞等待、`{block:true}` 自动把拒绝喂回模型,与既有 ApprovalQueue 语义完全对齐 |
| 工具审批/展示统一走 `toolMetadata` | 同一份元数据同时服务审批、deferred、计划草稿可见性和 UI 聚合;未知工具与 MCP 工具按保守策略兜底 |
| `model.reasoning: false` | 不发 thinking 请求参数,与迁移前线上行为一致;DeepSeek 的 reasoning_content 增量 pi 无条件解析,思考面板不受影响 |
