# 工具调用展示与底部审批方案

> 最后更新:2026-06-23(补齐项目级信任、智能审批和工具元数据)

聊天界面中工具调用的展示与敏感操作审批的交互方案。参照 Claude / Codex 桌面端的形态:连续工具调用折叠为一行摘要、每个工具有专属图标、审批面板固定在输入框上方而不是漂在消息流里。

---

## 1. 背景与问题

改造前的三个痛点:

1. **每个工具调用一个小方框**。`ToolCallRow` 渲染大写 mono 工具名(`READ_FILE`)+ 状态文字,模型连续读十几个文件时消息流被方框刷屏,信息密度极低。
2. **没有视觉区分**。所有工具共用 勾/叉/转圈 三个状态图标,无法一眼看出"在读文件"还是"在跑命令"。
3. **审批卡渲染在消息流中间**。approval 模式下 `pendingTool` 的 JSON 审批卡插在时间线里,随内容滚动走位;Codex 的习惯是固定在底部输入框上方,视线不用来回跳。

目标形态(用户确认):

- 折叠态:`[图标] 读取 3 个文件 · 检索 2 次 ⌄`,点击展开为逐条轻量行(图标 + 人话描述),每条仍可再点开看原始 result/diff。
- 每个内置工具映射专属图标,未知工具名(模型可能请求不存在的工具)有兜底图标。
- 审批面板移到 Composer 正上方;支持拒绝、允许,以及项目会话里的“始终允许本项目”（同项目内同签名工具调用自动放行）。
- `AskUserQuestion` 提问顺势接线现成的 `AskUserCard`(选项点击 + 键盘快捷键),告别 JSON 卡。

---

## 2. 关键设计决策

### 2.1 分组用独立纯函数,不切换 `chatTimeline()`

`lib/timeline.ts` 中已有更丰富的 `chatTimeline()`(separator/plan/plan-history 等 kind),但其对应渲染器(PlanCard 等)尚未在 ChatView 接线,切换会带出整套未完成 UI。因此分组实现为独立 fold:

```ts
// lib/timeline.ts
export type GroupedTimelineItem =
  | TimelineItem
  | { kind: "tool-group"; at: string; toolCalls: ToolCall[] };

export function groupTimelineItems(items: TimelineItem[]): GroupedTimelineItem[];
```

ChatView 只把 `timelineItems(...)` 的结果再过一遍这个 fold;`session-export.ts` 等其他消费方不受影响。将来 `chatTimeline` 接线时可在其内部复用同一 fold。

### 2.2 分组规则

- **仅 ≥2 个连续可分组工具才成组**;单个退化为原 `tool` item(同一形态的单独轻量行),避免"组中组"双层展开。
- **任何 message 都打断分组**(user 消息、assistant 的工具间叙述都算)。
- **不可分组、且打断分组**的工具:
  - 专属渲染类:`AskUserQuestion`(问答回执)、`Skill`(技能 chip)、`ExitPlanMode`(计划提交);
  - 交付物类:`Write` 当 `file_path` 是交付物扩展名(md/html/office/csv/媒体等)时独立——完成后渲染为 ArtifactCard。

### 2.3 交付物判定忽略 status(`isDeliverableToolCall`)

`artifactFromToolCall()` 只在 `completed` 时返回 artifact。如果分组按它判定,工具 running 时在组里、完成瞬间弹出为 ArtifactCard,会导致**组分裂 → React key 漂移 → 展开状态丢失**。因此 `lib/artifact.ts` 提取了不看状态的判定:

```ts
export function isDeliverableToolCall(toolCall: ToolCall): boolean; // 只看 name + file_path 扩展名
```

`artifactFromToolCall` 内部复用它(行为不变),分组层用它把交付物从头到尾排除在组外。

### 2.4 组的 React key 与流式稳定性

组 key = `group-${toolCalls[0].id}`。流式期间只会向组尾追加(中断才另起新组),首元素 id 稳定,组件不重挂载,`useState` 的展开状态天然保留(有测试钉住此行为)。

### 2.5 状态呈现

- 当前 run 里的真实活跃工具(`running` / `pending_smart_approval`)都会进入聊天时间线并显示执行态；只有 `Write` / `Edit` 显示路径预览,其他工具只显示泛化文案(如「抓取网页中」「网络搜索中」「运行命令中」),不展示 URL、搜索词、命令或路径。`pending_smart_approval` 是智能审批内部等待态,会出现在时间线里,但不会出现在底部普通审批 dock。
- 运行态有 200ms 最短可见时间:如果工具很快完成,原始历史立即更新为终态,但聊天时间线会用 running 快照覆盖到满 200ms,再切换到完成/失败/拒绝历史态。
- 有 failed/rejected → 头部红色 mono 计数(`1 失败`),但**不自动展开**——流式中自动展开会引起视口跳动。
- 普通 `pending_approval` 活动工具只进 `pendingTool` 不进 `toolHistory`(store 的 tool_call 事件分支),所以普通审批中的工具只出现在底部 dock,不会同时出现在时间线里。`pending_smart_approval` 会按活跃工具进入时间线,用于提示智能审批正在判断。

### 2.5.1 无边框行,与思考面板同构对齐

工具组折叠头、单独工具行和 Skill chip 都**不用白色边框卡**,而是与 ReasoningPanel 头部完全同构的灰字行:左侧 size-3.5 图标占据 chevron 槽位 + gap-1.5 + `text-caption text-muted-foreground` 文字(hover 提亮),尾随小 chevron(折叠 `-rotate-90`)。这样「已深度思考 · 用时 N 秒」「读取 3 个文件 ⌄」「已加载技能 excel」的图标和文字左缘逐像素对齐。

- 组展开内容放在与 ReasoningPanel 展开体相同的 `ml-1.5 border-l border-hairline pl-3` 左竖线容器里,逐条 ToolCallLine。
- 行内再展开的 result 用无边框 `bg-muted/50` 圆角小块,diff 用细边框容器包 DiffView。
- 工具间的过渡叙述(后面紧跟工具的 assistant 消息,即 `hideActions` 判据)**不显示「用时 N 秒」脚注**——整轮耗时只标在收尾回答上。

### 2.6 纯思考轮次是时间线一等公民

模型的一轮可能是「只思考 + 调工具,没有正文」(典型:思考 12 秒 → Skill)。改造前这类轮次的 assistant 消息只落库不推送、且被时间线过滤(content 为空),它的思考没有自己的时间线位置——直播时思考面板固定渲染在 items 之后,后到的工具 chip 反而插到它上面,看起来"工具在思考前面"。

修复(三处对齐):

- 后端 `pi-events.ts onAssistantEnd`:push 条件从 `text.trim()` 放宽为 `text.trim() || reasoning`——带思考的纯工具轮也发 message 事件(content 空、reasoning 非空),消息行落库时间早于工具行,排序天然正确。
- 渲染层 `timelineItems` 过滤条件:保留 `content 非空 || 有 reasoning` 的消息(真正全空的纯工具轮仍被过滤)。
- `MessageBubble`:content 为空 → 只渲染 settled 的 ReasoningPanel(无正文、无操作按钮、无时长行);`lastAssistantId` 跳过空正文消息,复制/重新生成停留在最后一条真实回答上。session-export 同步:纯思考轮只导出思考引用,关闭 includeReasoning 时整节跳过。

副产物:store 收到这条 message 事件时会照常清空 thinking 直播 buffer,纯工具轮的思考从「挂在底部的流式面板」即时落位成历史面板,不再跨轮叠加。

### 2.7 审批面板:`ApprovalDock`

渲染位置在 `App.tsx` 会话视图底部容器内、`<Composer/>` 上方(同一个 `max-w-[48rem]` 版心)。home 视图不渲染——home 永远没有活动 run(store 在 `run_started` 即切 chat 视图)。

```
┌──────────────────────────────────────────────┐
│ [图标] 等待批准  运行 rm -rf dist   [拒绝][允许] │
├──────────────────────────────────────────────┤
│ rm -rf dist            ← 预览区(按工具分形态)  │
└──────────────────────────────────────────────┘
│ Composer …                                    │
```

- 预览区:`Shell` → 近黑 mono 命令块(DESIGN.md 代码卡片形态);`Edit/Write` → mono 路径 + `DiffView`(`buildToolCallDiff` 纯参数驱动,审批前即可算);其余 → JSON `<pre>`。
- `pendingTool.name === "AskUserQuestion"` → 渲染 `AskUserCard`(选项单击提交、A-Z/↑↓/回车键盘直达、自定义输入),决议经同一个 `onDecide` 回调走 `approve(toolCallId, decision)`。
- **决议即隐藏**:`decidedId` state 在提交瞬间卸载卡片,避免与时间线上随 `tool_call` 事件出现的回执短暂双显。
- **始终允许本项目**:当当前会话属于项目时,允许按钮旁提供项目级放行入口,向后端提交 `{ approved: true, approvalScope: "project" }`。后端用 `projectId + toolName + args` 生成签名并保存信任规则,同项目内相同签名的后续工具调用自动放行。
- 与 Composer 的 `awaitingAskUser` 通道(输入框文本当答案)共存:后端 `ApprovalQueue` 只取第一个决议,`AskUserCard` 自带 `lockedRef` 防重,无需前端互斥。
- 侧栏 `SideChatPanel` 的内联审批卡是独立 side-chat 通道,本方案未动;后续可复用 ApprovalCard 统一形态。

---

## 3. 模块与数据流

```
StreamEvent(tool_call)
  └→ store:pending_approval → pendingTool;其余状态 → toolHistory(upsert)
       │                          │
       ▼                          ▼
  ApprovalDock(底部)        ChatView
   ├ AskUserQuestion → AskUserCard    └ groupTimelineItems(timelineItems(messages, toolHistory))
   └ 其他 → ApprovalCard            ├ kind=message    → MessageBubble
       │                            ├ kind=tool       → ToolCallRow(分发:ArtifactCard /
       ▼                            │                    AskUserReceipt / UseSkillChip /
  approve(toolCallId, decision)     │                    无边框 ToolCallLine)
  → POST /api/approvals/:id         └ kind=tool-group → ToolCallGroup
                                                          └ 展开后逐条 ToolCallLine
```

### 文件清单

| 文件 | 角色 |
|---|---|
| `renderer/lib/tool-display.ts` | **纯函数**:`toolIcon`(当前 27 个内置工具 → 内置语义图标,兜底图标 + 一次性 debug 日志)、`toolCategory`/`categoryIcon`(10 个聚合类别,含 memory)、`toolLineLabel`(人话描述 i18n key + 已截断参数)、`toolGroupSummary`(按类别首现顺序聚合计数)、`truncateEnd` |
| `renderer/lib/timeline.ts` | `groupTimelineItems` / `isGroupableToolCall` / `GroupedTimelineItem` |
| `renderer/lib/artifact.ts` | `isDeliverableToolCall`(新提取,不看 status) |
| `renderer/components/ToolCallLine.tsx` | 轻量单行:图标 + 描述 + 行尾状态(running→spinner / 待批准文案 / 失败红字 / 完成时长),可展开 result/diff,文件预览按钮 |
| `renderer/components/ToolCallGroup.tsx` | 折叠组:摘要头 + 展开后逐条 ToolCallLine |
| `renderer/components/ToolCallRow.tsx` | 保留分发职责(ArtifactCard / AskUserReceipt / UseSkillChip),generic 分支 = 单独一条无边框 ToolCallLine |
| `renderer/components/ApprovalDock.tsx` | 底部审批面板(含内部 ApprovalCard / ApprovalPreview),`data-testid="approval-dock"` |
| `renderer/components/ChatView.tsx` | 接 `groupTimelineItems`、新增 tool-group 分支;**移除**内联审批卡 |
| `renderer/App.tsx` | 会话视图 Composer 上方插 `<ApprovalDock/>` |
| `i18n/locales/{zh,en}.json` | `chat.toolLine.*`(每工具一条描述模板)、`chat.toolGroup.*`(类别摘要,en 带 `_one/_other` 复数)、复用既有 `chat.approvalTitle` |

### 文案与截断规则

- 描述模板按工具取参:path 类用 `shortenPath`(尾两段);`search.query`/`glob.pattern` 截 40;`Shell.command` 压缩空白后截 60;`WebFetch.url` 截 60;`ExitPlanMode.title` 截 30。
- 流式参数预览仅用于 `Write` / `Edit` 的 `file_path`;聊天时间线里的真实 running 工具可以显示泛化执行态,但 URL、搜索词或命令仍只在完成历史或审批面板里展示。
- 摘要类别:read / edit / search / command / web / artifact / plan / schedule / memory / other,组件层以 `" · "` 连接。
- `ToolCall.name` 是普通 string(模型可能请求未知工具),未知名 → `chat.toolLine.fallback`(「调用 {{name}}」)+ 兜底图标。

---

## 4. 测试

| 测试文件 | 钉住的行为 |
|---|---|
| `test/tool-display.test.ts` | 全部内置名有专属图标且不落兜底;未知名兜底;每个 key 在 zh/en 文案中存在;截断规则;摘要聚合顺序 |
| `test/timeline.test.ts`(扩) | 连续成组 / 消息打断 / 当前 run running 工具可见 / 专属工具与交付物独立(含 running 状态) / Write 按扩展名分流 / 单工具退化 / 组 at = 首工具 |
| `test/artifact.test.ts`(扩) | `isDeliverableToolCall` 忽略 status;`artifactFromToolCall` 回归 |
| `test/tool-call-group.test.tsx` | 默认折叠摘要;展开逐条;行内再展开 result;running 头部泛化描述且不露参数;失败红标不展开;**rerender 追加后展开状态保留**;onOpenFile 透传 |
| `test/tool-call-row.test.tsx`(改) | 人话描述替代裸工具名;时长/diff/预览/三个专属分支回归 |
| `test/approval-dock.test.tsx` | shell 命令预览 + 允许/拒绝 decision;Edit 路径+diff 预览;AskUserQuestion 选项转发 `{approved, answer}`;决议即消失;无 pendingTool 渲染空 |
| `test/app.test.tsx`(扩) | 集成:pending_approval 事件 → dock 出现在 composer 侧,消息流中无审批卡 |

---

## 5. 后续可演进

- **更细粒度的信任管理 UI**:当前已支持项目级“始终允许本项目”,但还没有设置页查看、撤销或按规则管理这些信任记录。
- 侧栏 `SideChatPanel` 的审批卡复用 `ApprovalCard` 统一形态。
- `chatTimeline()` 全量接线(plan/aside 渲染器)时,把 `groupTimelineItems` 合入其 fold。
- 历史会话残留的 `pending_approval` 行(run 异常结束遗留)目前按 spinner 行呈现,可考虑显示"未审批"终态。
