import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ModelDebugRecord } from "@chengxiaobang/shared";
import { CheckMediumIcon, CopyIcon, WorkflowNodesIcon } from "@/assets/file-type-icons";
import { Markdown } from "@/components/Markdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ModelDebugTab = "request" | "response";

export function ModelDebugDot({
  records,
  messageId,
  className
}: {
  records: ModelDebugRecord[];
  messageId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ModelDebugTab>("request");
  const [selectedId, setSelectedId] = useState(records[0]?.id);
  const selectedRecord = records.find((record) => record.id === selectedId) ?? records[0];
  const requestJson = useMemo(
    () => jsonForPanel(selectedRecord?.request, { request: null }),
    [selectedRecord?.request]
  );
  const responseJson = useMemo(
    () =>
      jsonForPanel(
        selectedRecord?.response,
        selectedRecord?.status === "pending"
          ? { status: "pending" }
          : { status: selectedRecord?.status ?? "unknown", response: null }
      ),
    [selectedRecord?.response, selectedRecord?.status]
  );
  const visiblePayload =
    tab === "request"
      ? (selectedRecord?.request ?? { request: null })
      : (selectedRecord?.response ??
        (selectedRecord?.status === "pending"
          ? { status: "pending" }
          : { status: selectedRecord?.status ?? "unknown", response: null }));
  const visibleJson = tab === "request" ? requestJson : responseJson;

  if (!selectedRecord) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        console.debug("[ModelDebugDot] 切换模型调试弹窗", {
          messageId,
          open: nextOpen,
          recordCount: records.length,
          selectedRecordId: selectedRecord.id
        });
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`查看模型请求调试，共 ${records.length} 条`}
          title="查看模型请求调试"
          className={cn(
            "flex size-5 flex-none items-center justify-center rounded-full transition-colors hover:bg-link-bg-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
          <span className="size-2.5 rounded-full bg-link" />
        </button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(760px,calc(100vh-48px))] max-w-[min(1120px,calc(100vw-48px))] grid-rows-none flex-col gap-0 overflow-hidden border border-border bg-canvas p-0 shadow-overlay sm:rounded-sm">
        <DialogHeader className="border-b border-border px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <span className="mt-0.5 flex size-8 flex-none items-center justify-center rounded-sm border border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground">
              <WorkflowNodesIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-body-lg">模型请求调试</DialogTitle>
              <DialogDescription className="mt-1">
                用户消息 {messageId} · {records.length} 条主对话模型请求
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-border bg-canvas-soft px-3 py-3">
            <div className="space-y-1">
              {records.map((record) => (
                <ModelDebugRecordButton
                  key={record.id}
                  active={record.id === selectedRecord.id}
                  record={record}
                  onClick={() => {
                    console.debug("[ModelDebugDot] 切换模型调试记录", {
                      messageId,
                      recordId: record.id,
                      runId: record.runId,
                      attemptIndex: record.attemptIndex,
                      requestIndex: record.requestIndex
                    });
                    setSelectedId(record.id);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col px-5 py-4">
            <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-body-sm font-medium text-foreground">
                  {recordTitle(selectedRecord)}
                </div>
                <div className="mt-1 truncate font-mono text-micro text-muted-slate">
                  {selectedRecord.model ?? selectedRecord.providerId ?? "unknown"} ·{" "}
                  {responseStatus(selectedRecord.response) ?? statusLabel(selectedRecord.status)} ·{" "}
                  {formatBytes(selectedRecord.requestBytes)}
                  {selectedRecord.responseBytes !== undefined
                    ? ` / ${formatBytes(selectedRecord.responseBytes)}`
                    : ""}
                </div>
              </div>
              <div className="inline-flex flex-none rounded-sm border border-border bg-canvas p-0.5">
                <ModelDebugTabButton active={tab === "request"} onClick={() => setTab("request")}>
                  请求体
                </ModelDebugTabButton>
                <ModelDebugTabButton active={tab === "response"} onClick={() => setTab("response")}>
                  返回结果
                </ModelDebugTabButton>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ModelDebugJsonPanel
                ariaLabel={tab === "request" ? "模型请求体" : "模型返回结果"}
                rawJson={visibleJson}
                value={visiblePayload}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModelDebugRecordButton({
  active,
  record,
  onClick
}: {
  active: boolean;
  record: ModelDebugRecord;
  onClick: () => void;
}) {
  const status = responseStatus(record.response) ?? statusLabel(record.status);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 flex-col rounded-sm border px-3 py-2 text-left transition-colors",
        active
          ? "border-soft-blue-border bg-soft-blue-surface text-foreground"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-canvas"
      )}
    >
      <span className="text-caption font-medium">{recordTitle(record)}</span>
      <span className="mt-1 truncate font-mono text-micro text-muted-slate">
        {record.model ?? record.providerId ?? "unknown"}
      </span>
      <span className="mt-1 flex items-center gap-2 text-micro text-muted-slate">
        <span>{status}</span>
        <span>{formatBytes(record.requestBytes)}</span>
      </span>
    </button>
  );
}

function ModelDebugTabButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-xs px-2 py-1 text-caption transition-colors",
        active
          ? "bg-canvas-soft-2 text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function recordTitle(record: ModelDebugRecord): string {
  return `模型请求 ${record.attemptIndex + 1}.${record.requestIndex + 1}`;
}

function ModelDebugJsonPanel({
  ariaLabel,
  rawJson,
  value
}: {
  ariaLabel: string;
  rawJson: string;
  value: unknown;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-border bg-canvas"
    >
      <div className="flex h-8 flex-none items-center justify-between border-b border-border px-3">
        <span className="font-mono text-micro text-muted-foreground">json</span>
        <CopyJsonButton json={rawJson} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 font-mono text-[12px] leading-5 text-foreground">
        <JsonValue value={value} />
      </div>
    </div>
  );
}

function JsonValue({
  value,
  contentContext = false,
  propertyKey
}: {
  value: unknown;
  contentContext?: boolean;
  propertyKey?: string;
}): ReactNode {
  if (typeof value === "string") {
    const shouldRenderMarkdown =
      propertyKey === "content" ||
      propertyKey === "description" ||
      (contentContext && (propertyKey === "text" || !propertyKey));
    if (shouldRenderMarkdown) {
      return <JsonMarkdownString text={value} />;
    }
    return <span className="text-soft-blue-foreground">{JSON.stringify(value)}</span>;
  }
  if (value === null) {
    return <span className="text-muted-slate">null</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-link-deep">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span>[]</span>;
    }
    return (
      <span>
        <span>[</span>
        <span className="block pl-4">
          {value.map((item, index) => (
            <span key={index} className="block">
              <JsonValue
                value={item}
                contentContext={
                  contentContext || propertyKey === "content" || propertyKey === "description"
                }
              />
              {index < value.length - 1 ? <span>,</span> : null}
            </span>
          ))}
        </span>
        <span>]</span>
      </span>
    );
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span>{"{}"}</span>;
    }
    return (
      <span>
        <span>{"{"}</span>
        <span className="block pl-4">
          {entries.map(([key, child], index) => (
            <span key={key} className="block">
              <span className="text-soft-blue-foreground">{JSON.stringify(key)}</span>
              <span>: </span>
              <JsonValue
                value={child}
                contentContext={contentContext || key === "content" || key === "description"}
                propertyKey={key}
              />
              {index < entries.length - 1 ? <span>,</span> : null}
            </span>
          ))}
        </span>
        <span>{"}"}</span>
      </span>
    );
  }
  return <span className="text-muted-slate">{JSON.stringify(value)}</span>;
}

function JsonMarkdownString({ text }: { text: string }) {
  const markdownText = useMemo(() => escapeRawTagsForMarkdown(text), [text]);
  return (
    <span className="inline-block min-w-[280px] max-w-full align-top">
      <span className="block rounded-xs border border-border bg-canvas-soft-2 px-3 py-2 font-sans text-body-sm leading-6 text-foreground">
        <Markdown text={markdownText} />
      </span>
    </span>
  );
}

const RAW_XML_TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9:_-]*(?:\s+[^<>]*?)?\s*\/?>/g;

function escapeRawTagsForMarkdown(text: string): string {
  return text.replace(RAW_XML_TAG_PATTERN, (tag) =>
    tag.replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  );
}

function CopyJsonButton({ json }: { json: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn("[ModelDebugDot] 复制模型调试 JSON 失败", {
        jsonLength: json.length,
        error
      });
    }
  };

  const Icon = copied ? CheckMediumIcon : CopyIcon;
  return (
    <button
      type="button"
      aria-label="复制 JSON"
      title={copied ? "已复制" : "复制 JSON"}
      onClick={handleCopy}
      className="flex size-6 items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function jsonForPanel(value: unknown, fallback: unknown): string {
  try {
    return JSON.stringify(value === undefined ? fallback : value, null, 2) ?? "";
  } catch (error) {
    return JSON.stringify(
      { serializationError: error instanceof Error ? error.message : String(error) },
      null,
      2
    );
  }
}

function responseStatus(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const status = (value as { status?: unknown }).status;
  return typeof status === "number" ? String(status) : undefined;
}

function statusLabel(status: ModelDebugRecord["status"]): string {
  switch (status) {
    case "pending":
      return "等待响应";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) {
    return "-";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  return `${(value / 1024).toFixed(1)} KB`;
}
