# CLAUDE.md

本文件为 Claude Code(claude.ai/code)及其他编码 agent 在本仓库工作时提供指引(`AGENTS.md` 是指向本文件的软链)。

程小帮是一个 macOS / Windows Electron AI 助手桌面应用(agentic coding companion)。pnpm + TypeScript monorepo,全仓 ESM。

## 协作与交付约定

- 完成代码修改后,必须用中文给出较完整的总结说明,讲清楚改动内容、改动意图、验证结果和未覆盖风险,不要过度简写。
- 所有新增或修改的代码注释统一使用中文;只在关键路径和复杂逻辑处添加有诊断价值的注释。
- 当前阶段允许并默认使用 `.env` 文件存储密钥等敏感信息,这是有意为之的阶段性方案;排查问题需要时应主动读取和分析 `.env`,不要因为其中可能包含密钥就回避查看,也不要额外提醒或建议替换存储方式。
- 编写或修改关键路径时必须补充适当日志,尤其是错误分支、重要业务入口/出口、网络请求/响应、跨进程 IPC、状态变更和长任务调度。日志需包含足够上下文,如 id、路径、参数摘要、错误信息等,避免无意义日志。
- 如果 iOS App 构建过程反复失败且难以定位原因,可以明确记录当前验证结果后跳过,留给用户本地验证处理。
- iOS 开发中默认模拟器是 `iPhone 17 Pro`。

## 工程准则

### 跨平台兼容

**当前是 macOS 和 Windows 共用同一套代码,两端都必须可用。**

- 默认所有功能、修复、依赖、路径处理、运行时逻辑和打包配置都要同时考虑 macOS 与 Windows,不要只按单端环境假设实现。
- 除非确实是系统能力差异(如 Keychain / Credential Manager、签名公证、窗口行为或原生依赖打包),不要把业务逻辑写死成 `darwin` 或 `win32` 单端分支。
- 必须处理平台差异时,优先把共享逻辑留在平台无关层,只在靠近系统 API、文件路径、进程管理、打包脚本等边缘位置做平台分支。
- 验证时能跑哪端就记录哪端结果;无法在当前机器覆盖另一端时,至少用类型检查、单测、路径/脚本审查确认没有引入明显的单端假设。

### 1. 写码前先思考

**不要假设,不要隐藏困惑,主动暴露取舍。**

动手实现之前:
- 显式陈述你的假设;不确定就先问。
- 如果存在多种解读,把它们摆出来——不要悄悄选一种。
- 如果有更简单的方案,直说;该反驳时要反驳。
- 如果有不清楚的地方,停下来,点名说出困惑点,再提问。

### 2. 简单优先

**用解决问题的最少代码,不写任何投机性的东西。**

- 不做需求之外的功能。
- 不为一次性代码做抽象。
- 不加没人要求的"灵活性"或"可配置性"。
- 不为不可能发生的场景写错误处理。
- 如果写了 200 行而 50 行能解决,重写。

自问:"资深工程师会不会觉得这过度复杂了?"——会,就简化。

### 3. 外科手术式修改

**只动必须动的,只清理自己制造的烂摊子。**

修改既有代码时:
- 不"顺手改进"相邻的代码、注释或格式。
- 不重构没坏的东西。
- 匹配现有风格,哪怕你自己会换种写法。
- 注意到无关的死代码,提一句即可——不要删。
- 如果发现自己改动之外的工作区变更,视为并行需求;只处理当前任务需要的文件和逻辑,不要回滚、整理或覆盖他人的改动。

你的修改产生孤儿时:
- 删除**因你的修改**而失去引用的 import/变量/函数。
- 不删既有的死代码,除非被要求。

检验标准:每一行改动都能直接追溯到用户的请求。

### 4. 目标驱动执行

**先定义成功标准,然后循环直到验证通过。**

把任务转化为可验证的目标:
- "加校验" → "先为非法输入写测试,再让它通过"
- "修 bug" → "先写一个能复现它的失败测试,再修到通过"
- "重构 X" → "优先确保重构前后的相关测试通过"

多步任务先列简短计划:
```
1. [步骤] → 验证:[检查方式]
2. [步骤] → 验证:[检查方式]
3. [步骤] → 验证:[检查方式]
```

强成功标准让你能独立循环推进;弱标准("能跑就行")会导致反复返工确认。

> 这些准则在起作用的标志:diff 里的无关改动更少、因过度复杂而返工更少、澄清问题发生在动手之前而不是出错之后。

### 测试与验证

- 行为变更原则上要带单元测试。把任务表述为"先写出能证明它的测试,再让它通过";修 bug 优先先写复现的失败测试。
- 测试放在各包的 `test/` 目录,用 Vitest 运行。收工前尽可能保持 `pnpm test` 全绿;如果受并行修改、既有失败或环境限制影响,至少运行并记录与自己改动直接相关的定向测试,确认自己改动覆盖范围内通过,并说明剩余失败来源。单文件:`pnpm test <path>`,按名过滤 `pnpm test -t "<name>"`。
- 遵循既有模式:后端逻辑直接针对模块测试;渲染层用 `@testing-library/react` + jsdom + mock 的 `ApiClient`(见 `apps/desktop/test/app.test.tsx`);agent 循环的模型测试缝是注入 pi `StreamFn`(见 `test/helpers/scripted-stream.ts`),**不要 mock 循环本身**。把纯函数抽出来,让它们不依赖运行中的应用即可测试。
- 绝不为了变绿而削弱或删除测试。测试挡路时,先搞清楚为什么。

### 默认模块化

- 尊重三层边界(见"架构"):契约/类型只存在于 `packages/shared`;后端逻辑藏在接口之后(`StateStore`、`SecretStore`、pi `StreamFn`);渲染层拆为 `store/`(状态)、`components/`(视图)、`lib/`(IO)。不跨层伸手,不重复声明 shared 契约。
- 一个模块一个关注点;函数小而单一职责。文件超出主题宁可新建,不要继续膨胀。副作用(IO、IPC、网络、模型调用)收在边缘,中间保持纯逻辑以便单测。
- 先复用已有的 helper,再考虑新写。

### 日志与排查

- 开发新功能或修改关键路径时必须补充适当日志,尤其是错误分支、重要业务入口/出口、网络请求/响应、跨进程 IPC、状态变更和长任务调度。日志要包含足够上下文(如 id、路径、参数摘要、错误信息),避免只写"失败了"这类无诊断价值的内容。
- 运行态日志由 Electron main 进程统一持久化到 `~/.chengxiaobang/data/logs/`,按本地日期和 3 小时时间段分片,路径形如 `logs/2026-06-14/09-12/main.log`、`renderer.log`、`backend.log`。本地 `pnpm dev` 默认注入 `CHENGXIAOBANG_LOG_LEVEL=debug`,因此开发时会记录 debug 日志;打包运行未显式设置时仍默认记录 `info` 及以上级别。
- 排查问题时优先按当前日志链路定位:先进入对应日期与时间段目录;主进程/启动/窗口/IPC 问题看 `main.log`;前端白屏、组件报错和渲染层 `console` 输出看 `renderer.log`;后端启动、Bun 进程 stdout/stderr、API/agent/tool 执行问题看 `backend.log`。
- 不要只依赖终端临时输出。遇到用户反馈"跑起来后出错""前端没反应""后端超时"等问题时,先读取上述日志文件,再结合代码和复现步骤判断根因。

### UI 实现必须遵循 DESIGN.md

- 任何 UI 实现/改动(组件、样式、配色、字体、布局、交互态)动手前**必须先阅读根目录 `DESIGN.md`**,并以其中的设计系统(色板、字体层级、间距、组件形态)为唯一视觉事实源。
- 不要凭感觉引入 DESIGN.md 之外的颜色、字号或圆角;确有缺口时先在 DESIGN.md 中补充定义,再实现。
- 涉及图标时,先看 `apps/desktop/src/renderer/assets/file-type-icons/README.md` 确认有没有合适图标;优先从 `@/assets/file-type-icons` 直接导入内置图标,没有合适图标时先复用语义相近的内置图标或按本目录模式补充 TSX 图标组件;按语言或路径动态选图标走 `@/lib/code-language-icons`。不要用 `<img src="...svg">`,也不要新增独立 `.svg` 文件。

## 常用命令

除特别说明外,均在仓库根目录运行。

- `pnpm dev` — 一条命令起全套开发环境:Vite(渲染层 HMR)+ `tsup --watch`(main/preload)+ Electron。Electron 自己经 `bun --watch` 拉起后端,所以**三层保存即热更新**(渲染层 = HMR,后端 = bun 同端口重启,main/preload = 重编译 + Electron 自动重启)。关窗或 Ctrl+C 全部收掉。见 `apps/desktop/scripts/dev.mjs`。
- `pnpm build` — 按序构建:shared → backend → desktop。打包前必须执行,因为 desktop 把后端 `dist/` 作为 extra resource 打入。
- `pnpm package:mac` — `pnpm build` 后 `electron-builder --mac`(dmg + zip)。
- `pnpm package:win` — `pnpm build` 后 `electron-builder --win --x64`(NSIS)。
- `pnpm typecheck` — 先构建 shared(其他包消费它的类型),再全仓 `tsc --noEmit`。
- `pnpm test` — Vitest(配置:`vitest.config.ts`)。单文件:`pnpm test apps/backend/test/agent-runner.test.ts`;按名过滤:`pnpm test -t "approval"`。测试在各包 `test/` 目录;`@chengxiaobang/*` 导入别名由 Vitest 配置解析。

后端也可独立运行:`pnpm --filter @chengxiaobang/backend dev` → `bun --watch src/main.ts --port <n> --data-dir <dir> --token <t>`(**必须 Bun 运行时**,`server.ts` 只接受 `Bun.serve`)。

### 发布与流水线排查

正式发包时先在本地完成必要验证并把版本号、lockfile、打包修复等改动提交到 `main`,再按 `git tag vX.Y.Z && git push origin main && git push origin vX.Y.Z` 推送版本 tag 来触发 `.github/workflows/release.yml`;若 tag 已存在且需要重发,先确认旧 release 与产物处理策略,不要盲目 force。流水线排查优先用 `gh run list --workflow Release --limit 5` 找 run id,用 `gh run watch <run-id> --interval 30 --exit-status` 盯状态,失败时用 `gh run view <run-id> --job <job-id> --log` 拉对应 job 日志;mac 发布重点确认 `Build mac distributables`、`Verify mac artifacts`、`Smoke packaged backend` 都通过,并在日志里看到 `source=Notarized Developer ID`、`app.asar 主进程运行时依赖检查通过`、`打包主进程运行时加载检查通过`、`打包后端 health check 成功`,成功后用 `gh release view vX.Y.Z --json url,assets` 核对 release 链接和上传产物。

## 架构

三层架构,`@chengxiaobang/shared` 是层间契约。完整设计文档见 `docs/architecture.md`。

**`packages/shared`** — API/IPC 契约的唯一事实源。所有实体(Provider、Project、Session、Message、ToolCall、RunRequest)都是 Zod schema + 推导类型;后端用它们 `.parse()` 请求,渲染层导入同一份类型。还拥有 `StreamEvent` 联合类型与 SSE codec(`encodeSseEvent`/`parseSseChunk`)。改这里的契约,两端必须跟随。它必须**先 build**,backend/desktop 的 typecheck 才能过(跨包消费其 `dist/` 类型)。

**`apps/backend`** — 无头本地 HTTP 服务,**不是** Electron 进程。Hono 风格的 `fetch` handler(`api/app.ts`)由 `Bun.serve` 提供服务(`server.ts`,强制 Bun;dev 与生产分别用 `node_modules/.bin/bun` 和捆绑的 Bun binary 启动)。agent 循环是 **pi 的 `runAgentLoopContinue`**(`@earendil-works/pi-agent-core`),由 `agent/agent-runner.ts` 驱动:pi 事件经 `agent/pi-events.ts`(`RunEventTranslator`,同时独占 run 级持久化)翻译为 `StreamEvent`,经 `POST /api/runs/stream` 以 SSE 流出。状态经 sql.js 落 SQLite(`repository/sqlite-state-store.ts`,藏在 `StateStore` 接口后);assistant/tool 消息行带 backend-only 的 `payload` 列(pi 原始消息 JSON),多轮工具调用历史得以无损回放(`agent/history.ts`)。密钥在 darwin 用 macOS Keychain(`security` CLI),win32 用 Windows Credential Manager,其他平台内存实现(`secrets/secret-store.ts`)。模型调用走 **pi-ai**(`streamSimple`);`model/pi-model.ts` 把 `ProviderConfig` 映射为 pi `Model`(provider 兼容差异——DeepSeek `reasoning_content`、Moonshot 怪癖——按 slug/baseUrl 自动探测)。内置 provider 为 DeepSeek 和 Kimi(shared 的 `defaultProviders`)。工具是 TypeBox schema 的 pi `AgentTool`(`tools/registry.ts` 汇集 fs/shell/web/office/feishu 工具工厂)。**定时任务**:模型在会话中经 `tools/schedule-tools.ts`(`schedule_create/list/cancel`,5 字段 cron,croner 解析)创建,任务绑定创建它的会话;`tasks/task-scheduler.ts` 轮询到期任务并在原会话中追加 headless run(`stream()` 的进程内 `headless` 参数:隐藏 `ask_user`、不覆写会话设置,待审批工具一律自动拒绝),先推进 `nextRunAt` 再执行(at-most-once,重启后补跑一次)。**技能市场**:内置技能(`apps/backend/skills/`,word/ppt/excel)始终激活;市场技能(`apps/backend/skills-market/`,编程/办公各 9 个,均随 dist 分发,见 `scripts/build-skills.mjs`)默认不激活,激活集合以 JSON 数组存 settings KV(`tools/skill-market-service.ts`),`SlashCommandService` 经注入的 `enabledMarketSkills` 回调过滤加载(source 为 `market`,优先级 builtin < market < global < project);自定义技能经 GitHub 链接导入或手动创建,落 `~/.chengxiaobang/skills/`(即 global 根,装好即被拾取)。REST 入口 `api/routes/skills.ts`,桌面端 UI 是侧边栏「技能」页(`SkillsView`)。注意:`paths.ts` 的 `builtinResourceRoot()` 靠探测 `skills` 目录定位资源根,**不要在 `src/` 下新建名为 `skills` 的目录**(会遮蔽资源根导致内置技能消失)。

**`apps/desktop`** — Electron 应用。**main 进程拉起并监督后端**(`main/backend-process.ts`):随机端口 + 随机 token,轮询 `/api/health` 就绪后经 `backend-info` IPC 把 `{baseURL, token}` 暴露给渲染层。每次启动应用 = 新端口上的全新后端。渲染层(React + Vite + Tailwind)是沙箱的;`preload/index.ts` 只暴露最小的 `window.chengxiaobang` bridge(backend info、原生文件/目录选择器、读文件)。`renderer/lib/api.ts` 据 bridge 的 baseURL/token 构建类型化 `ApiClient` 并消费 SSE 流。main 进程在 dev 加载 `VITE_DEV_SERVER_URL`,打包后加载 `dist/renderer/index.html`。

### Agent 运行流程(核心循环)

`POST /api/runs/stream` → `AgentRunner.stream()`:

1. 解析/创建会话,落库 user 消息,发 `run_started` + `message`。
2. **用户可见的内置斜杠命令只保留 `/compact`**:它走仅总结的模型调用(`agent/compaction.ts`),不落 user 消息;文件、shell、Git 等能力保留为 agent 内部工具,由模型在 pi 循环中按需调用。
3. 从持久化行重建 pi 对话(`agent/history.ts`),交给 `runAgentLoopContinue`(`toolExecution: "sequential"`)。`RunEventTranslator` 把 pi 事件映射到 `StreamEvent` 契约:`delta`(text/thinking 通道)、`message`(已持久化的 user 回显 / assistant 轮次)、`tool_call`(每次状态迁移一个事件:`pending_approval → running → completed | failed | rejected`)、最终的 `run_end`(completed/failed/aborted,带 usage)。与模型循环并行,新会话的 AI 标题(`agent/session-title.ts`)生成后经 `session_updated` 事件即时推送(失败时回退为用户首句)。
4. **审批门控**在 pi 的 `beforeToolCall` 钩子:`approval` 模式会话中的 mutating 工具先落 `pending_approval` 的 ToolCall,阻塞在 `ApprovalQueue.wait()` 直到 `POST /api/approvals/:toolCallId`;拒绝时返回 `{block: true}`,pi 把拒绝作为错误工具结果喂回模型(run 继续)。
5. `POST /api/runs/:runId/abort` 经以 runId 为键的 `AbortController` 取消;部分回答先落库并发出,再 `run_end(aborted)`。

每一步都是 `StreamEvent`(见 shared 中的联合类型);渲染层完全由这些事件驱动 UI。测试中用注入 pi `StreamFn` 替换模型(`AgentRunner` 的 `streamFn` 选项——见 `test/helpers/scripted-stream.ts`),**绝不 mock 循环本身**。

## 约定与陷阱

- **只用 ESM。**配置 `tsup`/打包器时把 `electron` 标为 `--external`——打进去会在 Electron 启动时报 `Dynamic require of "fs" is not supported` 崩溃。
- 后端 `main.js` 打入桌面应用的 `extraResources/backend`;`pi-ai`、`pi-agent-core`、`sql.js` 等被强制打包(`apps/backend/tsup.config.ts` 的 `noExternal`)。打包产物**只能用 Bun 运行**,纯 node 会因动态 require 崩溃。
- `bun`、`electron`、`esbuild`、`sharp`、`@google/genai`、`node-pty`、`onnxruntime-node`、`@napi-rs/canvas`、`ppu-paddle-ocr`、`protobufjs` 在 `onlyBuiltDependencies` / `allowBuilds` 中——原生/postinstall 构建是受控的。Windows 包必须在 Windows runner / Windows 本机构建，避免 native optional deps 跨平台错配；Windows v1 安装包暂按手动更新处理，不启用 Windows 自动更新入口。
- UI 文案与多数错误信息为中文,保持一致。
