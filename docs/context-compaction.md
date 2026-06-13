# 上下文压缩与长工具结果保护

> 最后更新：2026-06-13

本文说明程小帮当前的上下文压缩链路。这里有三层机制：手动 `/compact` 会把较早对话总结成 `compaction_summary`；普通 run 在进入模型循环前会按模型窗口自动触发同一套摘要压缩；超长工具结果则先落盘，只把短摘要和文件路径交给模型，避免单次工具输出撑爆上下文。

---

## 1. 总览

压缩的目标不是删除历史，而是在构造模型上下文时用“最新摘要 + 摘要之后的消息”替代完整旧历史。

核心数据形态：

- `Message.kind = "compaction_summary"`：一条 assistant 摘要消息，保存模型生成的压缩摘要。
- `Session.compactedUpToMessageId`：指向已经被摘要覆盖到的最后一条普通消息。
- `.chengxiaobang/tool-results/**`：超长工具结果的完整落盘位置，只服务于防止工具结果直接进入模型上下文。

运行时大致顺序：

```text
普通 run
  写入本次 user message
  可选：直接斜杠工具先执行一次
  autoCompactIfNeeded()
  runPiLoop()

/compact
  创建 run
  compactSessionHistory()
  run_end
```

---

## 2. 手动压缩 `/compact`

当用户输入严格等于 `/compact` 时，`AgentRunner.stream()` 会把它当作元命令处理：

- 会创建一条 run 记录。
- 不会把 `/compact` 本身写成 user message。
- 不进入普通 agent loop。
- 直接调用 `runCompaction()`，内部复用 `compactSessionHistory()`。

### 2.1 可压缩消息

`compactableMessages()` 只压缩上一轮压缩指针之后的普通消息：

- 如果 session 已有 `compactedUpToMessageId`，只看它之后的消息。
- 跳过 `kind = "compaction_summary"` 的摘要消息。
- 保留最近 `4` 条消息不压缩，避免刚发生的上下文被过早折叠。

如果没有可压缩消息：

- 手动 `/compact` 会新增一条 assistant 提示：“当前对话内容较少，无需压缩。”
- run 以 `completed` 结束。
- 不更新 `compactedUpToMessageId`。
- 不调用总结模型。

### 2.2 摘要生成

压缩模型使用独立的 system prompt：“你是一个对话压缩器”。摘要要求保留：

- 用户目标与任务背景。
- 已经做出的决定和结论。
- 已创建/修改的文件及关键改动。
- 尚未解决的问题或待办事项。

构造压缩输入时，如果历史里已经有旧摘要，只取最新的 `compaction_summary` 放在输入最前面，避免多次压缩后丢失更早上下文。

工具消息在压缩输入里会转成普通 user 文本块：

```text
【工具结果】
...
```

### 2.3 落库与指针

模型输出非空摘要后：

- 新增一条 assistant message，`kind = "compaction_summary"`。
- `content` 保存摘要正文。
- `Session.compactedUpToMessageId` 更新为本次被压缩消息中的最后一条消息 id。
- 通过 `message` 事件把摘要消息推给前端。
- run 以 `completed` 结束，并记录摘要模型的 usage。

如果压缩过程中 abort，run 以 `aborted` 结束，不写摘要、不移动指针。

---

## 3. 自动压缩

普通 run 在真正进入 pi agent loop 前会调用 `autoCompactIfNeeded()`。当前顺序是：

1. provider、会话、工作目录等准备完成。
2. 写入本次 user message。
3. 如果是直接斜杠命令（如 `/read`、`/shell`），先执行一次工具并把结果写入历史。
4. 估算即将发送给模型的上下文。
5. 超过阈值时自动调用 `compactSessionHistory()`。
6. 用压缩后的上下文继续原本这次 run。

自动压缩与手动 `/compact` 的差异：

- 自动压缩不会新增“无需压缩”的提示消息。
- 自动压缩会先发一段 thinking delta：“当前上下文已接近模型上限，正在自动压缩较早对话...”
- 自动压缩的 usage 会与随后正常模型循环的 usage 合并到同一个 run 里。
- 如果自动压缩 abort，当前 run 直接以 `aborted` 结束。

---

## 4. 阈值与上下文估算

上下文估算由 `buildSessionContextUsage()` 完成，估算项包括：

- system prompt。
- 当前会传给模型的 messages。
- 当前阶段可见的工具定义。

估算方式是保守近似：

- CJK 字符按 1 token 估。
- 非 CJK 文本约按 4 字符 1 token 估。
- message 和 tool 会先稳定 JSON 化再估算。

自动压缩阈值来自模型上下文配置：

```text
autoCompactThresholdTokens = contextWindowTokens * autoCompactThresholdRatio
```

当前默认 `autoCompactThresholdRatio = 0.8`。例如 DeepSeek V4 系列上下文窗口配置为 `1,000,000` tokens，自动压缩阈值就是 `800,000` tokens。

状态判断：

- `ok`：低于阈值的 90%。
- `near_threshold`：达到阈值的 90%，但未达到阈值。
- `over_threshold`：达到或超过自动压缩阈值。
- `unknown`：模型没有可识别的 `contextWindowTokens`。

只有存在 `contextWindowTokens` 且估算值达到阈值时，才会自动压缩。未知窗口大小的模型不会自动压缩。

---

## 5. 上下文回放

后续 run 构造模型消息时由 `buildAgentMessages()` 读取持久化历史。

如果 session 有压缩指针：

- 找到最新的 `compaction_summary`。
- 把它提升为第一条 user message：

```text
【此前对话的摘要】
...
```

- 跳过 `compactedUpToMessageId` 及其之前的消息。
- 跳过所有 `kind = "compaction_summary"` 的原始行。
- 跳过 system 行。
- 指针之后的普通消息继续按原规则回放。

普通 pi 循环产生的 assistant/toolResult 行会带原始 `payload`，因此能无损回放工具调用对。直接斜杠命令产生的 tool 行没有配对 assistant toolCall，会作为普通 user 上下文回放：

```text
【工具结果】
...
```

---

## 6. 长工具结果保护

长工具结果保护不是摘要压缩，它发生得更早：工具执行结束后、结果进入下一轮模型上下文前。

当前策略：

- 单次工具文本结果不超过 `24KB`：原样进入上下文。
- 超过 `24KB`：完整结果写入工作区文件：

```text
.chengxiaobang/tool-results/<runId>/<toolCallId>-<toolName>.txt
```

- 返回给模型的内容替换为短摘要，包含：
  - 完整结果路径。
  - 完整结果字符数。
  - 开头预览。
  - 末尾预览。
  - 如何用 `read_file` 分段读取。
  - 如何用 `search` 搜索关键词。

这个保护同时覆盖：

- 模型请求的普通工具调用：通过 pi 的 `afterToolCall` 钩子保护。
- 直接斜杠命令工具调用：本地执行后手动保护。
- 工具错误结果：错误文本过长时也会落盘或降级为短预览。

如果落盘失败，也不会把完整长结果塞回模型；系统会记录错误日志，并只返回固定大小的开头/末尾预览。

### 6.1 分段读取

`read_file` 支持可选参数：

- `startLine`：从第几行开始，1 表示第一行。
- `lineLimit`：最多读取多少行。

默认不传这两个参数时，`read_file` 仍按旧行为读取完整文件。传入分段参数时会返回带行号的局部内容，并提示下一段可从哪个 `startLine` 继续读取。单次最多读取 `1000` 行。

---

## 7. 关键参数与边界

| 参数 | 当前值 | 说明 |
| --- | ---: | --- |
| 最近消息保留数 | `4` | 每次摘要压缩都会保留最后 4 条普通消息 |
| 默认自动压缩比例 | `0.8` | 达到模型窗口 80% 时触发自动压缩 |
| DeepSeek V4 窗口 | `1,000,000` tokens | 对应自动压缩阈值 `800,000` tokens |
| 长工具结果内联上限 | `24KB` | 超过后写入 `.chengxiaobang/tool-results/**` |
| 长工具结果预览 | 头尾各 `4KB` | 返回给模型的短摘要里包含开头和末尾预览 |
| `read_file` 分段上限 | `1000` 行 | 防止模型再次一次性读入过大文件 |

需要注意：

- 压缩不会删除消息，只影响模型上下文构造。
- 多次压缩只把最新摘要作为旧摘要输入。
- 自动压缩依赖模型上下文窗口配置，未知窗口大小时不会触发。
- 长工具结果落盘保护是防爆机制，不会生成语义摘要；模型需要按路径自行分段读取完整内容。

---

## 8. 验证点

相关测试覆盖：

- `apps/backend/test/compaction.test.ts`
  - 压缩 prompt 构造。
  - 旧摘要提升。
  - system 行跳过。
  - tool 行转为 `【工具结果】`。

- `apps/backend/test/context-usage.test.ts`
  - token 估算。
  - 模型窗口和 80% 阈值。
  - `over_threshold` 与自动压缩触发判断。

- `apps/backend/test/history.test.ts`
  - 最新 `compaction_summary` 提升为上下文第一条消息。
  - `compactedUpToMessageId` 之前的历史被隐藏。

- `apps/backend/test/agent-runner.test.ts`
  - 手动 `/compact` 不写入 user message。
  - 短会话跳过压缩且不调用模型。
  - 自动压缩在模型循环前触发。
  - 自动压缩 usage 与普通模型 usage 合并。
  - 长直接工具结果落盘后，模型上下文不包含完整长文本。

- `apps/backend/test/agent-loop.test.ts`
  - 模型请求工具产生的长结果会在下一轮模型调用前落盘并替换为短摘要。

建议文档相关变更后运行：

```bash
pnpm test apps/backend/test/compaction.test.ts apps/backend/test/context-usage.test.ts apps/backend/test/history.test.ts apps/backend/test/agent-runner.test.ts
```
