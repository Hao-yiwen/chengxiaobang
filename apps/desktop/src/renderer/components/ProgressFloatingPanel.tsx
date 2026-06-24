import type { ComponentType } from "react";
import {
  CheckCircleIcon,
  ChevronIcon,
  ChevronRightIcon,
  CircleOutlineIcon,
  SpinnerRingIcon,
  type FileIconSvgProps
} from "@/assets/file-type-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deriveTodoState,
  type TodoItem,
  type TodoState,
  type TodoStatus
} from "@chengxiaobang/shared";
import chatLayoutStyles from "@/components/ChatLayout.module.css";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

type Icon = ComponentType<FileIconSvgProps>;

const STATUS_ICON: Record<TodoStatus, Icon> = {
  pending: CircleOutlineIcon,
  in_progress: SpinnerRingIcon,
  completed: CheckCircleIcon
};

type ProgressTodoSource = "active" | "history";

interface ProgressTodoView {
  todo: TodoState;
  source: ProgressTodoSource;
}

/** 对话右侧的轻量进度浮层：只展示 AI 当前 todo，不占用右侧工作区面板。 */
export function ProgressFloatingPanel() {
  const { t } = useTranslation();
  const toolHistory = useAppStore((state) => state.toolHistory);
  const activeRunId = useAppStore((state) => state.activeRunId);
  // 已完成分组的展开态为瞬态 UI，默认展开（贴合参考样式且保证完成项可见）。
  const [completedOpen, setCompletedOpen] = useState(true);
  const activeTodo = useMemo(
    () => (activeRunId ? deriveTodoState(toolHistory, { runId: activeRunId }) : undefined),
    [activeRunId, toolHistory]
  );
  const historyTodo = useMemo(() => deriveTodoState(toolHistory), [toolHistory]);
  const progressView = useMemo<ProgressTodoView | undefined>(() => {
    if (activeRunId) {
      return activeTodo ? { todo: activeTodo, source: "active" } : undefined;
    }
    return historyTodo ? { todo: historyTodo, source: "history" } : undefined;
  }, [activeRunId, activeTodo, historyTodo]);
  const hasTodoHistory = Boolean(historyTodo);
  const logKey = progressView
    ? [
        progressView.source,
        progressView.todo.runId,
        progressView.todo.toolCallId,
        progressView.todo.finished ? "finished" : "open",
        progressView.todo.items.map((item) => `${item.id}:${item.status}`).join("|")
      ].join("\u0000")
    : `hidden:${activeRunId ?? "none"}:${toolHistory.length}:${hasTodoHistory ? "todo" : "empty"}`;

  useEffect(() => {
    if (progressView) {
      console.info("[progress-floating-panel] 展示会话进度浮层", {
        source: progressView.source,
        runId: progressView.todo.runId,
        toolCallId: progressView.todo.toolCallId,
        itemCount: progressView.todo.items.length,
        finished: progressView.todo.finished
      });
      return;
    }
    if (hasTodoHistory) {
      console.warn("[progress-floating-panel] 会话存在 todo 历史但当前不展示进度浮层", {
        activeRunId,
        toolCallCount: toolHistory.length
      });
    }
  }, [activeRunId, hasTodoHistory, logKey, progressView, toolHistory.length]);

  if (!progressView) {
    return null;
  }

  const { todo } = progressView;
  const showingActiveRun = progressView.source === "active";
  const total = todo.items.length;
  const done = todo.items.filter((item) => item.status === "completed").length;
  const completedItems = todo.items.filter((item) => item.status === "completed");
  const restItems = todo.items.filter((item) => item.status !== "completed");
  const statusLabel = showingActiveRun
    ? todo.finished
      ? t("rightPanel.progressFinished")
      : t("rightPanel.progressRunning")
    : t("rightPanel.progressLatest");

  return (
    <aside
      data-testid="progress-floating-panel"
      aria-label={t("rightPanel.progress")}
      className={cn(
        "chat-progress-floating pointer-events-auto rounded-xl border bg-card",
        chatLayoutStyles.progressFloating
      )}
    >
      <header className="flex flex-none items-center justify-between gap-2 border-b px-4 py-3">
        <span className="font-mono text-mono-label uppercase text-muted-foreground">
          {t("rightPanel.progress")}
        </span>
        <span className="flex-none font-mono text-micro tabular-nums text-muted-foreground">
          {t("rightPanel.progressCount", { done, total })}
        </span>
      </header>
      <div
        data-testid="progress-floating-scroll"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-2.5 [scrollbar-gutter:stable]"
      >
        {completedItems.length > 0 ? (
          <CompletedGroup
            items={completedItems}
            open={completedOpen}
            onToggle={() => setCompletedOpen((value) => !value)}
          />
        ) : null}
        {restItems.length > 0 ? (
          <ol className="min-w-0 space-y-0.5">
            {restItems.map((item) => (
              <TodoRow
                key={item.id}
                item={item}
                label={t(`rightPanel.todoStatus.${item.status}`)}
              />
            ))}
          </ol>
        ) : null}
      </div>
      <footer className="flex flex-none items-center gap-1.5 border-t px-4 py-2.5 text-micro">
        <span
          aria-hidden
          className={cn(
            "size-1.5 flex-none rounded-full",
            showingActiveRun
              ? todo.finished
                ? "bg-link"
                : "bg-link animate-pulse"
              : "bg-muted-foreground"
          )}
        />
        <span className="flex-none font-medium text-foreground">{statusLabel}</span>
        <span className="flex-none text-muted-foreground">·</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {t("rightPanel.progressDoneCount", { done, total })}
        </span>
      </footer>
    </aside>
  );
}

/** 已完成步骤折叠分组：默认展开，可收起以聚焦剩余任务。 */
function CompletedGroup({
  items,
  open,
  onToggle
}: {
  items: TodoItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const Chevron = open ? ChevronIcon : ChevronRightIcon;
  return (
    <div className="mb-1 min-w-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-micro text-muted-foreground transition-colors hover:bg-canvas-soft-2"
      >
        <Chevron className="size-3.5 flex-none" />
        <span className="min-w-0 truncate">
          {t("rightPanel.progressCompleted", { count: items.length })}
        </span>
      </button>
      {open ? (
        <ol className="min-w-0 space-y-0.5 pt-0.5">
          {items.map((item) => (
            <TodoRow key={item.id} item={item} label={t(`rightPanel.todoStatus.${item.status}`)} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function TodoRow({ item, label }: { item: TodoItem; label: string }) {
  const Icon = STATUS_ICON[item.status];
  const completed = item.status === "completed";
  const inProgress = item.status === "in_progress";
  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-start gap-2 px-1.5 py-1">
        <Icon
          aria-label={label}
          className={cn(
            "mt-0.5 size-4 flex-none",
            completed
              ? "text-link"
              : inProgress
                ? "animate-spin text-link"
                : "text-muted-foreground"
          )}
        />
        <TodoContent content={item.content} active={inProgress} />
      </div>
    </li>
  );
}

function TodoContent({ content, active }: { content: string; active: boolean }) {
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const updateTruncated = () => {
      const clampedHeight = element.clientHeight;
      const measure = element.cloneNode(true) as HTMLElement;
      const width = element.getBoundingClientRect().width || element.clientWidth;
      measure.removeAttribute("data-progress-todo-content");
      measure.setAttribute("data-progress-todo-measure", content);
      measure.classList.remove("line-clamp-2");
      // 用隐藏克隆测完整高度，避免 line-clamp 影响 scrollHeight。
      Object.assign(measure.style, {
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
        zIndex: "-1",
        display: "block",
        overflow: "visible",
        height: "auto",
        maxHeight: "none",
        minWidth: "0",
        whiteSpace: "normal"
      });
      measure.style.setProperty("-webkit-line-clamp", "unset");
      measure.style.setProperty("-webkit-box-orient", "initial");
      if (width > 0) {
        measure.style.width = `${width}px`;
        measure.style.maxWidth = `${width}px`;
      }
      document.body.appendChild(measure);
      const naturalHeight = measure.scrollHeight;
      measure.remove();
      const nextTruncated = naturalHeight > clampedHeight + 1;
      setTruncated((current) => (current === nextTruncated ? current : nextTruncated));
    };
    updateTruncated();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateTruncated);
      return () => window.removeEventListener("resize", updateTruncated);
    }
    const resizeObserver = new ResizeObserver(updateTruncated);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [content]);

  const text = (
    <p
      ref={contentRef}
      data-progress-todo-content={content}
      data-progress-todo-truncated={truncated ? "true" : "false"}
      className={cn(
        "line-clamp-2 min-w-0 flex-1 break-words text-body-xs",
        active
          ? "font-medium [color:rgb(var(--foreground))]"
          : "[color:rgb(var(--muted-foreground))]"
      )}
    >
      {content}
    </p>
  );

  if (!truncated) {
    return text;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent
        align="start"
        side="left"
        className="max-w-[240px] whitespace-normal break-words text-left leading-5"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
