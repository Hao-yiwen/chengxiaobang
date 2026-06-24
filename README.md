# 程小帮（chengxiaobang）

程小帮是一个 **macOS / Windows Electron AI 助手桌面应用**（agentic coding companion）。它在本地拉起一个无头 HTTP 后端，由 [pi](https://www.npmjs.com/package/@earendil-works/pi-agent-core) 驱动 agent 循环，桌面端通过应用级 SSE 实时消费模型输出、工具调用、审批与定时任务事件。

技术栈：**pnpm + TypeScript monorepo，全仓 ESM**，后端运行时强制 **Bun**，桌面端为 **Electron + React + Vite + Tailwind**。

> 本 README 面向参与开发本项目的工程师。深入的工作准则、约定与陷阱见根目录 [`CLAUDE.md`](./CLAUDE.md)（`AGENTS.md` 是它的软链）；设计系统见 [`DESIGN.md`](./DESIGN.md)；完整架构见 [`docs/architecture.md`](./docs/architecture.md)。

---

## 环境要求

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20（建议 LTS） | 跑 pnpm、Vite、tsup、Electron |
| pnpm | 11.0.9（见 `packageManager`） | 唯一包管理器，推荐 `corepack enable` 自动对齐版本 |
| Bun | 1.3.14（作为 devDependency 安装） | **后端运行时**，无需全局安装，仓库内已捆绑 |
| 操作系统 | macOS、Windows 10/11 x64 | 桌面打包目标为 mac（dmg + zip）和 Windows（NSIS）；Windows 包建议在 Windows 本机构建 |

密钥（provider API Key）在 macOS 通过 **Keychain**（`security` CLI）存储，在 Windows 通过 **Credential Manager** 存储，其他平台为内存实现。

```bash
corepack enable        # 对齐 pnpm 版本（可选但推荐）
pnpm install           # 安装依赖；onlyBuiltDependencies 控制原生/postinstall 构建
```

---

## 快速开始

```bash
pnpm dev
```

一条命令起全套开发环境：

- **Vite** —— 渲染层 HMR
- **tsup --watch** —— 编译 Electron main / preload
- **Electron** —— 自己经 `bun --watch` 拉起后端

三层保存即热更新：

- 渲染层 = HMR
- 后端 = bun 同端口重启
- main / preload = 重编译 + Electron 自动重启

关窗或 `Ctrl+C` 会收掉全部进程。编排逻辑见 `apps/desktop/scripts/dev.mjs`。

> 每次启动应用 = main 进程在**随机端口 + 随机 token** 上拉起一个全新后端，轮询 `/api/health` 就绪后经 `backend-info` IPC 把 `{baseURL, token}` 注入沙箱渲染层。

### 单独运行后端（调试用）

```bash
pnpm --filter @chengxiaobang/backend dev
# → bun --watch src/main.ts --port <n> --data-dir <dir> --token <t>
```

后端**只能用 Bun 运行**（`server.ts` 只接受 `Bun.serve`，纯 node 会因动态 require 崩溃）。

---

## 常用命令

> 除特别说明外，均在仓库根目录运行。

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 起全套开发环境（见上） |
| `pnpm build` | 按序构建 shared → backend → desktop（打包前必须执行） |
| `pnpm package:mac` | `build` 后 `electron-builder --mac`，产出 dmg + zip |
| `pnpm package:win` | `build` 后 `electron-builder --win --x64`，产出 Windows NSIS 安装包 |
| `pnpm typecheck` | 先 build shared，再全仓 `tsc --noEmit` |
| `pnpm test` | Vitest 全量；单文件 `pnpm test <path>`，按名过滤 `pnpm test -t "<name>"` |

构建为何要按序：desktop 把后端 `dist/` 作为 extra resource 打入，且 backend/desktop 的 typecheck 依赖 shared 已 build 出的 `dist/` 类型。

Windows v1 支持 Windows 10/11 x64。CI 会在 `windows-latest` 上执行 install/typecheck/test/build；Release 会分别在 macOS 和 Windows runner 构建产物，Windows job 会校验 `bun.exe`、backend、OCR 模型和 native 依赖，并用打包资源启动一次 backend `/api/health` 冒烟。Windows 自动更新入口本轮不启用，安装包更新以手动下载新版 NSIS 为准。

---

## 项目结构

```
chengxiaobang/
├── packages/
│   └── shared/          # @chengxiaobang/shared —— 层间契约的唯一事实源
├── apps/
│   ├── backend/         # @chengxiaobang/backend —— 无头本地 HTTP 服务（Bun 运行）
│   └── desktop/         # @chengxiaobang/desktop —— Electron 应用
├── docs/                # 架构与专题设计文档
├── CLAUDE.md            # 工程准则、约定、陷阱（AGENTS.md 软链至此）
├── DESIGN.md            # 设计系统（UI 实现的唯一视觉事实源）
└── vitest.config.ts     # 测试配置（解析 @chengxiaobang/* 导入别名）
```

### 三层架构

`@chengxiaobang/shared` 是层间契约，三层之间不跨层伸手、不重复声明契约。

#### `packages/shared` —— 契约层

API / IPC 契约的唯一事实源。所有实体（Provider、Project、Session、Message、ToolCall、RunRequest、ScheduledTask…）都是 **Zod schema + 推导类型**：后端用它们 `.parse()` 请求，渲染层导入同一份类型。还拥有 `StreamEvent` / `AppEvent` 联合类型、工具元数据（`toolMetadata`）与 SSE codec（`encodeSseEvent` / `parseSseChunk`）。**改这里，两端必须跟随；它必须先 build。**

#### `apps/backend` —— 后端层（Bun，非 Electron 进程）

- Hono 风格的 `fetch` handler（`api/app.ts`），由 `Bun.serve` 提供服务（`server.ts`，强制 Bun）。
- agent 循环是 **pi 的 `runAgentLoopContinue`**，由 `agent/agent-runner.ts` 驱动；pi 事件经 `agent/pi-events.ts`（`RunEventTranslator`）翻译为 `StreamEvent`。桌面默认用 `POST /api/runs` 启动 run，再通过全局 `GET /api/events` 接收 `AppEvent`；旧 `POST /api/runs/stream` 仍作为测试和回退流式入口保留。
- 状态经 **sql.js 落 SQLite**（`repository/sqlite-state-store.ts`，藏在 `StateStore` 接口后）；assistant/tool 消息行带 backend-only 的 `payload` 列以无损回放多轮工具历史。
- 模型调用走 **pi-ai**（`streamSimple`）；`model/pi-model.ts` 把 `ProviderConfig` 映射为 pi `Model`（按 slug/baseUrl 自动探测 provider 兼容差异）。内置 provider 为 **DeepSeek** 和 **Kimi**。
- 工具是 TypeBox schema 的 pi `AgentTool`（`tools/registry.ts` 汇集文件、Shell、网页抓取/搜索、Memory、定时任务、Todo、技能、OCR、飞书和 MCP 插件工具）；展示、审批、deferred 与计划草稿可见性统一由 `toolMetadata` 描述。
- **定时任务**：模型经 `tools/schedule-tools.ts` 创建一次性或周期任务（`kind=once + run_at` / `kind=recurring + 5 字段 cron`），`tasks/task-scheduler.ts` 轮询到期任务并在原会话追加 headless run，同时向全局事件流发布任务生命周期事件。
- **插件 / MCP / 技能市场**：插件可声明 MCP server，启用后转成 `mcp__...` 工具；内置技能、市场技能、插件技能和自定义技能共同进入斜杠命令与 Skill 工具体系。
- **手机通道**：飞书和微信绑定会话复用同一个 runner，外部消息串行进入对应会话，结果回发到手机通道。

#### `apps/desktop` —— 桌面层（Electron）

- **main 进程拉起并监督后端**（`main/backend-process.ts`）。
- 渲染层（React + Vite + Tailwind）沙箱化；`preload/index.ts` 只暴露最小的 `window.chengxiaobang` bridge（backend info、原生文件/目录选择器、读文件）。
- `renderer/lib/api.ts` 据 bridge 的 baseURL/token 构建类型化 `ApiClient`；默认用 `startRun` + `subscribeAppEvents` 接入全局 SSE，并保留 `streamRun` 兼容旧路径和测试。
- 渲染层拆为 `store/`（zustand 状态）、`components/`（视图）、`lib/`（IO）、`hooks/`、`i18n/`。

### Agent 运行流程（核心循环）

桌面默认路径：`POST /api/runs` 启动 run，`GET /api/events` 接收 `AppEvent`；旧 `POST /api/runs/stream` 仍可直接流式消费 `AgentRunner.stream()`。

1. 解析/创建会话，落库 user 消息，发 `run_started` + `message`。
2. **用户可见的内置斜杠命令只保留 `/compact`**：它走仅总结的模型调用，不落 user 消息；文件、shell、Git 等能力保留为 agent 内部工具，由模型在 pi 循环中按需调用。
3. 从持久化行重建 pi 对话（`agent/history.ts`），交给 `runAgentLoopContinue`。`RunEventTranslator` 把 pi 事件映射到 `StreamEvent`：`setup_error` / `run_started` / `delta` / `plan_delta` / `message` / `tool_activity` / `tool_call` / `session_updated` / `run_end`。
4. **审批门控**在 pi 的 `beforeToolCall` 钩子：`approval` 模式下需要确认的工具先落 `pending_approval` 或 `pending_smart_approval`，阻塞在 `ApprovalQueue.wait()` 直到 `POST /api/approvals/:toolCallId`；项目会话支持“始终允许本项目”的同签名工具调用信任。
5. `POST /api/runs/:runId/abort` 经以 runId 为键的 `AbortController` 取消；`POST /api/runs/:runId/steering` 可向运行中的 run 注入用户引导。

run 生命周期由 `StreamEvent` 驱动；定时任务开始/结束等应用级通知作为 `ScheduledTaskEvent` 合入 `AppEvent`，同一条全局 SSE 推给渲染层。

---

## 测试

- 测试放在各包 `test/` 目录，用 **Vitest** 运行；收工前保持 `pnpm test` 全绿。
- **每个行为变更都要带单元测试**；修 bug 先写复现的失败测试再修到通过。
- 模式约定：后端逻辑直接针对模块测试；渲染层用 `@testing-library/react` + jsdom + mock 的 `ApiClient`；agent 循环的模型测试缝是注入 pi `StreamFn`（见 `apps/backend/test/helpers/scripted-stream.ts`），**绝不 mock 循环本身**。

```bash
pnpm test                                          # 全量
pnpm test apps/backend/test/agent-runner.test.ts   # 单文件
pnpm test -t "approval"                            # 按名过滤
```

---

## 日志与排查

运行态日志由 Electron main 进程统一持久化到 `~/.chengxiaobang/data/logs/`，按本地日期和 3 小时时间段分片，路径形如 `logs/2026-06-14/09-12/main.log`：

| 文件 | 看什么 |
| --- | --- |
| `main.log` | 主进程 / 启动 / 窗口 / IPC 问题 |
| `renderer.log` | 前端白屏、组件报错、渲染层 `console` 输出 |
| `backend.log` | 后端启动、Bun 进程 stdout/stderr、API/agent/tool 执行问题 |

本地 `pnpm dev` 默认注入 `CHENGXIAOBANG_LOG_LEVEL=debug`；打包运行默认 `info`。遇到「跑起来后出错 / 前端没反应 / 后端超时」，先进入对应日期与时间段目录，再读对应日志文件并结合代码与复现步骤判断根因。

---

## 约定与陷阱

- **只用 ESM。** 配置 tsup / 打包器时把 `electron` 标为 external —— 打进去会在 Electron 启动时报 `Dynamic require of "fs" is not supported` 崩溃。
- 后端 `main.js` 打入桌面应用的 `extraResources/backend`；`pi-ai`、`pi-agent-core`、`sql.js` 等被强制打包（`apps/backend/tsup.config.ts` 的 `noExternal`）。**打包产物只能用 Bun 运行。**
- `bun`、`electron`、`esbuild`、`sharp`、`@google/genai`、`node-pty`、`onnxruntime-node`、`@napi-rs/canvas`、`ppu-paddle-ocr`、`protobufjs` 在 `onlyBuiltDependencies` / `allowBuilds` 中，原生 / postinstall 构建受控；Windows 包必须在 Windows runner / Windows 本机上构建，避免 native optional deps 跨平台错配。
- UI 文案与多数错误信息为中文，保持一致。
- **任何 UI 改动动手前必须先读 [`DESIGN.md`](./DESIGN.md)**，以其设计系统为唯一视觉事实源。

---

## 相关文档

- [`CLAUDE.md`](./CLAUDE.md) —— 工程准则（写码前先思考 / 简单优先 / 外科手术式修改 / 目标驱动）、约定与陷阱
- [`DESIGN.md`](./DESIGN.md) —— 设计系统（色板、字体层级、间距、组件形态）
- [`docs/architecture.md`](./docs/architecture.md) —— 完整架构设计
- [`docs/global-sse-event-stream.md`](./docs/global-sse-event-stream.md) —— 全局 SSE 与运行事件恢复
- [`docs/scheduled-tasks.md`](./docs/scheduled-tasks.md) —— 定时任务
- [`docs/tool-call-ui.md`](./docs/tool-call-ui.md) —— 工具调用 UI
- [`docs/memory.md`](./docs/memory.md) —— 长期记忆（Memory）工具
- [`docs/shell-background-execution.md`](./docs/shell-background-execution.md) —— Shell 后台命令
- [`docs/provider-catalog-yaml.md`](./docs/provider-catalog-yaml.md) —— 供应商与模型静态配置
- [`docs/usage-cost-ledger.md`](./docs/usage-cost-ledger.md) —— token 用量与成本账本
- [`docs/sidebar-pinning.md`](./docs/sidebar-pinning.md) —— 侧边栏固定
