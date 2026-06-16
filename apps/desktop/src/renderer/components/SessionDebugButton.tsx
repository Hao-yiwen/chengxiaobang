import { BugOutlined } from "@ant-design/icons";
import {
  ChevronRightIcon,
  CopyIcon,
  RefreshIcon
} from "@/assets/file-type-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AgentDebugTool,
  Message,
  ProviderConfig,
  ReasoningMode,
  SessionDebugContext,
  ToolCall
} from "@chengxiaobang/shared";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getApiClient, useAppStore } from "@/store";

interface LocalDebugSnapshot {
  activeSessionId?: string;
  isRunning: boolean;
  providers: ProviderConfig[];
  streamText: string;
  thinking: string;
}

type DebugTab = "transcript" | "tools";

export function SessionDebugButton() {
  const { t } = useTranslation();
  const {
    activeSessionId,
    planMode,
    isRunning,
    providers,
    streamText,
    thinking
  } = useAppStore(
    useShallow((state) => ({
      activeSessionId: state.activeSessionId,
      planMode: state.planMode,
      isRunning: state.isRunning,
      providers: state.providers,
      streamText: state.streamText,
      thinking: state.thinking
    }))
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [debugContext, setDebugContext] = useState<SessionDebugContext>();
  const [error, setError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState("");
  const [activeTab, setActiveTab] = useState<DebugTab>("transcript");

  const localSnapshot = useMemo<LocalDebugSnapshot>(
    () => ({
      activeSessionId,
      isRunning,
      providers,
      streamText,
      thinking
    }),
    [activeSessionId, isRunning, providers, streamText, thinking]
  );

  const loadDebugContext = useCallback(async () => {
    if (!activeSessionId) {
      return;
    }
    const client = getApiClient();
    if (!client?.getSessionDebugContext) {
      console.warn("[debug] 当前 ApiClient 不支持会话 Debug 上下文");
      setError(t("debug.unavailable"));
      return;
    }
    setLoading(true);
    setError(undefined);
    console.info("[debug] 拉取会话 Debug 上下文", { activeSessionId, planMode });
    try {
      const next = await client.getSessionDebugContext(activeSessionId, { planMode });
      setDebugContext(next);
      console.info("[debug] 会话 Debug 上下文已更新", {
        sessionId: activeSessionId,
        messages: next.messages.length,
        tools: next.availableTools.length
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[debug] 拉取会话 Debug 上下文失败", { activeSessionId, message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeSessionId, planMode, t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadDebugContext();
  }, [loadDebugContext, open]);

  if (!activeSessionId) {
    return null;
  }

  const content = debugContext ? buildCompleteDebugReport(debugContext, localSnapshot) : "";

  const switchTab = (tab: DebugTab) => {
    if (tab === activeTab) {
      return;
    }
    setActiveTab(tab);
    console.info("[debug] 切换 Debug 页签", { sessionId: activeSessionId, tab });
  };

  const copyCurrent = async () => {
    if (!content) {
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API 不可用");
      }
      await navigator.clipboard.writeText(content);
      setCopyStatus(t("debug.copied"));
      console.info("[debug] 已复制精简 Debug 记录", {
        sessionId: activeSessionId,
        chars: content.length
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.warn("[debug] 复制精简 Debug 记录失败", { sessionId: activeSessionId, message });
      setCopyStatus(t("debug.copyFailed"));
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("debug.open")}
            title={t("debug.open")}
            className="size-8 rounded-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(true)}
          >
            <BugOutlined className="text-[16px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("debug.open")}</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[min(88vh,920px)] max-w-[1160px] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-3 text-left">
            <DialogTitle className="text-body font-medium leading-tight">{t("debug.title")}</DialogTitle>
            <DialogDescription className="text-micro leading-snug">
              {debugContext
                ? t("debug.generatedAt", { time: debugContext.generatedAt })
                : t("debug.loading")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-none items-center justify-between gap-3 border-b px-5 py-2">
              <div className="flex min-w-0 flex-col gap-2">
                <div
                  role="tablist"
                  aria-label="Debug 内容"
                  className="inline-flex w-fit rounded-sm border border-border bg-canvas-soft p-0.5"
                >
                  <DebugTabButton
                    active={activeTab === "transcript"}
                    onClick={() => switchTab("transcript")}
                  >
                    完整流程
                  </DebugTabButton>
                  <DebugTabButton
                    active={activeTab === "tools"}
                    badge={debugContext?.availableTools.length ?? 0}
                    onClick={() => switchTab("tools")}
                  >
                    可用工具
                  </DebugTabButton>
                </div>
                <div className="min-w-0 text-micro text-muted-foreground">
                  {activeTab === "tools"
                    ? t("debug.toolsReportHint", {
                        count: debugContext?.availableTools.length ?? 0
                      })
                    : t("debug.fullReportHint")}
                </div>
              </div>
              <div className="flex flex-none items-center gap-2">
                <span className="min-w-[4rem] text-right text-micro text-muted-foreground">
                  {copyStatus}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyCurrent()}
                  disabled={!content || loading}
                >
                  <CopyIcon className="size-4" />
                  {t("debug.copy")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadDebugContext()}
                  disabled={loading}
                >
                  <RefreshIcon className="size-4" />
                  {t("debug.refresh")}
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-primary p-4 text-primary-foreground">
              {loading ? (
                <div className="font-mono text-code text-primary-foreground/80">
                  {t("debug.loading")}
                </div>
              ) : error ? (
                <div className="rounded-sm border border-error/40 bg-error/10 px-3 py-2 text-caption text-primary-foreground">
                  {error}
                </div>
              ) : !debugContext ? (
                <div className="font-mono text-code text-primary-foreground/80">
                  {t("debug.loading")}
                </div>
              ) : activeTab === "tools" ? (
                <AvailableToolsView debugContext={debugContext} />
              ) : (
                <DebugReportView debugContext={debugContext} localSnapshot={localSnapshot} />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DebugTabButton(props: {
  active: boolean;
  badge?: number;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-xs px-2.5 text-caption font-medium transition-colors",
        props.active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      )}
      onClick={props.onClick}
    >
      <span>{props.children}</span>
      {props.badge === undefined ? null : (
        <span
          className={cn(
            "rounded-xs px-1.5 py-0.5 font-mono text-micro",
            props.active
              ? "bg-primary-foreground/15 text-primary-foreground"
              : "bg-background text-muted-foreground"
          )}
        >
          {props.badge}
        </span>
      )}
    </button>
  );
}

function DebugReportView(props: {
  debugContext: SessionDebugContext;
  localSnapshot: LocalDebugSnapshot;
}) {
  const timeline = buildTimelineEntries(props.debugContext, props.localSnapshot);
  return (
    <div
      data-testid="debug-report"
      className="h-full overflow-y-scroll rounded-sm bg-background px-5 py-4 text-foreground [scrollbar-gutter:stable]"
    >
      <div className="mb-5 border-b border-border pb-4">
        <div className="font-mono text-caption text-muted-foreground">会话 Debug 精简记录</div>
        <div className="mt-2 font-mono text-code text-muted-foreground">
          <div>快照时间: {props.debugContext.generatedAt}</div>
          <div>
            会话: {props.debugContext.session.title} ({props.debugContext.session.id})
          </div>
          {formatModelLine(props.debugContext, props.localSnapshot)
            .split("\n")
            .map((line) => (
              <div key={line}>{line}</div>
            ))}
          <div>工作目录: {props.debugContext.workspacePath}</div>
        </div>
      </div>
      <section className="mb-6">
        <h3 className="mb-2 text-body-sm font-medium">系统提示词</h3>
        <pre className="min-h-[280px] max-h-[46vh] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-primary p-3 font-mono text-code text-primary-foreground/90">
          {props.debugContext.systemPrompt}
        </pre>
      </section>
      <section>
        <h3 className="mb-2 text-body-sm font-medium">用户输入与助手输出</h3>
        {timeline.length === 0 ? (
          <div className="rounded-sm border border-border bg-card px-3 py-2 text-caption text-muted-foreground">
            暂无用户输入或助手输出。
          </div>
        ) : (
          <div className="space-y-3">
            {timeline.map((entry, index) =>
              entry.kind === "tool" && entry.toolCall ? (
                <ToolCallDetails
                  key={`${entry.title}-${entry.at}-${index}`}
                  entry={entry}
                  index={index}
                />
              ) : entry.kind === "tool_result" ? (
                <ToolResultMessageDetails
                  key={`${entry.title}-${entry.at}-${index}`}
                  entry={entry}
                  index={index}
                />
              ) : (
                <TranscriptBlock key={`${entry.title}-${entry.at}-${index}`} entry={entry} index={index} />
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function AvailableToolsView(props: { debugContext: SessionDebugContext }) {
  const tools = props.debugContext.availableTools;
  const approvalCount = tools.filter((tool) => tool.requiresApproval).length;
  return (
    <div
      data-testid="debug-tools"
      className="h-full overflow-y-scroll rounded-sm bg-background px-5 py-4 text-foreground [scrollbar-gutter:stable]"
    >
      <div className="mb-5 border-b border-border pb-4">
        <div className="font-mono text-caption text-muted-foreground">当前可用工具</div>
        <div className="mt-2 font-mono text-code text-muted-foreground">
          <div>工具数量: {tools.length}</div>
          <div>需要审批: {approvalCount}</div>
          <div>访问模式: {formatAccessMode(props.debugContext.accessMode)}</div>
          <div>计划模式: {props.debugContext.planMode ? "开启" : "关闭"}</div>
          <div>来源通道: {props.debugContext.viaFeishu ? "飞书" : "桌面会话"}</div>
        </div>
      </div>
      {tools.length === 0 ? (
        <div className="rounded-sm border border-border bg-card px-3 py-2 text-caption text-muted-foreground">
          当前上下文没有可用工具。
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {tools.map((tool) => (
            <AvailableToolCard key={tool.name} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function AvailableToolCard(props: { tool: AgentDebugTool }) {
  return (
    <article className="rounded-sm border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-code text-foreground">{props.tool.name}</div>
          {props.tool.label ? (
            <div className="mt-0.5 text-caption text-muted-foreground">{props.tool.label}</div>
          ) : null}
        </div>
        <span
          className={cn(
            "flex-none rounded-xs px-1.5 py-0.5 font-mono text-micro",
            props.tool.requiresApproval
              ? "bg-warning-soft text-warning-deep"
              : "bg-canvas-soft-2 text-muted-foreground"
          )}
        >
          {props.tool.requiresApproval ? "需要审批" : "自动可用"}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-body-sm leading-relaxed text-foreground">
        {props.tool.description?.trim() || "暂无说明"}
      </p>
    </article>
  );
}

function TranscriptBlock(props: { entry: TimelineEntry; index: number }) {
  return (
    <article className="rounded-sm border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-3 text-caption">
        <span className="font-medium text-foreground">
          {props.index + 1}. {props.entry.title}
        </span>
        <span className="min-w-0 truncate font-mono text-micro text-muted-foreground">
          {props.entry.at}
        </span>
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-body-sm leading-relaxed text-foreground">
        {props.entry.body.trim() || "（空）"}
      </div>
    </article>
  );
}

function ToolResultMessageDetails(props: { entry: TimelineEntry; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      data-testid={`debug-tool-result-message-${props.entry.id ?? props.index}`}
      className="group rounded-sm border border-border bg-card"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        console.info("[debug] 切换工具结果消息", {
          messageId: props.entry.id,
          open: event.currentTarget.open,
          chars: props.entry.body.length
        });
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-caption transition-colors hover:bg-canvas-soft-2 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 flex-none text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="flex-none font-medium text-foreground">
          {props.index + 1}. {props.entry.title}
        </span>
        <span className="flex-none rounded-xs bg-canvas-soft-2 px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
          {props.entry.body.length} 字
        </span>
        <span className="min-w-0 truncate font-mono text-micro text-muted-foreground">
          {props.entry.at}
        </span>
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border bg-canvas-soft-2/60 px-3 py-2 font-mono text-micro leading-relaxed text-muted-foreground">
        {props.entry.body.trim() || "（空）"}
      </pre>
    </details>
  );
}

function ToolCallDetails(props: { entry: TimelineEntry; index: number }) {
  const toolCall = props.entry.toolCall;
  const [toolOpen, setToolOpen] = useState(true);
  if (!toolCall) {
    return <TranscriptBlock entry={props.entry} index={props.index} />;
  }
  const isProblem = toolCall.status === "failed" || toolCall.status === "rejected";
  return (
    <details
      data-testid={`debug-tool-${toolCall.id}`}
      className={`group rounded-sm border bg-card ${
        isProblem ? "border-error/40" : "border-border"
      }`}
      open={toolOpen}
      onToggle={(event) => {
        setToolOpen(event.currentTarget.open);
        console.info("[debug] 切换工具调用详情", {
          toolCallId: toolCall.id,
          name: toolCall.name,
          open: event.currentTarget.open
        });
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-caption transition-colors hover:bg-canvas-soft-2 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 flex-none text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="flex-none font-medium text-foreground">
          {props.index + 1}. 工具调用: {toolCall.name}
        </span>
        <span
          className={`flex-none rounded-xs px-1.5 py-0.5 font-mono text-micro ${
            isProblem ? "bg-error-soft text-error-deep" : "bg-canvas-soft-2 text-muted-foreground"
          }`}
        >
          {formatToolStatus(toolCall.status)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-muted-foreground">
          参数: {truncateText(formatPlainValue(toolCall.args), 120)}
        </span>
      </summary>
      <div className="border-t border-border bg-canvas-soft-2/60 px-3 py-2">
        <div className="mb-2 font-mono text-micro text-muted-foreground">时间: {props.entry.at}</div>
        <div className="rounded-sm bg-background px-3 py-2 font-mono text-micro leading-relaxed text-muted-foreground">
          <div>状态: {toolCall.status}</div>
          <div>参数: {formatPlainValue(toolCall.args)}</div>
        </div>
      </div>
    </details>
  );
}

function buildCompleteDebugReport(
  debugContext: SessionDebugContext,
  localSnapshot: LocalDebugSnapshot
): string {
  return [
    "# 会话 Debug 精简记录",
    "",
    `快照时间: ${debugContext.generatedAt}`,
    `会话: ${debugContext.session.title} (${debugContext.session.id})`,
    formatModelLine(debugContext, localSnapshot),
    `工作目录: ${debugContext.workspacePath}`,
    "",
    "## 当前可用工具",
    "",
    formatAvailableTools(debugContext),
    "",
    "## 系统提示词",
    "",
    debugContext.systemPrompt,
    "",
    "## 用户输入与助手输出",
    "",
    formatConversationTimeline(debugContext, localSnapshot)
  ].join("\n");
}

interface TimelineEntry {
  id?: string;
  at: string;
  order: number;
  title: string;
  body: string;
  kind: "message" | "tool" | "tool_result";
  toolCall?: ToolCall;
}

function buildTimelineEntries(
  debugContext: SessionDebugContext,
  localSnapshot: LocalDebugSnapshot
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  debugContext.messages.forEach((message, index) => {
    entries.push(...messageEntries(message, index));
  });
  debugContext.toolCalls.forEach((toolCall, index) => {
    entries.push(toolCallEntry(toolCall, index));
  });
  if (localSnapshot.isRunning && localSnapshot.thinking) {
    entries.push({
      at: "当前运行中",
      order: 9_000,
      title: "助手正在思考（流式）",
      body: localSnapshot.thinking,
      kind: "message"
    });
  }
  if (localSnapshot.isRunning && localSnapshot.streamText) {
    entries.push({
      at: "当前运行中",
      order: 9_001,
      title: "助手正在输出（流式）",
      body: localSnapshot.streamText,
      kind: "message"
    });
  }
  return entries.sort(compareTimelineEntry);
}

function formatConversationTimeline(
  debugContext: SessionDebugContext,
  localSnapshot: LocalDebugSnapshot
): string {
  const entries = buildTimelineEntries(debugContext, localSnapshot);
  if (entries.length === 0) {
    return "暂无用户输入或助手输出。";
  }
  return entries
    .map(
      (entry, index) =>
        `### ${index + 1}. ${entry.title}\n时间: ${entry.at}\n${entry.body.trim() || "（空）"}`
    )
    .join("\n\n");
}

function messageEntries(message: Message, index: number): TimelineEntry[] {
  if (message.role === "tool") {
    return [
      {
        id: message.id,
        at: message.createdAt,
        order: index * 10 + 1,
        title: "工具结果消息",
        body: message.content,
        kind: "tool_result"
      }
    ];
  }
  const label =
    message.role === "user"
      ? "用户输入"
    : message.role === "assistant"
      ? "助手回复"
        : "系统消息";
  const entries: TimelineEntry[] = [];
  if (message.role === "assistant" && message.reasoning) {
    entries.push({
      at: message.createdAt,
      order: index * 10,
      title: "助手思考",
      body: message.reasoning,
      kind: "message"
    });
  }
  entries.push({
    at: message.createdAt,
    order: index * 10 + 1,
    title: label,
    body: message.content,
    kind: "message"
  });
  return entries;
}

function toolCallEntry(toolCall: ToolCall, index: number): TimelineEntry {
  const lines = [
    `状态: ${toolCall.status}`,
    `参数: ${formatPlainValue(toolCall.args)}`,
    toolCall.result ? `结果: ${toolCall.result}` : ""
  ].filter(Boolean);
  return {
    at: toolCall.updatedAt || toolCall.createdAt,
    order: 1_000 + index,
    title: `工具调用: ${toolCall.name}`,
    body: lines.join("\n"),
    kind: "tool",
    toolCall
  };
}

function formatModelLine(
  debugContext: SessionDebugContext,
  localSnapshot: LocalDebugSnapshot
): string {
  const provider = localSnapshot.providers.find(
    (candidate) => candidate.id === debugContext.session.providerId
  );
  const model = debugContext.session.model ?? provider?.model;
  const reasoningMode = debugContext.session.reasoningMode ?? provider?.reasoningMode;
  const source = debugContext.session.model ? "会话配置" : provider ? "供应商默认" : "未记录来源";
  const providerLabel = provider
    ? `${provider.name} (${provider.kind})`
    : debugContext.session.providerId
      ? `providerId=${debugContext.session.providerId}`
      : "未知供应商";
  return [
    `模型: ${providerLabel}`,
    model ? `模型名称: ${model}` : "模型名称: 未记录",
    reasoningMode ? `推理模式: ${formatReasoningMode(reasoningMode)}` : "",
    `模型来源: ${source}`
  ]
    .filter(Boolean)
    .join("\n");
}

function formatAvailableTools(debugContext: SessionDebugContext): string {
  if (debugContext.availableTools.length === 0) {
    return "当前上下文没有可用工具。";
  }
  return debugContext.availableTools
    .map((tool, index) => {
      const title = tool.label ? `${tool.label} (${tool.name})` : tool.name;
      return [
        `${index + 1}. ${title}`,
        `审批: ${tool.requiresApproval ? "需要审批" : "自动可用"}`,
        `说明: ${tool.description?.trim() || "暂无说明"}`
      ].join("\n");
    })
    .join("\n\n");
}

function formatReasoningMode(reasoningMode: ReasoningMode): string {
  return reasoningMode;
}

function formatAccessMode(accessMode: SessionDebugContext["accessMode"]): string {
  switch (accessMode) {
    case "full_access":
      return "完全访问";
    case "smart_approval":
      return "智能审批";
    case "approval":
      return "需要审批";
  }
}

function formatToolStatus(status: ToolCall["status"]): string {
  switch (status) {
    case "pending_smart_approval":
      return "智能审批中";
    case "pending_approval":
      return "待审批";
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "rejected":
      return "已拒绝";
    case "failed":
      return "失败";
  }
}

function compareTimelineEntry(left: TimelineEntry, right: TimelineEntry): number {
  const leftTime = Date.parse(left.at);
  const rightTime = Date.parse(right.at);
  const leftRank = Number.isNaN(leftTime) ? Number.MAX_SAFE_INTEGER : leftTime;
  const rightRank = Number.isNaN(rightTime) ? Number.MAX_SAFE_INTEGER : rightTime;
  return leftRank - rightRank || left.order - right.order;
}

function formatPlainValue(value: unknown): string {
  if (value === undefined) {
    return "无";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatPlainValue(item)).join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "无";
    }
    return entries.map(([key, item]) => `${key}=${formatPlainValue(item)}`).join(", ");
  }
  return String(value);
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
