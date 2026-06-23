# 长期记忆（Memory）设计与实现

> 最后更新：2026-06-23（同步 Memory 工具名与 toolMetadata 接线）

让程小帮**跨会话记住事情**：用户偏好与习惯、项目背景与约定、长期任务的进展、纠正过的结论。模型通过 `Memory` 工具读写一个独立于工作目录的记忆目录，记忆以普通文本文件落盘，所有会话共享。

方案对齐 Anthropic 官方 [memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)（`memory_20250818`）的设计：**一个客户端执行的 `Memory` 工具，六个命令操作 `/memories` 虚拟目录** + 系统提示注入记忆协议。选文件系统而非键值库/向量库，是因为模型对文件操作的训练最充分——浏览目录、读文件、精确替换都是它最熟悉的动作，不需要额外的检索基建。

核心取舍：

- **目录快照直接注入系统提示，而不是强制模型每轮先调 `view`**——官方做法是在系统提示里命令模型"开始任何事之前先查看记忆目录"，每个 run 多一次工具往返；我们把记忆目录两层清单（大小 + 路径）预先渲染进系统提示，模型只在需要内容时才 `view` 具体文件。
- **`Memory` 工具不进审批队列**——读写仅限专用记忆目录（路径穿越被硬性拦截），风险可控；且 headless 定时任务会自动拒绝一切待审批工具，进队列等于让定时任务永远无法记忆。
- **全局共享一个记忆根目录，不按项目分桶**——程小帮是个人桌面助手，"用户喜欢简洁回复"这类记忆天然跨项目；项目专属记忆由模型自己在 `/memories` 下建子目录组织（系统提示明确要求保持目录有条理）。
- **`create` 不允许覆盖已有文件**——遵循官方规范：已存在时报错，迫使模型先 `view` 再 `str_replace`，防止模型忘记文件存在而整文件覆盖、静默丢失记忆。

---

## 1. 总览（闭环链路）

```
每次 run 开始
   │
   ├─ AgentRunner.memoryPromptInput()
   │     renderMemoryListing(<dataDir>/memories)   ← 两层目录清单（大小+路径）
   │     失败只降级为空快照，绝不中断 run
   │
   ├─ buildSystemPrompt({ memory: { listing } })
   │     「## 长期记忆」段：记忆协议 + 目录快照
   │
   └─ 模型在循环中按需调用 Memory 工具
         view /memories/user.md        读取相关记忆
         create / str_replace / …      写入新认知
              │
              ▼
   <dataDir>/memories/**（普通文本文件，跨会话、跨重启持久）
              │
              ▼
   下一个 run 的系统提示快照里出现这个文件 → 记忆闭环
```

记忆对**所有执行通道**生效：普通对话、计划模式（draft 阶段即可读写）、飞书会话、定时任务 headless 执行。

## 2. 落盘位置

```
<dataDir>/memories/          # 与 chengxiaobang.sqlite 同级
  └── （模型自由组织，建议结构示例）
      user.md                # 用户偏好
      projects/<名称>.md     # 项目约定
      tasks/<名称>.md        # 长期任务进展
```

- `dataDir` 即后端 `--data-dir`（默认 `~/.chengxiaobang/data`），见 `main.ts` 的 `memoryDir = join(config.dataDir, "memories")`。
- 模型可见的路径永远是 `/memories/...` 虚拟前缀；真实落盘路径不暴露给模型。
- 目录懒创建：首次 `create` 时 `mkdir -p`，空目录不产生任何系统提示噪音之外的成本。

## 3. `Memory` 工具（apps/backend/src/tools/memory-tools.ts）

单个工具 + `command` 参数区分操作（与官方一致，而非拆成六个工具）。参数用**扁平可选字段**而不是 TypeBox Union 判别式——DeepSeek/Kimi 的兼容端点对 `anyOf` 复合 schema 支持不稳，扁平 schema + 执行期校验最稳妥。

| command | 必需参数 | 行为 |
| --- | --- | --- |
| `view` | （`path` 可省，默认根） | 目录 → 两层清单；文件 → 6 位右对齐行号渲染，支持 `view_range: [起, 止]`，超 32KB 截断并提示分段读取 |
| `create` | `path` + `file_text` | 新建文件，自动建父目录；**已存在则报错**（防整文件覆盖） |
| `str_replace` | `path` + `old_str`（+ `new_str`） | 精确替换；`old_str` 不存在或出现多次（报行号）都拒绝 |
| `insert` | `path` + `insert_line` + `insert_text` | 在第 N 行后插入（0 = 文件开头），行号越界报错 |
| `delete` | `path` | 递归删除文件/目录；**拒绝删除根目录 `/memories`** |
| `rename` | `old_path` + `new_path` | 重命名/移动，自动建目标父目录；**目标已存在则拒绝覆盖** |

所有错误信息都写成**可指导模型自我修正**的中文（如"已存在；修改请用 str_replace"），而非裸异常。

### 路径安全（resolveMemoryPath）

官方文档将路径穿越列为必须防御项。两道硬校验：

1. 虚拟路径必须是 `/memories` 本身或以 `/memories/` 开头；
2. resolve 后的真实路径必须仍在 `memoryDir` 内（前缀含分隔符比对，封死 `../`、多重 `..`、前缀仿冒如 `/memoriesfoo`）。

越界尝试记 warn 日志并抛错。实现与 `tools/workspace.ts` 的 `safeResolve` 同构。

## 4. 系统提示注入（agent/system-prompt.ts）

`buildSystemPrompt` 新增 `memory?: { listing?: string }` 输入；提供时注入「## 长期记忆」段：

- 记忆协议四条：**先查**（快照中有相关文件先 `view` 再动手）、**主动记**（偏好/约定/进展/纠正过的结论）、**保持精炼**（过时即更新或删除、能合并不新建、临时细节不写入）、**禁存敏感信息**（密码、API Key）。
- 末尾附目录快照（`renderMemoryListing` 渲染，最多两层、跳过隐藏文件、上限 50 条防失控撑爆提示）；空目录时显示「（记忆目录为空）」。
- 未配置 `memoryDir`（如测试默认）时整段省略，工具也不注册——记忆是显式开启的能力。

## 5. 接线（谁在什么时候启用记忆）

```
main.ts
  memoryDir = join(config.dataDir, "memories")
  new AgentRunner(store, secrets, { memoryDir, createTools: … memoryDir … })

agent-runner.ts
  AgentRunnerOptions.memoryDir
  ├─ 默认 createTools → createAgentTools(workspacePath, { memoryDir })  # 注册 Memory 工具
  ├─ stream() / buildSessionDebugContext() → memoryPromptInput() → buildSystemPrompt
  └─ 快照读取失败：warn 日志 + 空快照降级，run 照常进行

tools/registry.ts
  createAgentTools options 新增 memoryDir；提供时注册 Memory
  selectAgentTools 在计划草稿阶段按 toolMetadata.planDraftVisible 放行 Memory
  toolMetadata("Memory").requiresApproval === false（理由见「核心取舍」）
```

契约与展示同步：shared `toolNameSchema` 包含 `Memory`；`packages/shared/src/tool.ts` 的 `builtinToolMetadata.Memory` 声明它属于 `memory` 类别、mutating 但免审批、计划草稿可见；前端工具展示和 i18n 使用同名 key。

## 6. 前端展示（apps/desktop）

`renderer/lib/tool-display.ts`：

- 图标 `BrainIcon`，独立聚合类别 `memory`（折叠摘要显示「N 次记忆操作」）。
- 工具行文案 `chat.toolLine.Memory`：「访问记忆 {path}」/ "Accessed memory {path}"，path 取 `args.path ?? args.old_path`。

记忆是普通工具调用，复用既有 ToolCallRow 全部交互（展开看参数/结果），无新增 UI 面。

## 7. 安全与边界

- **路径穿越**：见 §3，双重校验 + 日志。
- **敏感信息**：系统提示明令禁止写入密码/API Key（官方亦依赖模型自律 + 提示约束；如需更强保证，未来可在 `create`/`str_replace` 执行层加正则过滤）。
- **体积失控**：单文件 view 输出 32KB 截断；系统提示快照 50 条目截断。记忆文件本身不限制大小——协议要求模型保持精炼，撑大只会先反噬它自己的快照可读性。
- **删除保护**：根目录不可删；`create`/`rename` 不可覆盖已有内容。
- **可观测性**：每次写操作（create/str_replace/insert/delete/rename）记 info 日志（路径+摘要），排查"它为什么记住了/忘了"时看对应日期与 3 小时时间段目录下的 `backend.log`。

## 8. 测试（apps/backend/test/memory-tools.test.ts 等）

- **工具本体** 17 条：六命令正反路径全覆盖（view 行号与 view_range、create 防覆盖、str_replace 唯一性、insert 行号边界、delete 根目录保护、rename 防覆盖）、路径穿越攻击、缺参报错、隐藏文件跳过。
- **系统提示**（system-prompt.test.ts）：注入/省略/快照三态。
- **接线**（agent-runner.test.ts）：配置 `memoryDir` 后 debug 上下文里工具可见 + 提示含快照；未配置时两者都不出现。
- **注册与审批**（tools.test.ts）：仅在传入 `memoryDir` 时注册；`requiresApproval("Memory") === false`。
- **契约**（contracts.test.ts、tool-catalog.test.ts）与**前端映射**（tool-display.test.ts）：枚举完整性。

## 9. 未来扩展（暂不做）

- **设置页记忆管理**：查看/编辑/清空记忆文件的 UI（当前可直接在 Finder 打开 `~/.chengxiaobang/data/memories/`）。
- **记忆过期**：按 atime 定期归档长期未访问的文件（官方建议项）。
- **与 /compact 协同**：压缩会话前提示模型把关键上下文先写入记忆，对应官方 memory + compaction 组合模式。
- **写入侧敏感信息过滤**：执行层正则拦截疑似密钥的内容。
