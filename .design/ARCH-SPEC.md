# 程小帮升级最终架构规格书

> 本文是可直接照着实现的定稿规格。基于获胜提案（0 号「贴合派」），融合评委指定的全部嫁接亮点，修正评委指出的全部问题。
> 所有行号以 `main` 分支当前代码为准（commit b308bf3 附近），实现时以语义定位为准、行号为辅。

---

## 0. 设计总纲

**一次泛化，五个功能。** 计划模式、ask-user、btw 本质都是「工具调用 + 用户交互」的变体；skills 强化与多模型是既有机制的字段级延伸。本规格只做一处机制性改动——把 `ApprovalQueue` 的决议从 `boolean` 泛化为带 payload 的 `ApprovalDecision` 对象，其余功能全部以「新工具 + 现有事件」长在缝隙里。

核心不变量：

1. **新增 StreamEvent 类型数量：0。** 仅做两处字段/形式级扩展：`run_started` 增加可选 `providerId`/`model` 字段（旧客户端忽略未知字段）；整个 StreamEvent 联合 Zod 化为 `streamEventSchema`（类型从 schema 推导，运行时行为不变，测试可对每个事件做 `parse` 断言）。
2. **零新表、零新队列。** 计划/问答/旁注的完整状态由 `tool_calls` 表推导（纯函数 `derivePlanState`），天然持久化、天然跨重载恢复（`loadSessionDetail` 已重建 toolHistory）、天然出现在时间线。
3. **零新阻塞通道。** 问答与计划确认共享 `POST /api/approvals/:toolCallId`；abort/early-decision/SSE 心跳（app.ts:154-160）全部复用。
4. **工具可见性按通道/阶段裁剪**（嫁接项 1、2）：新建纯函数 `selectToolDefinitions({ planPhase, viaFeishu })`，飞书通道剔除 `propose_plan`/`ask_user`（修复飞书 full_access 死锁——feishu-service.ts:165 在 fullAccess 分支不消费 `tool_call_pending`，无人 decide 即永久挂起）；计划起草阶段只暴露只读工具 + `propose_plan` + `ask_user`，模型看不到写类工具就不会浪费轮次去试。
5. **决议按工具名校验**（评委修正 4）：`normalizeDecision(toolName, decision)` 纯函数，杜绝误发/恶意 payload 静默通过。
6. **日志**（全局规约）：每个等待/决议/状态变更/模型选择点都要有含上下文（runId、toolCallId、stepId、模型名等）的 console 日志。

新增工具名 5 个：`propose_plan`、`update_plan`、`ask_user`、`btw`、`use_skill`。它们只是流过既有的 `tool_call_pending` / `tool_call_started` / `tool_result` 三件套。

---

## 1. M0 地基（串行先行，单独合并）

### 1.1 shared 契约最终定稿

文件：`packages/shared/src/index.ts`（改）+ `packages/shared/src/plan.ts`（新，由 index.ts re-export）。

#### 1.1.1 toolNameSchema（:123-140 替换）

```ts
export const toolNameSchema = z.enum([
  "read_file",
  "write_file",
  "edit_file",
  "list_directory",
  "shell",
  "git_status",
  "git_diff",
  "glob",
  "search",
  "make_directory",
  "fetch_url",
  "create_pptx",
  "create_docx",
  "create_xlsx",
  "feishu_send_message",
  // —— 本期新增 ——
  "propose_plan",
  "update_plan",
  "ask_user",
  "btw",
  "use_skill"
]);
export type ToolName = z.infer<typeof toolNameSchema>;
```

#### 1.1.2 交互载荷 schema（放在 :206 approvalDecisionSchema 处，替换原定义）

```ts
/** 计划中的一个步骤。状态机见 plan.ts 中 derivePlanState 的注释。 */
export const planStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "skipped"]).default("pending"),
  detail: z.string().optional()
});
export type PlanStep = z.infer<typeof planStepSchema>;

/** ask_user 的用户回答：选项与自由文字至少给一个。 */
export const askUserAnswerSchema = z
  .object({
    optionLabel: z.string().min(1).optional(),
    text: z.string().optional()
  })
  .refine((a) => Boolean(a.optionLabel) || Boolean(a.text?.trim()), {
    message: "必须提供选项或文字回答"
  });
export type AskUserAnswer = z.infer<typeof askUserAnswerSchema>;

/**
 * 泛化后的审批决议。向后兼容：新字段全 optional，老客户端发 {approved} 照常工作。
 * 字段对工具的有效性由 backend 的 normalizeDecision 按工具名裁决（见 §1.3）：
 * - editedSteps 仅对 propose_plan 生效；
 * - answer 仅对 ask_user 生效，且 approved:true 时必填（缺失视为拒绝）；
 * - 普通审批携带多余 payload 时忽略并告警。
 */
export const approvalDecisionSchema = z.object({
  approved: z.boolean(),
  editedSteps: z.array(planStepSchema).optional(),
  answer: askUserAnswerSchema.optional()
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
```

#### 1.1.3 新工具的参数 schema（两端共用解析；紧随其后追加）

```ts
export const proposePlanArgsSchema = z.object({
  title: z.string().min(1),
  steps: z.array(planStepSchema).min(1).max(20)
});
export type ProposePlanArgs = z.infer<typeof proposePlanArgsSchema>;

export const updatePlanArgsSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(["in_progress", "completed", "skipped"]),
  note: z.string().optional()
});
export type UpdatePlanArgs = z.infer<typeof updatePlanArgsSchema>;

export const askUserArgsSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).max(4).optional(),
  allowFreeText: z.boolean().default(true)
});
export type AskUserArgs = z.infer<typeof askUserArgsSchema>;

export const btwArgsSchema = z.object({
  note: z.string().min(1),
  suggestion: z.string().optional()
});
export type BtwArgs = z.infer<typeof btwArgsSchema>;

export const useSkillArgsSchema = z.object({
  name: z.string().min(1)
});
export type UseSkillArgs = z.infer<typeof useSkillArgsSchema>;
```

#### 1.1.4 RunRequest / Session（:197-204、:54-74、:84-89 修改）

```ts
export const runRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).nullable().optional(),
  prompt: z.string().min(1),
  providerId: z.string().min(1).optional(),
  accessMode: accessModeSchema.default("approval"),
  /** run 级开关：先计划、经用户确认、再动手。不落 session 列。 */
  planMode: z.boolean().default(false),
  /** run 级模型覆盖；解析优先级 run > session > provider 默认。 */
  model: z.string().min(1).optional()
});
```

`sessionSchema` 增加一行（feishuChatId 之后）：

```ts
  /** 会话级模型记忆；为空时用 provider.model。 */
  model: z.string().min(1).optional(),
```

`sessionUpdateSchema` 增加一行：

```ts
  model: z.string().min(1).nullable().optional(),
```

> **决策**：不做 `providers.models` 持久列、不做设置页 models 编辑 UI（嫁接项 6，砍掉 speculative 配置）。模型列表实时拉取（§6）。

#### 1.1.5 StreamEvent Zod 化 + run_started 字段扩展（:271-284 替换）

```ts
export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run_started"),
    runId: z.string(),
    sessionId: z.string(),
    /** 本轮实际生效的 provider/model 回执（嫁接项 5）。旧客户端忽略即可。 */
    providerId: z.string().optional(),
    model: z.string().optional()
  }),
  z.object({ type: z.literal("user_message"), runId: z.string(), message: messageSchema }),
  z.object({ type: z.literal("assistant_delta"), runId: z.string(), delta: z.string() }),
  z.object({ type: z.literal("thinking_delta"), runId: z.string(), delta: z.string() }),
  z.object({ type: z.literal("tool_call_pending"), runId: z.string(), toolCall: toolCallSchema }),
  z.object({ type: z.literal("tool_call_started"), runId: z.string(), toolCall: toolCallSchema }),
  z.object({ type: z.literal("tool_result"), runId: z.string(), toolCall: toolCallSchema }),
  z.object({ type: z.literal("assistant_done"), runId: z.string(), message: messageSchema }),
  z.object({
    type: z.literal("run_completed"),
    runId: z.string(),
    usage: tokenUsageSchema.optional()
  }),
  z.object({ type: z.literal("run_error"), runId: z.string(), error: z.string() }),
  z.object({ type: z.literal("run_aborted"), runId: z.string() })
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;
export type StreamEventType = StreamEvent["type"];
```

`encodeSseEvent` / `parseSseChunk` 零改动（对 type 完全泛化）。`parseSseChunk` 维持「不校验、直接 cast」的向前兼容行为；schema 校验是测试与消费方的可选动作，不进热路径。

#### 1.1.6 `packages/shared/src/plan.ts`（新文件，index.ts 末尾 `export * from "./plan";`）

计划状态由 tool_calls 推导的唯一权威实现，backend（跨 run 恢复）与 renderer（渲染）共用（评委修正 3/5、嫁接项 8）：

```ts
import type { PlanStep, ToolCall } from "./index";
import { planStepSchema, proposePlanArgsSchema, updatePlanArgsSchema } from "./index";

export interface PlanState {
  /** 锚点 propose_plan 的 toolCallId。 */
  toolCallId: string;
  title: string;
  steps: PlanStep[];
  /** 是否经用户确认（锚点 status === "completed"）。 */
  confirmed: boolean;
  /** 所有步骤均为 completed/skipped。 */
  finished: boolean;
}

/**
 * 计划生命周期状态机（代码内协议，勿凭口头约定实现）：
 *
 *   propose_plan(pending_approval) --用户确认(可携带 editedSteps，先写回 args 再置 completed)--> confirmed
 *   propose_plan(pending_approval) --用户否决--> rejected（模型可重新 propose_plan，视为全新计划）
 *   confirmed --update_plan(stepId,status) 逐步叠放--> executing --全部 completed/skipped--> finished
 *
 * 推导规则：
 * - 锚点 = 按 createdAt 最后一个 status==="completed" 的 propose_plan；
 *   不存在 completed 锚点时，回退到最后一个 propose_plan（pending/rejected，confirmed=false）。
 * - 锚点之后（createdAt 晚于锚点）的 status==="completed" 的 update_plan 按时间顺序叠放到 steps；
 * - 驳回后重新 propose_plan 即产生新锚点，旧计划自然失效（append-only，无重入歧义）。
 */
export function derivePlanState(toolCalls: ToolCall[]): PlanState | undefined {
  const proposals = toolCalls
    .filter((tc) => tc.name === "propose_plan")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (proposals.length === 0) return undefined;
  const anchor =
    [...proposals].reverse().find((tc) => tc.status === "completed") ??
    proposals[proposals.length - 1];

  const parsedArgs = proposePlanArgsSchema.safeParse(anchor.args);
  if (!parsedArgs.success) return undefined;
  const steps: PlanStep[] = parsedArgs.data.steps.map((s) => planStepSchema.parse(s));

  for (const tc of toolCalls
    .filter(
      (t) =>
        t.name === "update_plan" &&
        t.status === "completed" &&
        t.createdAt.localeCompare(anchor.createdAt) >= 0 &&
        t.id !== anchor.id
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const upd = updatePlanArgsSchema.safeParse(tc.args);
    if (!upd.success) continue;
    const step = steps.find((s) => s.id === upd.data.stepId);
    if (step) step.status = upd.data.status;
  }

  const confirmed = anchor.status === "completed";
  const finished =
    confirmed && steps.every((s) => s.status === "completed" || s.status === "skipped");
  return { toolCallId: anchor.id, title: parsedArgs.data.title, steps, confirmed, finished };
}
```

完成后执行 `pnpm build`（shared 必须先建）。

### 1.2 ApprovalQueue 泛化

文件：`apps/backend/src/agent/approval-queue.ts`（全文重写，约 60 行）：

```ts
import type { ApprovalDecision, ToolName } from "@chengxiaobang/shared";

export class ApprovalQueue {
  private readonly pending = new Map<string, (decision: ApprovalDecision) => void>();
  private readonly earlyDecisions = new Map<string, ApprovalDecision>();

  wait(toolCallId: string, signal: AbortSignal): Promise<ApprovalDecision> {
    if (this.earlyDecisions.has(toolCallId)) {
      const decision = this.earlyDecisions.get(toolCallId) ?? { approved: false };
      this.earlyDecisions.delete(toolCallId);
      console.log(`[approval-queue] 早到决议命中 toolCallId=${toolCallId} approved=${decision.approved}`);
      return Promise.resolve(decision);
    }
    return new Promise((resolve) => {
      const onAbort = (): void => {
        this.pending.delete(toolCallId);
        console.log(`[approval-queue] 等待被中止 toolCallId=${toolCallId}`);
        resolve({ approved: false });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(toolCallId, (decision) => {
        signal.removeEventListener("abort", onAbort);
        resolve(decision);
      });
    });
  }

  decide(toolCallId: string, decision: ApprovalDecision): boolean {
    console.log(
      `[approval-queue] 收到决议 toolCallId=${toolCallId} approved=${decision.approved}` +
        `${decision.answer ? " 含answer" : ""}${decision.editedSteps ? ` 含editedSteps(${decision.editedSteps.length})` : ""}`
    );
    const resolve = this.pending.get(toolCallId);
    if (!resolve) {
      this.earlyDecisions.set(toolCallId, decision);
      return true;
    }
    this.pending.delete(toolCallId);
    resolve(decision);
    return true;
  }
}
```

### 1.3 决议合法性校验 normalizeDecision（评委修正 4）

同文件 `approval-queue.ts` 追加导出纯函数（便于直测）：

```ts
/** 按工具名裁决 payload 有效性，杜绝误发/恶意 payload 静默通过。 */
export function normalizeDecision(name: ToolName, decision: ApprovalDecision): ApprovalDecision {
  if (name === "ask_user") {
    if (decision.approved && !decision.answer) {
      console.warn(`[approval-queue] ask_user 决议缺少 answer，按拒绝处理`);
      return { approved: false };
    }
    return { approved: decision.approved, answer: decision.answer };
  }
  if (name === "propose_plan") {
    // editedSteps 已在路由层过 approvalDecisionSchema（含逐项 planStepSchema），此处仅裁剪无关字段。
    return { approved: decision.approved, editedSteps: decision.editedSteps };
  }
  if (decision.answer || decision.editedSteps) {
    console.warn(`[approval-queue] 工具 ${name} 的决议携带无关 payload，已忽略`);
  }
  return { approved: decision.approved };
}
```

`runDirectTool`（agent-runner.ts:290）与 `runModelTool`（:533）的两处 `await this.approvals.wait(...)` 全部改为：

```ts
const decision = normalizeDecision(name, await this.approvals.wait(initial.id, controller.signal));
if (!decision.approved) { /* 既有拒绝路径 */ }
```

### 1.4 门控统一 requiresUserGate

文件：`apps/backend/src/tools/tool-schemas.ts`（:336-338 替换；MUTATING_TOOLS 不变）：

```ts
/** 即使 full_access 也必须等用户的工具（提问/计划确认本质就是等人）。 */
export const ALWAYS_GATED_TOOLS = new Set<ToolName>(["propose_plan", "ask_user"]);

export function requiresUserGate(name: ToolName, accessMode: AccessMode): boolean {
  if (ALWAYS_GATED_TOOLS.has(name)) return true;
  return MUTATING_TOOLS.has(name) && accessMode === "approval";
}

/** @deprecated 仅为兼容保留一版，M0 内将两处调用点切到 requiresUserGate 后删除。 */
export function requiresApproval(name: ToolName): boolean {
  return MUTATING_TOOLS.has(name);
}
```

调用点替换：agent-runner.ts:273 与 :521 的 `requiresApproval(name) && accessMode === "approval"` → `requiresUserGate(name, accessMode)`。完成后删除 `requiresApproval` 及 tool-executor.ts:9/:11 的 re-export（连同 import）。

> 安全性论证：飞书通道永远见不到 ALWAYS_GATED 工具（§1.5 裁剪），桌面端 SSE 心跳保证无限等待不掉线，abort 经 AbortSignal resolve `{approved:false}`。

### 1.5 工具目录函数化 selectToolDefinitions（嫁接项 1、2）

新文件：`apps/backend/src/tools/tool-catalog.ts`：

```ts
import { TOOL_DEFINITIONS, type ToolDefinition } from "./tool-schemas";

export type PlanPhase = "none" | "draft" | "execute";

const READ_ONLY_TOOLS = new Set([
  "list_directory", "read_file", "glob", "search", "git_status", "git_diff", "fetch_url"
]);
/** 起草阶段额外可见：提计划、提问、旁注、按需取技能。 */
const DRAFT_EXTRA = new Set(["propose_plan", "ask_user", "btw", "use_skill"]);

/**
 * 按阶段/通道裁剪模型可见的工具表（纯函数，直接单测）：
 * - viaFeishu：剔除 propose_plan 与 ask_user —— 飞书 full_access 分支不消费
 *   tool_call_pending（feishu-service.ts:165），暴露阻塞型工具必死锁；read-only
 *   分支会把提问自动拒绝，语义错乱。计划模式不对飞书通道开放（飞书 RunRequest
 *   不带 planMode，默认 false）。
 * - draft（planMode 且计划未确认）：只读工具 + propose_plan/ask_user/btw/use_skill。
 *   模型根本看不到写类工具，不浪费轮次去试；不依赖 DeepSeek 兼容端点会忽略的
 *   forced tool_choice。runModelTool 的 planConfirmed 门是第二道防线（§2.3-4）。
 * - execute（计划已确认）：全量 + update_plan，不再含 propose_plan（重提计划须先被驳回，
 *   驳回会使阶段回到 draft）。
 * - none：全量，但不含 propose_plan/update_plan（非计划模式没有计划工具）。
 */
export function selectToolDefinitions(opts: {
  planPhase: PlanPhase;
  viaFeishu: boolean;
}): ToolDefinition[] {
  const visible = (name: string): boolean => {
    if (opts.viaFeishu && (name === "propose_plan" || name === "ask_user")) return false;
    switch (opts.planPhase) {
      case "draft":
        return READ_ONLY_TOOLS.has(name) || DRAFT_EXTRA.has(name);
      case "execute":
        return name !== "propose_plan";
      case "none":
        return name !== "propose_plan" && name !== "update_plan";
    }
  };
  return TOOL_DEFINITIONS.filter((def) => visible(def.function.name));
}
```

`tool-schemas.ts` 需导出 `ToolDefinition` 类型（现有 TOOL_DEFINITIONS 的元素类型）。agent-runner.ts:382 的 `tools: TOOL_DEFINITIONS` 改为每轮迭代计算：`tools: selectToolDefinitions({ planPhase, viaFeishu: context.viaFeishu ?? false })`（planPhase 求值见 §2.3）。

### 1.6 评委指出的两处漏报（M0 内必改）

1. **`apps/backend/src/api/app.ts:204-210`**：原文「路由零改动」是错的，现代码 `decide(approvalMatch[1], decision.approved)` 只传布尔。改为透传整个对象：

```ts
const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
if (approvalMatch && request.method === "POST") {
  const decision = approvalDecisionSchema.parse(await readJson<unknown>(request));
  return jsonResponse({
    accepted: options.runner.approvals.decide(approvalMatch[1], decision)
  });
}
```

2. **`apps/backend/src/feishu/feishu-service.ts:168`**：`decide(event.toolCall.id, false)` 在签名泛化后编译即破，改为 `decide(event.toolCall.id, { approved: false })`。

### 1.7 M0 renderer 接线

- `apps/desktop/src/renderer/lib/api.ts`：接口（:45）与实现（:185-189）改为 `approve(toolCallId: string, decision: ApprovalDecision): Promise<void>`，body 直接 `JSON.stringify(decision)`。
- `apps/desktop/src/renderer/store/index.ts`：`approve` 动作（:153 类型、:820-822 实现）签名改为 `(toolCallId: string, decision: ApprovalDecision)` 透传。
- `apps/desktop/src/renderer/components/ChatView.tsx`：:139/:143 改为 `approve(pendingTool.id, { approved: true })` / `{ approved: false }`。

### 1.8 MAX_TOOL_ITERATIONS 上调（嫁接项 3）

agent-runner.ts:25：

```ts
// 计划模式下 propose_plan 往返、被驳回重提、每步 update_plan 都消耗轮次，
// 长计划在 25 轮内必撞 run_error，故上调到 40。
const MAX_TOOL_ITERATIONS = 40;
```

---

## 2. 功能一：计划模式（Plan Mode）

**设计**：计划 = 一次永远需要确认的工具调用（`propose_plan`，在 ALWAYS_GATED_TOOLS 中）；进度 = 后续 `update_plan` 调用；完整状态由 `derivePlanState(toolCalls)` 推导。不建表、不加事件、不加审批通道。

### 2.1 shared 契约

已在 §1.1 定稿：`planStepSchema`、`proposePlanArgsSchema`、`updatePlanArgsSchema`、`runRequestSchema.planMode`、`approvalDecisionSchema.editedSteps`、`plan.ts`。新增 StreamEvent：**无**。

### 2.2 工具定义（tool-schemas.ts TOOL_DEFINITIONS 尾部追加）

```ts
{
  type: "function",
  function: {
    name: "propose_plan",
    description:
      "提交一份分步计划给用户确认。计划模式下动手前必须先调用本工具。用户可能编辑步骤，以工具返回的最终版本为准。被否决后如需继续，须根据用户反馈重新调用本工具提交新计划（新计划完全替代旧计划）。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "计划标题，一句话" },
        steps: {
          type: "array",
          description: "1-20 个步骤，每步一句话",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "步骤唯一 id，如 s1、s2" },
              title: { type: "string" },
              detail: { type: "string" }
            },
            required: ["id", "title"]
          }
        }
      },
      required: ["title", "steps"]
    }
  }
},
{
  type: "function",
  function: {
    name: "update_plan",
    description: "更新已确认计划中某一步的状态。开始做某步时置 in_progress，完成置 completed，决定不做置 skipped。",
    parameters: {
      type: "object",
      properties: {
        stepId: { type: "string" },
        status: { type: "string", enum: ["in_progress", "completed", "skipped"] },
        note: { type: "string", description: "可选备注" }
      },
      required: ["stepId", "status"]
    }
  }
}
```

`update_plan` 非门控、非 mutating。

### 2.3 backend 改动地图

| 文件:位置 | 改动 |
|---|---|
| agent-runner.ts:131-144 | `runAgentLoop` context 增加 `planMode: input.planMode`、`project`（供 §5 use_skill 使用，一并加） |
| agent-runner.ts:340-348 | context 类型补 `planMode: boolean; project?: Project` |
| agent-runner.ts:351 之后（runAgentLoop 开头） | **跨 run 计划恢复（评委修正 5，选方案 a）**：`const loopState = { planConfirmed: false }; let planSnapshot: PlanState \| undefined;` 若 `context.planMode`：`planSnapshot = derivePlanState(await this.store.listToolCallsForSession(sessionId))`；若 `planSnapshot?.confirmed && !planSnapshot.finished` → `loopState.planConfirmed = true` 并记日志 `[agent-runner] 恢复已确认计划 ${planSnapshot.title}（${完成数}/${总数}）`。planSnapshot 传入 buildSystemPrompt |
| agent-runner.ts:366 循环体内 | 每轮求 `const planPhase: PlanPhase = !context.planMode ? "none" : loopState.planConfirmed ? "execute" : "draft";` |
| agent-runner.ts:378-384 | `tools: selectToolDefinitions({ planPhase, viaFeishu: context.viaFeishu ?? false })` |
| agent-runner.ts:459-473 | `runModelTool` 调用处把零散参数收拢为一个 `ToolRunContext` 对象：`{ workspacePath, accessMode, planMode, loopState, viaFeishu, project }`（**评委修正 3：planConfirmed 经可变 loopState 引用传入 runModelTool，runModelTool 内置 true 后 runAgentLoop 下一轮即生效**） |
| agent-runner.ts:488-495 | `runModelTool` 签名改收 `ToolRunContext`；入口处第二道防线：`if (ctx.planMode && !ctx.loopState.planConfirmed && MUTATING_TOOLS.has(name))` → 不执行、不发事件三件套之外的东西，insert 一条 status:"rejected" 的 ToolCall（result 为下述文本）、yield `tool_result`，返回结果文本 `"计划模式：请先通过 propose_plan 提交计划并获得用户确认，再执行写操作。"`（沿用「以结果文本纠偏模型」约定，不抛错不断流） |
| agent-runner.ts:531-551（runModelTool 决议返回处） | `name === "propose_plan"` 分支：决议 approved 且带 `editedSteps` 时，**先把 `toolCall.args = { ...args, steps: decision.editedSteps }` 写回并 `updateToolCall` 持久化**（保证 derivePlanState 推导与模型上下文一致），再置 status:"completed"、result 为 `JSON.stringify({ title, steps: 最终步骤 })`，`ctx.loopState.planConfirmed = true`，日志 `[agent-runner] 计划已确认 toolCallId=… steps=…`；否决时走既有拒绝路径，result 文本改为 `"用户否决了该计划，请根据用户反馈重新规划（重新调用 propose_plan）或先 ask_user 询问。"`。propose_plan 不经过 toolExecutor.execute（确认即结果），在 execute 前短路 |
| agent-context.ts:5-16 | `buildSystemPrompt` 入参加 `planMode?: boolean; planSnapshot?: PlanState`。planMode 时追加段落：`"当前为「计划模式」：动手前必须先调用 propose_plan 提交步骤清单（每步一句话），等待用户确认；用户可能修改步骤，以工具返回的最终版本为准；执行中开始/完成每一步都要调用 update_plan 更新状态。"`；存在已确认未完结的 planSnapshot 时追加 `"当前已确认的计划及进度如下（继续执行，勿重新提交）：" + 步骤清单文本` |
| tool-executor.ts:117 附近 | `update_plan` 分支：`updatePlanArgsSchema.parse(args)` 后返回 `已更新步骤 ${stepId} → ${status}${note ? "（" + note + "）" : ""}`，并记日志 `[tool-executor] update_plan runId 上下文 stepId status` |

**跨 run 语义定稿**（评委修正 5，方案 a）：planMode 由 renderer 持久化、随每个 RunRequest 传入；只要本会话存在「已确认且未完结」的计划，新 run 直接恢复 `planConfirmed=true` 并在 system prompt 注入计划现状，模型无需重新 propose_plan。计划完结（全部 completed/skipped）或被新 propose_plan 取代后，下一个 plan run 回到 draft 阶段。

**accessMode 正交性**（嫁接项 7）：计划被批准**不豁免**逐工具审批——approval 模式下 mutating 工具照样 `tool_call_pending` 等待。requiresUserGate 天然保证（planConfirmed 只控制「能不能执行」，不控制「要不要审批」），测试必须覆盖。

### 2.4 API

无新端点。确认/修改/否决全部走 `POST /api/approvals/:toolCallId`，body：

```jsonc
{ "approved": true, "editedSteps": [ { "id": "s1", "title": "…", "status": "pending" } ] }
// 或 { "approved": false }
```

### 2.5 renderer

| 文件 | 改动 |
|---|---|
| store/index.ts | state 加 `planMode: boolean`（初始 false）+ `setPlanMode(on: boolean)`；partialize（:906-915）持久化；`runPrompt`（:722-729 请求体）加 `planMode: state.planMode` |
| components/PlanApprovalCard.tsx（新） | props：`toolCall: ToolCall`、`onDecide(decision: ApprovalDecision): void`。用 `proposePlanArgsSchema.safeParse(toolCall.args)` 解析；步骤清单可编辑（改标题、删步、上下移）；「确认计划」→ `onDecide({ approved: true, editedSteps })`（仅在用户实际编辑过时携带 editedSteps）；「否决」→ `onDecide({ approved: false })` |
| components/PlanCard.tsx（新） | props：`plan: PlanState`。渲染标题 + 步骤逐项勾选态 + `已完成 m/n` 进度；纯展示组件 |
| ChatView.tsx:128-150 | pendingTool 分支前拦截：`pendingTool.name === "propose_plan"` → `<PlanApprovalCard toolCall={pendingTool} onDecide={(d) => approve(pendingTool.id, d)} />` |
| ChatView.tsx:112 + lib/timeline.ts | timeline 计算处：`update_plan` 的 tool 项过滤掉不单独渲染；`propose_plan` 的 tool 项渲染为 `<PlanCard plan={derivePlanState(toolHistory)!} />`（仅锚点那条渲染，其余 propose_plan 历史渲染为「已否决的计划」折叠行）。`derivePlanState` 从 `@chengxiaobang/shared` 导入 |
| Composer.tsx:379-433 旁 | 权限 DropdownMenu 旁加「计划模式」pill toggle（绑 store.planMode）；开启时 Composer 顶部细线提示「先计划再动手」 |

**残留 pending 渲染规则**（评委修正 6）：timeline 中 `status === "pending_approval"` 且 `toolCall.runId !== activeRunId` 的工具行（含 propose_plan/ask_user）一律渲染为**不可交互的终态卡**——propose_plan 显示「计划未确认（运行已结束）」、ask_user 显示「问题未回答（运行已结束）」、普通工具显示「未审批」。可交互卡只来源于活跃 run 的 `pendingTool` state。该规则实现于 ToolCallRow / PlanCard / AskUserCard 的历史态分支。

---

## 3. 功能二：ask-user

**设计**：`ask_user` 工具，进 ALWAYS_GATED_TOOLS（full_access 也必须等人）、不进 MUTATING_TOOLS；阻塞与应答完全复用泛化后的 ApprovalQueue 与 approvals 路由。答案即工具结果。

### 3.1 shared 契约

已在 §1.1 定稿：`askUserArgsSchema`、`askUserAnswerSchema`、`approvalDecisionSchema.answer`。新增 StreamEvent：**无**。

### 3.2 工具定义（TOOL_DEFINITIONS 追加）

```ts
{
  type: "function",
  function: {
    name: "ask_user",
    description:
      "当任务存在多个合理方向、缺少关键信息或需要用户做选择时，向用户提出一个结构化问题并等待回答。问题要具体，选项要互斥。",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "要问用户的问题" },
        options: { type: "array", items: { type: "string" }, description: "2-4 个候选答案" },
        allowFreeText: { type: "boolean", description: "是否允许用户自由输入，默认 true" }
      },
      required: ["question"]
    }
  }
}
```

### 3.3 backend 改动地图

| 文件:位置 | 改动 |
|---|---|
| agent-runner.ts runModelTool 决议返回处（:533-543 区域） | `name === "ask_user"` 分支：`decision.approved && decision.answer`（normalizeDecision 已保证成对出现）→ 短路不进 toolExecutor，`completed = { ...runnable, status: "completed", result: decision.answer.optionLabel ?? decision.answer.text!, updatedAt: nowIso() }`，updateToolCall + yield `tool_result`，结果文本即用户回答原文回喂模型；`!decision.approved` → 沿用拒绝路径，result/回喂文本改为 `"用户跳过了该问题，请基于现有信息继续，或换一种问法。"`。日志：提问内容摘要、回答/跳过 |
| tool-catalog.ts | 已覆盖（§1.5）：viaFeishu 时 ask_user 不可见——**修复飞书死锁**（评委修正 2） |

超时：**不设**（与审批语义一致，SSE 心跳保活）。取消：run abort → wait resolve `{approved:false}` → 拒绝路径 → `run_aborted`，零改动。早到决议：earlyDecisions 机制已覆盖。

### 3.4 API

复用 `POST /api/approvals/:toolCallId`，body：

```jsonc
{ "approved": true, "answer": { "optionLabel": "方案 A" } }
// 或 { "approved": true, "answer": { "text": "用我自己的话回答" } }
// 或 { "approved": false }   // 跳过
```

### 3.5 renderer

| 文件 | 改动 |
|---|---|
| components/AskUserCard.tsx（新） | props：`toolCall: ToolCall`、`onDecide(decision: ApprovalDecision): void`。`askUserArgsSchema.safeParse(toolCall.args)`；问题文本 + 选项按钮（点击即 `onDecide({ approved: true, answer: { optionLabel } })`）+ allowFreeText 时一行输入框与提交按钮（`answer: { text }`）+ 右上角「跳过」（`{ approved: false }`） |
| ChatView.tsx:128 | pendingTool 分支：`name === "ask_user"` → AskUserCard（活跃态） |
| components/ToolCallRow.tsx | 已完成的 ask_user 渲染为静态问答对（`问：{args.question} / 答：{result}`）；跳过态显示「用户跳过了该问题」；残留 pending 按 §2.5 规则显示「问题未回答（运行已结束）」 |

---

## 4. 功能三：btw 旁注

**设计**：独立工具，不用文本标记（跨 chunk 解析会污染 StreamingMarkdown 尾部修复逻辑且无结构化保证）。非 mutating、非门控，两种模式都直接执行。

### 4.1 shared 契约

已在 §1.1 定稿：`btwArgsSchema`。新增 StreamEvent：**无**。不扩 Message.kind。

### 4.2 工具定义（TOOL_DEFINITIONS 追加）

```ts
{
  type: "function",
  function: {
    name: "btw",
    description:
      "记录一条与当前任务无关但值得用户知道的旁注（顺便发现的问题、改进建议）。不要打断当前任务，简短一句话。",
    parameters: {
      type: "object",
      properties: {
        note: { type: "string", description: "旁注内容" },
        suggestion: { type: "string", description: "可选的后续行动建议" }
      },
      required: ["note"]
    }
  }
}
```

### 4.3 backend 改动地图

| 文件:位置 | 改动 |
|---|---|
| tool-executor.ts:117 附近 | `btw` 分支：`btwArgsSchema.parse(args)` 后即时返回 `"已记录旁注"` |
| agent-runner.ts:568-572（runModelTool 末尾） | `name === "btw"` 时**跳过 `addMessage({ role: "tool", … })` 落库**（"已记录旁注" 无信息量，且不应污染下轮 buildHistory 的【工具结果】折叠）。注意：本 run 内回填给模型协议的 `role:"tool"` modelMessage（runAgentLoop :468-472）照常 push——OpenAI 协议要求 tool_call 必须有配对 tool 结果，只是不持久化 |
| agent-context.ts:25-35 | 「工作方式」列表加一条：`"- 顺便发现与当前任务无关的问题或机会时，用 btw 工具记录一条简短旁注，不要中断手头任务，每个任务最多 2-3 条。"` |

事件与持久化：`tool_call_started` + `tool_result` 原样流动；tool_calls 表天然持久化；loadSessionDetail 重载即恢复。

### 4.4 API

无新端点。

### 4.5 renderer

| 文件 | 改动 |
|---|---|
| components/BtwCard.tsx（新） | props：`toolCall: ToolCall`、`onConvert(text: string): void`。便签态：窄幅、左侧细色条、muted token 的 faint 文本（不打断主流）；右侧「转为任务」按钮 → `onConvert(\`接下来：${note}${suggestion ? "（建议：" + suggestion + "）" : ""}\`)` |
| ChatView.tsx:119 | timeline tool 分支拦截 `toolCall.name === "btw"` → BtwCard，`onConvert` 接 `useAppStore.getState().setInput(text)` 并聚焦 Composer。一步到位、可追溯（旁注本体留在时间线），不另建任务存储 |

---

## 5. 功能四：skills 强化

**设计**：清单 API 复用 `/api/slash-commands`（不开 /api/skills）；模型自主发现 = system prompt 注入 name+description 清单 + `use_skill` 工具按需拉正文（上下文成本 O(技能数) 而非 O(正文总量)）。

### 5.1 shared 契约

已在 §1.1 定稿：`useSkillArgsSchema`、toolNameSchema 含 `use_skill`。新增 StreamEvent：**无**。`slashCommandSchema` 本期不动。

### 5.2 工具定义（TOOL_DEFINITIONS 追加）

```ts
{
  type: "function",
  function: {
    name: "use_skill",
    description:
      "加载一个技能的完整操作说明。当任务匹配系统提示中列出的某个技能时，先调用本工具拿到说明，再严格按说明操作。",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "技能名，如 excel" } },
      required: ["name"]
    }
  }
}
```

非门控、非 mutating。

### 5.3 backend 改动地图

| 文件:位置 | 改动 |
|---|---|
| slash-command-service.ts | 新增两个公开方法（loadResources 保持 private）：`async listSkills(project?: Project): Promise<Array<{ name: string; description: string }>>`——内部 loadResources 后取 kind==="skill" 资源、**过滤 `skill.disableModelInvocation === true` 的项**、按既有 project>global>builtin 优先级去重；`async findSkill(name: string, project?: Project): Promise<Skill | undefined>`——复用 findResource(:223) 逻辑，同样尊重 disableModelInvocation |
| agent-runner.ts:86 附近 | `const skills = await this.slashCommandService.listSkills(project)`，经 runAgentLoop context（:340-348 加 `skills: Array<{name; description}>` 字段）传入 buildSystemPrompt |
| agent-context.ts:5 | `buildSystemPrompt` 入参加 `skills?: Array<{ name: string; description: string }>`；非空时追加段落：`"## 可用技能\n当任务匹配以下技能时，先调用 use_skill 工具加载技能说明，再按说明操作：\n" + skills.slice(0, 20).map(s => \`- ${s.name}：${s.description}\`).join("\n")`（清单截 20 条） |
| agent-runner.ts runModelTool | `name === "use_skill"` 在 `toolExecutor.execute` 前短路（ToolExecutor 不应依赖 SlashCommandService）：`useSkillArgsSchema.parse(args)` → `this.slashCommandService.findSkill(args.name, ctx.project)` → 命中：result = `formatSkillInvocation(skill)`（pi-agent-core 现成函数，slash-command-service.ts:5 已 import，此处由 agent-runner import），**超 32KB 截断并记日志**；未命中：result = `"技能不存在。可用技能：" + (await listSkills(ctx.project)).map(s => s.name).join("、")` 回喂模型。日志含技能名与正文字节数 |

### 5.4 API

无新端点。`GET /api/slash-commands`（app.ts:81-85）已返回 kind==="skill" 的 name/description/source。

### 5.5 renderer

| 文件 | 改动 |
|---|---|
| components/HomeStarters.tsx | 加「技能」区：`slashCommands.filter(c => c.kind === "skill")` 渲染为卡片（名称 + 描述 + 来源 badge：内置/全局/项目），点击 `setInput(c.insertText)` 并聚焦 Composer |
| components/Composer.tsx:502-516 | slash 菜单中 kind==="skill" 项加小 badge「技能」（一处 className/元素分支） |
| components/ToolCallRow.tsx | `use_skill` 渲染为「已加载技能 {args.name}」chip 态，不展开正文 |

---

## 6. 功能五：多模型

**设计**（按嫁接项 6 瘦身）：provider 内多模型 = `GET /api/settings/providers/:id/models` 实时拉取（不持久化 models 列、无设置页编辑 UI）；模型记忆 = `sessions.model` 一列迁移；解析优先级 `run > session > provider 默认`，并经 `run_started.providerId/model` 回执给 UI。

### 6.1 shared 契约

已在 §1.1 定稿：`runRequestSchema.model`、`sessionSchema.model`、`sessionUpdateSchema.model`、`run_started` 的 `providerId`/`model` 可选字段。

### 6.2 backend 改动地图

| 文件:位置 | 改动 |
|---|---|
| agent-runner.ts:66-82 | 解析：`const effectiveModel = input.model ?? session?.model ?? selectedProvider.model;`（注意新建 session 分支用 `input.model ?? selectedProvider.model`，且 createSession 入参带 `model: input.model`）。既有 updateSession 调用（:77-82）同步持久化：仅当 `input.model !== undefined` 时附 `model: input.model`（与 providerId 的同步方式一致；不传则保留会话原值）。随后 `const effectiveProvider = { ...selectedProvider, model: effectiveModel }` 传入 runAgentLoop 与 runCompaction 的 provider 位——**openai-compatible.ts 零改动**（:61 读 provider.model）。日志：`[agent-runner] 使用模型 ${selectedProvider.name}/${effectiveModel}（来源: ${input.model ? "run" : session?.model ? "session" : "provider默认"}）` |
| agent-runner.ts:105 | `run_started` 事件携带回执：`yield { type: "run_started", runId, sessionId: activeSession.id, providerId: selectedProvider.id, model: effectiveModel }`；runCompaction（:180）同样补 `providerId: provider.id, model: provider.model` |
| repository/sqlite-state-store.ts:127-130 旁 | 追加 `this.ensureColumn("sessions", "model", "text");` + session 行读写映射（与 feishu_chat_id 同模式）。**不加 providers.models 列** |
| model/openai-compatible.ts | `ModelClient` 接口加 `listModels(provider: ProviderConfig, apiKey?: string): Promise<string[]>`；实现复用 testProvider 的 `GET {baseURL}/models`（:78-86 同款 fetch），解析 `{ data: [{ id }] }` → `data.map(m => m.id)`，非 2xx 或解析失败抛中文错误（`模型列表拉取失败: …`）并记日志 |
| model/provider-service.ts | 加 `async listModels(id: string): Promise<string[]>`：getProvider + getSecret + `modelClient.listModels`，provider 不存在抛 `"模型配置不存在"` |
| api/app.ts:250 testProvider 路由旁 | 新路由：`GET /api/settings/providers/:id/models` → `jsonResponse({ models: await options.providerService.listModels(match[1]) })` |

### 6.3 API 端点定义

```
GET /api/settings/providers/:id/models
  → 200 { "models": ["deepseek-v4-flash", "deepseek-chat", …] }
  → 500 { "error": "模型列表拉取失败: …" }   // renderer 静默回退为只显示 provider.model 单项
```

### 6.4 renderer

| 文件 | 改动 |
|---|---|
| lib/api.ts | `ApiClient` 加 `listProviderModels(providerId: string): Promise<string[]>` |
| store/index.ts | state 加：`model?: string`（partialize 持久化）、`setModel(model: string \| undefined)`、`providerModels: Record<string, string[]>`（内存缓存，不持久化）、`loadProviderModels(providerId)`（已缓存即跳过；失败 console.warn 并缓存空数组回退）、`lastRunModel?: { providerId: string; model: string }`。`runPrompt` 请求体加 `model: state.model`；事件分发链 `run_started` 分支（:733 附近）在 event.model 存在时 `set({ lastRunModel: { providerId: event.providerId!, model: event.model } })`；`selectSession`（:466 旁）同步 `model: session?.model ?? state.model`；`setProviderId` 时清空 `model`（换 provider 后旧模型名无意义） |
| components/Composer.tsx:437-457 | 模型 Select 升级为两级：value 编码为 `` `${providerId}::${model}` ``；`SelectContent` 按 provider 分 `SelectGroup`（组标签 = provider.name），组内 items = `dedupe([provider.model, ...(providerModels[provider.id] ?? [])])`；`onOpenChange(true)` 时对各 configuredProvider 触发 `loadProviderModels`（懒加载 + 缓存，失败回退单项）；`onValueChange` 解析后 `setProviderId(pid); setModel(m === provider.model ? undefined : m)`。运行中沿用现有禁用行为 |
| components/ChatView.tsx | usage/底部区域渲染 `lastRunModel`：`本轮使用 {providerName} · {model}` 的 faint caption（providerName 由 providers 列表查得，查不到显示 providerId） |

设置页 ProviderForm：**不改**（嫁接项 6）。

---

## 7. API 端点汇总（全部新旧交互面）

| 端点 | 方法 | 变更 |
|---|---|---|
| `/api/approvals/:toolCallId` | POST | body 仍为 `approvalDecisionSchema`，新增可选 `editedSteps`/`answer`；路由改为透传整个 decision 对象（§1.6） |
| `/api/settings/providers/:id/models` | GET | **新增**，实时拉取模型列表（§6.3） |
| `/api/runs/stream` | POST | body 新增可选 `planMode`/`model`（schema 扩展即生效，路由零改动） |
| `/api/sessions/:id` | PATCH | body 新增可选 `model`（schema 扩展即生效） |
| 其余全部端点 | — | 零改动 |

---

## 8. 测试清单

backend 用既有 `scriptedModel + drain` 模板（agent-loop.test.ts:12-32），renderer 用 mocked ApiClient（app.test.tsx:29-68）或纯函数/组件直测。`scriptedModel` 增强一次、所有用例共享：记录每次 `streamCompletion` 入参（messages/tools/provider），供断言 system prompt、工具表裁剪与生效模型。**agent-loop 所有用例对 drain 出的每个事件执行 `streamEventSchema.parse(event)`**（嫁接项 4，封死「后端 emit 什么前端只能信」的缺口）——在 drain helper 里统一做。

| 测试文件 | 用例 |
|---|---|
| `packages/shared/test/contracts.test.ts`（新） | `approvalDecision 仅 approved 可解析（向后兼容）`；`approvalDecision 携带 editedSteps/answer 可解析`；`askUserAnswer 选项与文字皆空时 refine 报错`；`proposePlanArgs 步骤 0 条/21 条报错`；`updatePlanArgs/askUserArgs/btwArgs/useSkillArgs 解析`；`runRequest planMode 默认 false、model 可选`；`sessionUpdate model 可置 null`；`streamEventSchema 解析 11 种事件、run_started 可带 providerId/model、未知 type 拒绝` |
| `packages/shared/test/plan.test.ts`（新） | `无 propose_plan → undefined`；`pending 锚点 → confirmed=false`；`completed 锚点 + update_plan 叠放出正确步骤状态`；`editedSteps 写回 args 后以 args 为准`；`驳回后重新 propose_plan 以新锚点为准（旧计划失效）`；`全部 completed/skipped → finished=true`；`锚点之前的 update_plan 不叠放` |
| `apps/backend/test/approval-queue.test.ts`（新） | `wait→decide 携带 payload round-trip`；`earlyDecision 带 payload 不丢`；`abort resolve {approved:false}`；`decide 后 pending 清空`；`normalizeDecision: ask_user approved 缺 answer 视为拒绝`；`normalizeDecision: editedSteps 仅 propose_plan 保留`；`normalizeDecision: 普通工具多余 payload 被剥除` |
| `apps/backend/test/tool-catalog.test.ts`（新） | `none 阶段不含 propose_plan/update_plan`；`draft 阶段只含只读 + propose_plan/ask_user/btw/use_skill`；`execute 阶段含 update_plan 不含 propose_plan`；`viaFeishu 任意阶段剔除 propose_plan/ask_user` |
| `apps/backend/test/agent-loop.test.ts`（扩） | ① `planMode 起草阶段模型收到裁剪工具表（断言捕获的 tools）`；② `propose_plan 出 pending → decide 带 editedSteps → args 落库且下一轮 messages 含编辑后步骤 → planConfirmed 后 write_file 放行`；③ `planMode 下模型幻觉调用 write_file（未确认）→ rejected 纠偏文本回喂、run 不中断`；④ `计划批准后 approval 模式下 mutating 工具仍发 tool_call_pending（accessMode 正交性，嫁接项 7）`；⑤ `跨 run：上一 run 已确认未完结计划 → 新 run planConfirmed 恢复、system prompt 含计划现状`；⑥ `update_plan 产生 tool_result 且 args 落库`；⑦ `ask_user pending → decide 带 answer → 工具结果即答案文本`；⑧ `ask_user 跳过 → "用户跳过"回喂`；⑨ `ask_user 等待中 abort → run_aborted`；⑩ `btw 在 approval 模式不出 pending 直接执行、不落 role:tool 消息（listMessages 断言）`；⑪ `use_skill 命中返回 SKILL.md 正文、未知技能返回可用清单`；⑫ `run 带 model 覆盖 → 捕获的 provider.model 为覆盖值、session.model 持久化、run_started 携带 providerId/model`；⑬ `全部事件过 streamEventSchema.parse`（drain 内置） |
| `apps/backend/test/agent-context.test.ts`（扩） | `planMode 段落出现/缺省`；`planSnapshot 注入计划现状`；`skills 清单注入与 20 条截断`；`btw 约定行存在` |
| `apps/backend/test/agent-runner.test.ts`（扩） | `runDirectTool 决议对象化后审批/拒绝路径不回归` |
| `apps/backend/test/api-app.test.ts`（扩） | `POST /api/approvals body 带 answer/editedSteps 透传到 decide（spy 断言收到完整对象）`；`GET /api/settings/providers/:id/models 返回列表`；`models 端点 provider 不存在 → 500 中文错误` |
| `apps/backend/test/slash-command-service.test.ts`（扩） | `listSkills 返回 name+description`；`disableModelInvocation 过滤`；`findSkill 命中与未命中`；`project>global>builtin 优先级沿用` |
| `apps/backend/test/sqlite-state-store.test.ts`（扩） | `sessions.model 列迁移：旧库文件升级不丢数据 + round-trip`（不含 providers.models 用例） |
| `apps/backend/test/feishu-service.test.ts`（扩） | `read-only 会话 pending 被 decide({approved:false}) 拒绝（编译级签名回归）` |
| `apps/desktop/test/plan-card.test.tsx`（新） | `PlanApprovalCard 渲染步骤清单`；`编辑步骤后确认 → onDecide 收到 editedSteps`；`未编辑确认 → 不带 editedSteps`；`否决 → {approved:false}`；`PlanCard 勾选进度 3/5` |
| `apps/desktop/test/ask-user-card.test.tsx`（新） | `渲染问题与选项`；`点选项 → onDecide {approved:true, answer:{optionLabel}}`；`自由输入提交 → answer.text`；`allowFreeText=false 不渲染输入框`；`跳过 → {approved:false}` |
| `apps/desktop/test/btw-card.test.tsx`（新） | `旁注渲染 note+suggestion`；`「转为任务」→ onConvert 收到预填文本` |
| `apps/desktop/test/tool-call-row.test.tsx`（扩） | `已完成 ask_user 渲染静态问答对`；`use_skill 渲染 chip 态`；`非活跃 run 的 pending_approval 渲染终态卡（不可交互）` |
| `apps/desktop/test/app.test.tsx`（扩） | `计划模式 toggle 开启 → runRequest.planMode=true`；`approve 透传 ApprovalDecision 对象`；`run_started 带 model → lastRunModel 上屏`；`技能卡片点击预填 insertText` |
| `apps/desktop/test/composer.test.tsx`（新） | `两级模型选择器选中 → setProviderId+setModel、请求体带 providerId+model`；`models 拉取失败回退单项`；`slash 菜单 skill 项带「技能」badge` |

---

## 9. 实现分工方案（工作包文件独占，互不重叠）

> 例外约定：`apps/desktop/src/renderer/i18n/locales/` 下的文案资源文件允许多包 append-only 追加（冲突 trivially 可解），不计入独占清单。除此之外任何文件只属于一个工作包。

### WP-A · shared 契约（串行第 1，必须最先单独合并）

独占文件：
- `packages/shared/src/index.ts`
- `packages/shared/src/plan.ts`（新）
- `packages/shared/test/contracts.test.ts`（新）
- `packages/shared/test/plan.test.ts`（新）

产出 §1.1 全部 + `pnpm build` 绿。约 0.5 天。

### WP-B · backend agent 核心（串行第 2，关键路径）

独占文件：
- `apps/backend/src/agent/approval-queue.ts`
- `apps/backend/src/agent/agent-runner.ts`
- `apps/backend/src/agent/agent-context.ts`
- `apps/backend/src/tools/tool-schemas.ts`
- `apps/backend/src/tools/tool-catalog.ts`（新）
- `apps/backend/src/tools/tool-executor.ts`
- `apps/backend/src/tools/slash-command-service.ts`
- `apps/backend/src/feishu/feishu-service.ts`
- `apps/backend/src/repository/sqlite-state-store.ts`
- 测试：`apps/backend/test/approval-queue.test.ts`（新）、`tool-catalog.test.ts`（新）、`agent-loop.test.ts`、`agent-runner.test.ts`、`agent-context.test.ts`、`slash-command-service.test.ts`、`sqlite-state-store.test.ts`、`feishu-service.test.ts`

内容：§1.2-1.5、§1.6-2、§1.8、§2.3、§3.3、§4.3、§5.3、§6.2 中 agent-runner/sqlite 部分。内部按 5 个阶段提交（每阶段测试先行、`pnpm test` 绿）：
1. M0：队列泛化 + normalizeDecision + requiresUserGate + 5 个工具定义 + tool-catalog + feishu decide 修复 + MAX_TOOL_ITERATIONS=40；
2. ask-user + btw（最小，最先端到端验证泛化队列）；
3. 计划模式（loopState、两阶段、editedSteps 落库、跨 run 恢复）；
4. skills（listSkills/findSkill、prompt 注入、use_skill 短路）；
5. 多模型解析 + sessions.model 迁移 + run_started 回执。

约 3 天。**注意**：阶段 1 合并后 `api/app.ts:208` 在 WP-C 修复前类型不过——因此 WP-B 阶段 1 与 WP-C 的 app.ts 决议透传一行**必须同一次合并进主干**（见合并次序；WP-C 先把这一行做成独立 commit 供合车）。

### WP-C · backend API / 模型端点（与 WP-B 并行开发，基于 WP-B 分支；合并紧随 WP-B）

独占文件：
- `apps/backend/src/api/app.ts`
- `apps/backend/src/model/provider-service.ts`
- `apps/backend/src/model/openai-compatible.ts`
- 测试：`apps/backend/test/api-app.test.ts`、`provider-service.test.ts`、`openai-stream.test.ts`

内容：§1.6-1（approvals 透传，独立 commit）、§6.2 中 listModels 链路、§6.3 路由。约 0.5 天。

### WP-D · renderer 交互组件（与 WP-B/C 并行，仅依赖 WP-A；可在 WP-A 后随时合并）

独占文件：
- `apps/desktop/src/renderer/components/PlanApprovalCard.tsx`（新）
- `apps/desktop/src/renderer/components/PlanCard.tsx`（新）
- `apps/desktop/src/renderer/components/AskUserCard.tsx`（新）
- `apps/desktop/src/renderer/components/BtwCard.tsx`（新）
- `apps/desktop/src/renderer/components/ToolCallRow.tsx`
- 测试：`apps/desktop/test/plan-card.test.tsx`（新）、`ask-user-card.test.tsx`（新）、`btw-card.test.tsx`（新）、`tool-call-row.test.tsx`

约束：四个新卡片全部 **props 驱动**（`toolCall` + 回调），不 import store——保证与 WP-E 完全解耦、可独立 render 测试。约 1.5 天。

### WP-E · renderer store 与接线（与 WP-B/C/D 并行开发；合并在 WP-D 之后）

独占文件：
- `apps/desktop/src/renderer/lib/api.ts`
- `apps/desktop/src/renderer/store/index.ts`
- `apps/desktop/src/renderer/lib/timeline.ts`
- `apps/desktop/src/renderer/components/ChatView.tsx`
- 测试：`apps/desktop/test/app.test.tsx`

内容：§1.7、§2.5 store/ChatView/timeline、§3.5/§4.5 ChatView 接线、§6.4 store/lastRunModel、残留 pending 规则的数据侧（activeRunId 判定传给组件）。store 新字段（planMode/model/providerModels/lastRunModel）的名称与签名以本规格为准，供 WP-F 直接消费。约 1.5 天。

### WP-F · Composer 与首页（合并在 WP-E 之后）

独占文件：
- `apps/desktop/src/renderer/components/Composer.tsx`
- `apps/desktop/src/renderer/components/HomeStarters.tsx`
- 测试：`apps/desktop/test/composer.test.tsx`（新）

内容：计划模式 toggle、两级模型 Select、slash 菜单技能 badge、首页技能区。约 1 天。

### 推荐实施顺序

```
WP-A（串行，pnpm build && pnpm test 绿后合并）
  ├─ WP-B（关键路径，5 阶段提交）──┐
  ├─ WP-C（并行开发，基于 WP-B）   ├─ 合并次序：B(阶段1)+C(approvals一行) 同车 → B 其余阶段 → C 其余
  ├─ WP-D（并行，仅依赖 A）────────→ A 后随时可合
  ├─ WP-E（并行开发）─────────────→ 合并在 D 之后
  └─ WP-F（并行开发）─────────────→ 合并在 E 之后
```

每个工作包遵循仓库规约：先写失败测试再实现；全程 `pnpm test` 绿、`pnpm typecheck` 绿才算完成；shared 改动后必须先 `pnpm build` 再 typecheck 两端。

---

## 10. 为什么不（设计否决记录）

- **不为 plan/ask/btw 加 StreamEvent 类型**：tool 三事件 + ToolCall 持久化已覆盖全部信息流；新事件意味着 store 分发链（store/index.ts:730-788）、feishu 消费、测试三处永久同步成本，且丢失「重载即恢复」的免费持久化。
- **不建 plan 表 / AnswerQueue / 新应答端点**：状态由 tool_calls 推导（纯函数可测）；第二个队列与 ApprovalQueue 的 abort/early-decision 逻辑必然重复；问题与审批共享「run 阻塞等用户」的本质。
- **不用文本标记做 btw**：跨 chunk 解析破坏 StreamingMarkdown 尾部修复假设；工具调用是模型已被训练好的结构化出口。
- **不预注入 skill 全文**：name+description 清单 + use_skill 按需拉取。
- **不做 providers.models 持久列与设置页编辑**：speculative 配置，违反「无可配置性预付」守则；实时拉取 + 失败回退单项已覆盖需求。
- **不把 planMode 落 session 列**：run 级开关 + renderer 持久化与 accessMode 体验一致，少一次 DB 迁移；跨 run 连续性由 tool_calls 推导的计划恢复（§2.3）解决，不需要 session 列。
- **不依赖 forced tool_choice 进入起草阶段**：DeepSeek 兼容端点会忽略它；用工具表裁剪（确定性）+ planConfirmed 门（兜底文本纠偏）双保险。
