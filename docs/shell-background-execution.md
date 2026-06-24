# Shell 执行与后台命令

> 最后更新：2026-06-24（合并为单一 Shell 工具）

本文说明程小帮唯一的命令工具 `Shell` 如何执行本机命令并管理后台任务。模型不再选择具体 shell 品牌；后端按平台自动选择本机命令运行器。模型只需要写当前系统可执行的本机命令。

---

## 1. 背景

模型经常需要运行测试、构建、依赖安装或调试脚本。这类命令有两个问题：

- 有些命令本来就很慢，工具调用如果一直同步等待，会让本次 agent run 长时间没有反馈。
- 有些命令可能卡住或持续运行，用户和模型都需要一个明确方式把它停掉。

因此 `Shell action=run` 有三种等待方式：

- 默认不传 `timeout`：前台最多等待 **15000ms**；超过后返回后台命令信息，模型继续下一步决策。
- `run_in_background=true`：命令启动后立即转入后台，适合 dev server、watcher、监听进程等没有明确结束点的任务。
- `timeout`：前台按指定毫秒数等待，最大 **600000ms**；超过等待窗口后不强杀命令，而是转后台继续执行。

---

## 2. 工具接口

### `Shell action=run`

在当前工作目录执行命令：

```json
{
  "action": "run",
  "command": "pnpm test",
  "timeout": 120000,
  "description": "运行测试"
}
```

参数说明：

- `command`：必填，要执行的本机命令。
- `timeout`：可选，前台等待毫秒数，最大 600000；超过后转后台继续执行。
- `description`：可选，本次命令的简短说明，仅用于展示和日志。
- `run_in_background`：可选，`true` 时命令启动后立即转后台。
- `dangerouslyDisableSandbox`：可选，仅为 schema 对齐保留，不会绕过审批和安全规则。

### `Shell action=status`

查看已转入后台的命令状态：

```json
{
  "action": "status",
  "id": "shell_xxx"
}
```

返回信息包括后台命令 ID、状态、输出文件路径、PID、退出码、结束时间或错误信息。

### `Shell action=cancel`

终止仍在后台运行的命令：

```json
{
  "action": "cancel",
  "id": "shell_xxx"
}
```

它只作用于 `Shell` 返回的后台命令 ID，不接受任意 PID。如果命令已经结束，会返回当前快照，不会重复杀进程。

---

## 3. 运行流程

```text
模型调用 Shell action=run
        │
        ▼
runShellCommand(command, cwd)
        │
        ├─ run_in_background=true
        │    └─ 立即返回后台命令 ID、PID、输出文件路径
        │
        ├─ 前台等待窗口内结束
        │    └─ 返回 stdout/stderr、退出码与输出文件路径
        │
        └─ 超过前台等待窗口仍未结束
             ├─ 命令继续在后台运行
             ├─ stdout/stderr 持续写入输出文件
             └─ 工具结果返回后台命令 ID、PID、输出文件路径
```

`timeout` / `run_in_background` 只决定本次工具调用等待多久，不决定命令是否被强制终止。除了用户中止 run 或模型主动调用 `Shell action=cancel`，慢命令在等待窗口结束后会继续作为后台命令运行。

前台阶段命令完成时，模型会直接拿到命令输出。如果退出码非 0，`shell-tools.ts` 会把输出作为错误抛给 pi，pi 再把它变成错误工具结果喂回模型。

后台阶段工具结果不会再等待进程结束，只会提示模型：

- 用 `Read` 读取输出文件。
- 用 `Shell action=status` 查看命令是否结束。
- 如果命令没有进展、卡住或不再需要，用 `Shell action=cancel` 终止。

---

## 4. 输出落盘

每次 `runShellCommand()` 都会为命令创建一个输出文件：

```text
<dataDir>/shell-outputs/<runId>/<shell_id>.log
```

其中 `<runId>` 是本次 agent run，`<shell_id>` 当前形如 `shell_<uuid>`。`dataDir` 默认是 `~/.chengxiaobang/data`，`Shell` 返回给模型的是可直接交给 `Read` 的绝对路径，例如：

```text
~/.chengxiaobang/data/shell-outputs/run_abc123/shell_1d2e3f.log
```

stdout 和 stderr 会按产生顺序写入同一个文件。命令转后台后，后续输出仍会持续追加到这个文件；模型应该使用 `Read` 分段查看，例如从第 1 行读取 200 行。

---

## 5. 中止与终止语义

- **前台阶段**：run 的 `AbortSignal` 仍然绑定在命令上。用户中止 run 时，shell 进程组会被终止，本次工具调用返回中止结果。
- **后台阶段**：命令已经从本次工具调用释放，run 不再继续等待它；此时需要模型或用户通过 `Shell action=cancel` 主动终止。

在 macOS/Linux 上，shell 命令以独立进程组启动，终止时优先对进程组发信号，避免只杀掉外层 shell 后留下子进程。Windows 上优先通过 `taskkill /PID <pid> /T /F` 清理进程树，失败时再回退到子进程终止。

---

## 6. 状态生命周期

后台命令记录保存在 backend 进程内存中，状态随子进程事件更新：

| 状态 | 含义 |
|---|---|
| `running` | 命令仍在后台执行，输出文件可能继续增长 |
| `completed` | 命令正常退出，退出码为 0 |
| `failed` | 命令已退出但退出码非 0，或启动失败 |
| `aborted` | 命令被 run abort 或 `Shell action=cancel` 终止 |

后台命令结束后，记录仍保留在当前 backend 进程内，模型可以继续用 `Shell action=status` 查询最终状态并读取输出文件。

---

## 7. 审批与限制

- `Shell action=run` 会按命令内容做风险分级：常规只读命令可直接执行，危险命令会要求审批或被智能审批拒绝。
- `Shell action=status` / `Shell action=cancel` 只作用于应用自己创建的后台命令 ID，不能直接执行任意命令。
- 后台命令状态只保存在当前 backend 进程内，不做数据库持久化。
- backend 重启后，旧输出文件仍在 `dataDir`，但旧后台命令无法再查询或终止。
- 输出文件不做自动清理；后续如需要，可以单独设计缓存清理策略。

---

## 8. 相关实现

- `apps/backend/src/tools/shell.ts`：进程启动、等待窗口结束后转后台、输出落盘、状态记录、进程组终止。
- `apps/backend/src/tools/shell-tools.ts`：`Shell` pi 工具封装、`timeout` / `run_in_background` 参数归一化、平台运行器选择（Windows 内部走 PowerShell）、后台提示文案、状态查询和取消。
- `packages/shared/src/tool.ts`：内置工具名契约和展示/审批元数据。
