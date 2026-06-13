import {
  CheckCircleIcon as CheckCircle,
  CircleIcon as Circle,
  CircleDashedIcon as CircleDashed,
  MinusCircleIcon as MinusCircle,
  type Icon
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  deriveTodoState,
  todoCurrentItem,
  type TodoItem,
  type TodoState,
  type TodoStatus
} from "@chengxiaobang/shared";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const STATUS_ICON: Record<TodoStatus, Icon> = {
  pending: Circle,
  in_progress: CircleDashed,
  completed: CheckCircle,
  skipped: MinusCircle
};

/** 对话右侧的轻量进度浮层：只展示 AI 当前 todo，不占用右侧工作区面板。 */
export function ProgressFloatingPanel() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.progressPanelOpen);
  const toolHistory = useAppStore((state) => state.toolHistory);
  const activeRunId = useAppStore((state) => state.activeRunId);
  const todo = useMemo(() => {
    const active = activeRunId
      ? deriveTodoState(toolHistory, { runId: activeRunId })
      : undefined;
    return active ?? deriveTodoState(toolHistory);
  }, [activeRunId, toolHistory]);

  if (!open || !todo) {
    return null;
  }

  const showingActiveRun = Boolean(activeRunId && todo.runId === activeRunId);
  const done = todo.items.filter(
    (item) => item.status === "completed" || item.status === "skipped"
  ).length;
  const progress = todo.items.length > 0 ? Math.round((done / todo.items.length) * 100) : 0;
  const current = todoCurrentItem(todo);

  return (
    <aside
      data-testid="progress-floating-panel"
      aria-label={t("rightPanel.progress")}
      className="chat-progress-floating pointer-events-auto rounded-xl border bg-card/95 shadow-overlay backdrop-blur-sm"
    >
      <header className="min-w-0 border-b px-4 pb-3 pt-4">
        <div className="min-w-0">
          <div className="font-mono text-mono-label uppercase text-muted-foreground">
            {t("rightPanel.progress")}
          </div>
          <p className="mt-0.5 truncate text-caption text-body">
            {showingActiveRun ? t("rightPanel.progressLive") : t("rightPanel.progressLatest")}
          </p>
        </div>
      </header>
      <div
        data-testid="progress-floating-scroll"
        className="min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 [scrollbar-gutter:stable]"
      >
        <div className="mb-3 min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-caption font-medium text-foreground">
              {todo.title}
            </h3>
            <span className="flex-none font-mono text-micro text-muted-foreground">
              {t("rightPanel.progressCount", { done, total: todo.items.length })}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas-soft-2">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {current ? (
            <p className="mt-2 truncate text-micro text-muted-foreground">
              {t("rightPanel.progressCurrent", {
                index: current.index,
                total: current.total,
                title: current.item.title
              })}
            </p>
          ) : null}
        </div>
        <TodoList todo={todo} />
        {todo.latestNote ? (
          <p className="mt-3 line-clamp-3 rounded-sm bg-canvas-soft-2 px-2.5 py-2 text-micro leading-relaxed text-body">
            {todo.latestNote.note}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function TodoList({ todo }: { todo: TodoState }) {
  const { t } = useTranslation();
  return (
    <ol className="min-w-0 space-y-1.5">
      {todo.items.map((item) => (
        <TodoRow
          key={item.id}
          item={item}
          label={t(`rightPanel.todoStatus.${item.status}`)}
        />
      ))}
    </ol>
  );
}

function TodoRow({ item, label }: { item: TodoItem; label: string }) {
  const Icon = STATUS_ICON[item.status];
  return (
    <li className="min-w-0 rounded-sm border bg-canvas px-2.5 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <Icon
          className={cn(
            "mt-0.5 size-4 flex-none",
            item.status === "completed"
              ? "text-link"
              : item.status === "in_progress"
                ? "text-foreground"
                : "text-muted-foreground"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
              {item.title}
            </p>
            <span className="flex-none font-mono text-micro text-muted-foreground">
              {label}
            </span>
          </div>
          {item.detail ? (
            <p className="mt-1 line-clamp-2 text-micro leading-relaxed text-muted-foreground">
              {item.detail}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
