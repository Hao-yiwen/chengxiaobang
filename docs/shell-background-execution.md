# Shell 执行模式与后台命令

> 最后更新：2026-06-14

本文说明程小帮的 shell 工具执行模式。目标是在不长期卡住 agent run 的前提下，让模型可以按任务选择合适等待策略：默认异步模式短暂等待后转后台；后台模式立即释放工具调用；阻塞模式允许测试、构建等命令等待更久。完整输出落到工作区文件里，由模型按需读取、查询状态或主动终止。

---

## 1. 背景

模型经常会通过 `shell` 工具运行测试、构建、安装依赖或调试脚本。这类命令有两个问题：

- 有些命令本来就很慢，工具调用如果一直同步等待，会让本次 agent run 长时间没有反馈。
- 有些命令可能卡住或持续运行，用户和模型都需要一个明确方式把它停掉。

因此 `shell` 工具采用显式 `mode` 策略：

- `mode: "async"`：默认模式，前台最多等待 **15 秒**；超过后返回后台命令信息，模型继续下一步决策。
- `mode: "background"`：命令启动后立即转入后台，适合 dev server、watcher、监听进程等没有明确结束点的任务。
- `mode: "blocking"`：前台按 `waitMs` 等待更久，默认 **120 秒**，最大 **300 秒**；超过等待窗口后不强杀命令，而是转后台继续执行。

---

## 2. 运行流程

`shell`、`git_status`、`git_diff` 都通过同一条 shell 工具执行链路运行：

```text
模型/斜杠命令调用 shell
        │
        ▼
runShellCommand(command, cwd)
        │
        ├─ mode=background
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

`mode` 只决定本次工具调用等待多久，不决定命令是否被强制终止。除了用户中止 run 或模型主动调用 `shell_cancel`，慢命令在等待窗口结束后会继续作为后台命令运行。

前台阶段命令完成时，模型会直接拿到命令输出。如果退出码非 0，`shell-tools.ts` 会把输出作为错误抛给 pi，pi 再把它变成错误工具结果喂回模型。

后台阶段工具结果不会再等待进程结束，只会提示模型：

- 用 `read_file` 读取输出文件。
- 用 `shell_status` 查看命令是否结束。
- 如果命令没有进展、卡住或不再需要，用 `shell_cancel` 终止。

---

## 3. 输出落盘

每次 `runShellCommand()` 都会为命令创建一个输出文件：

```text
.chengxiaobang/shell-outputs/<shell_id>.log
```

其中 `<shell_id>` 当前形如 `shell_<uuid>`。输出文件位于本次工作区内，`shell` 工具返回给模型的是相对路径，例如：

```text
.chengxiaobang/shell-outputs/shell_1d2e3f.log
```

stdout 和 stderr 会按产生顺序写入同一个文件。命令转后台后，后续输出仍会持续追加到这个文件；模型应该使用 `read_file` 分段查看，例如从第 1 行读取 200 行。

这个输出文件同时服务两个目的：

- 避免长输出直接塞进工具结果，撑大模型上下文。
- 即使命令已经转入后台，模型也能继续观察真实执行结果。

---

## 4. 工具接口

### `shell`

在当前工作目录执行任意 shell 命令。它是 mutating 工具，在审批模式下需要用户确认。

参数：

```json
{
  "command": "pnpm test",
  "mode": "blocking",
  "waitMs": 120000
}
```

参数说明：

- `command`：必填，要执行的 shell 命令。
- `cwd`：可选，命令工作目录；可为相对当前工作目录的路径或显式绝对路径。
- `mode`：可选，`"async"`、`"background"` 或 `"blocking"`，默认 `"async"`。
- `waitMs`：可选，仅 `mode="blocking"` 时生效；默认 120000，最大 300000，单位毫秒。

行为：

- `mode="async"`：15 秒内结束则直接返回命令输出；超过 15 秒返回后台命令 ID、PID、输出文件路径和后续操作提示。
- `mode="background"`：启动后立即返回后台命令 ID、PID、输出文件路径和后续操作提示。
- `mode="blocking"`：在 `waitMs` 内结束则直接返回命令输出；超过 `waitMs` 返回后台命令信息，命令继续执行。
- 前台等待期间收到 run abort：终止进程组并返回中止结果。

### `git_status` / `git_diff`

这两个工具仍然是 read-only 工具，但底层同样走 shell 执行链路：

- `git_status` 执行 `git status --short --branch`。
- `git_diff` 执行 `git diff --stat && git diff --check`。

通常它们会在 15 秒内完成；如果遇到异常慢的仓库或文件系统，也会转入后台并返回输出文件路径。

### `shell_status`

查看已转入后台的 shell 命令状态。参数：

```json
{ "id": "shell_xxx" }
```

返回信息包括：

- 后台命令 ID。
- 状态：`running`、`completed`、`failed` 或 `aborted`。
- 输出文件路径。
- PID。
- 退出码、结束时间或错误信息（如果已有）。

`shell_status` 只查询当前 backend 进程内记录的后台命令；如果 backend 重启，旧命令记录会丢失。

### `shell_cancel`

终止仍在后台运行的 shell 命令。参数：

```json
{ "id": "shell_xxx" }
```

它只作用于 `shell` 工具返回的后台命令 ID，不接受任意 PID。终止时会先发 `SIGTERM`，若短时间内没有退出，再升级为 `SIGKILL`。

如果命令已经结束，`shell_cancel` 会返回当前快照，不会重复杀进程。

---

## 5. 中止与终止语义

前台阶段和后台阶段的中止语义不同：

- **前台阶段**：run 的 `AbortSignal` 仍然绑定在命令上。用户中止 run 时，shell 进程组会被终止，本次工具调用返回中止结果。
- **后台阶段**：命令已经从本次工具调用释放，run 不再继续等待它；此时需要模型或用户通过 `shell_cancel` 主动终止。

在 macOS/Linux 上，shell 命令以独立进程组启动，终止时优先对进程组发信号，避免只杀掉外层 shell 后留下子进程。Windows 上优先通过 `taskkill /PID <pid> /T /F` 清理进程树，失败时再回退到子进程终止。

---

## 6. 状态生命周期

后台命令记录保存在 backend 进程内存中，状态随子进程事件更新：

| 状态 | 含义 |
|---|---|
| `running` | 命令仍在后台执行，输出文件可能继续增长 |
| `completed` | 命令正常退出，退出码为 0 |
| `failed` | 命令已退出但退出码非 0，或启动失败 |
| `aborted` | 命令被 run abort 或 `shell_cancel` 终止 |

后台命令结束后，记录仍保留在当前 backend 进程内，模型可以继续用 `shell_status` 查询最终状态并读取输出文件。

---

## 7. 当前限制

- 后台命令状态只保存在当前 backend 进程内，不做数据库持久化。
- backend 重启后，旧输出文件仍在工作区里，但旧后台命令无法再通过 `shell_status` 查询，也无法通过 `shell_cancel` 终止。
- 输出文件不做自动清理；后续如需要，可以单独设计工作区缓存清理策略。
- `shell_status` / `shell_cancel` 是 read-only 审批分类，因为它们只能作用于应用自己创建的后台命令 ID，不能直接执行任意 shell 命令。

---

## 8. 相关实现

- `apps/backend/src/tools/shell.ts`：进程启动、等待窗口结束后转后台、输出落盘、状态记录、进程组终止。
- `apps/backend/src/tools/shell-tools.ts`：pi 工具封装、`mode` / `waitMs` 参数归一化、后台提示文案、`shell_status` / `shell_cancel`。
- `packages/shared/src/tool.ts`：内置工具名契约。
- `apps/backend/src/agent/system-prompt.ts`：提示模型如何读取后台输出、查询状态和取消慢命令。
