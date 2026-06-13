import {
  CaretDownIcon as ChevronDown,
  LightningIcon as Bolt,
  TrashIcon as Trash2
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduledTask } from "@chengxiaobang/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

function formatTime(value?: string): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function TaskStatus({ task }: { task: ScheduledTask }) {
  const { t } = useTranslation();
  if (!task.lastStatus) {
    return <span className="text-mute">{t("tasks.neverRun")}</span>;
  }
  return (
    <span className={task.lastStatus === "failed" ? "text-error-deep" : "text-body"}>
      {t(`tasks.status.${task.lastStatus}`)}
    </span>
  );
}

function isExpiredTask(task: ScheduledTask): boolean {
  // 调度器只消费带 nextRunAt 的任务；没有下次执行时间的任务归入已过期区。
  return !task.nextRunAt;
}

export function TasksView() {
  const { t } = useTranslation();
  const tasks = useAppStore((state) => state.tasks);
  const loadTasks = useAppStore((state) => state.loadTasks);
  const updateTask = useAppStore((state) => state.updateTask);
  const runTaskNow = useAppStore((state) => state.runTaskNow);
  const deleteTask = useAppStore((state) => state.deleteTask);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [expiredOpen, setExpiredOpen] = useState(false);
  const activeTasks = useMemo(() => tasks.filter((task) => !isExpiredTask(task)), [tasks]);
  const expiredTasks = useMemo(() => tasks.filter(isExpiredTask), [tasks]);
  const detailTask = detailTaskId ? tasks.find((task) => task.id === detailTaskId) : undefined;
  // macOS 隐藏标题栏下折叠按钮悬浮在头部左侧，标题需要让位。
  const headerInset = !sidebarOpen && window.chengxiaobang?.platform === "darwin";

  useEffect(() => {
    console.debug("[tasks-view] 进入任务页，加载定时任务");
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (detailTaskId && !detailTask) {
      console.debug("[tasks-view] 定时任务详情目标已不存在，关闭弹窗", { taskId: detailTaskId });
      setDetailTaskId(null);
    }
  }, [detailTask, detailTaskId]);

  function openTaskDetail(task: ScheduledTask): void {
    console.debug("[tasks-view] 打开定时任务详情", { taskId: task.id, name: task.name });
    setDetailTaskId(task.id);
  }

  function closeTaskDetail(): void {
    if (detailTaskId) {
      console.debug("[tasks-view] 关闭定时任务详情", { taskId: detailTaskId });
    }
    setDetailTaskId(null);
  }

  function onExpiredOpenChange(open: boolean): void {
    console.debug("[tasks-view] 切换已过期任务折叠状态", {
      open,
      count: expiredTasks.length
    });
    setExpiredOpen(open);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <header
        className={cn(
          "flex min-h-[76px] flex-none items-end border-b px-12 pb-3 pt-5 transition-[padding] duration-200 ease-out",
          // 折叠态下悬浮的 SidebarToggle 落在头部左侧，整条 drag 会抢走它的点击；
          // 此时去掉 drag（窗口拖拽仍由 .titlebar-drag 顶部 38px 提供），并给标题让位。
          headerInset ? "pl-[124px]" : "[-webkit-app-region:drag]"
        )}
      >
        <div className="min-w-0">
          <h1 className="truncate text-body-sm font-medium text-foreground">{t("tasks.title")}</h1>
          <p className="mt-0.5 text-caption text-mute">{t("tasks.subtitle")}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-12 py-4">
        {tasks.length === 0 ? (
          <Card className="border-dashed bg-canvas-soft px-4 py-4 text-body-sm text-body">
            {t("tasks.empty")}
          </Card>
        ) : (
          <div className="space-y-6">
            <section>
              <TaskSectionHeader title={t("tasks.activeTitle")} count={activeTasks.length} />
              {activeTasks.length === 0 ? (
                <Card className="mt-3 border-dashed bg-canvas-soft px-4 py-4 text-body-sm text-body">
                  {t("tasks.activeEmpty")}
                </Card>
              ) : (
                <TaskCardsGrid
                  tasks={activeTasks}
                  testId="tasks-grid"
                  onOpen={openTaskDetail}
                  onUpdate={updateTask}
                  onRunNow={runTaskNow}
                  onDelete={deleteTask}
                />
              )}
            </section>

            {expiredTasks.length > 0 ? (
              <Collapsible open={expiredOpen} onOpenChange={onExpiredOpenChange}>
                <section className="border-t border-hairline pt-4">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-sm px-1 py-1 text-left transition-colors hover:bg-canvas-soft-2"
                      aria-label={t(expiredOpen ? "tasks.collapseExpired" : "tasks.expandExpired", {
                        count: expiredTasks.length
                      })}
                    >
                      <TaskSectionHeader
                        title={t("tasks.expiredTitle")}
                        count={expiredTasks.length}
                        compact
                      />
                      <ChevronDown
                        className={cn(
                          "size-4 flex-none text-mute transition-transform",
                          expiredOpen && "rotate-180"
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <TaskCardsGrid
                      tasks={expiredTasks}
                      testId="expired-tasks-grid"
                      className="mt-3"
                      onOpen={openTaskDetail}
                      onUpdate={updateTask}
                      onRunNow={runTaskNow}
                      onDelete={deleteTask}
                    />
                  </CollapsibleContent>
                </section>
              </Collapsible>
            ) : null}
          </div>
        )}
      </div>

      <TaskDetailDialog task={detailTask} open={detailTask != null} onOpenChange={closeTaskDetail} />
    </section>
  );
}

function TaskSectionHeader(props: { title: string; count: number; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", props.compact ? "min-w-0" : "")}>
      <h2 className="font-mono text-caption tracking-[0.28px] text-mute">{props.title}</h2>
      <span className="rounded-full bg-canvas-soft-2 px-2 py-0.5 text-micro text-mute">
        {props.count}
      </span>
    </div>
  );
}

function TaskCardsGrid(props: {
  tasks: ScheduledTask[];
  testId: string;
  className?: string;
  onOpen(task: ScheduledTask): void;
  onUpdate(id: string, input: { enabled: boolean }): Promise<void>;
  onRunNow(id: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}) {
  return (
    <div
      data-testid={props.testId}
      className={cn("mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2", props.className)}
    >
      {props.tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onOpen={props.onOpen}
          onUpdate={props.onUpdate}
          onRunNow={props.onRunNow}
          onDelete={props.onDelete}
        />
      ))}
    </div>
  );
}

function TaskCard(props: {
  task: ScheduledTask;
  onOpen(task: ScheduledTask): void;
  onUpdate(id: string, input: { enabled: boolean }): Promise<void>;
  onRunNow(id: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}) {
  const { t } = useTranslation();
  const { task } = props;
  const scheduleText =
    task.nextRunAt || task.kind !== "once"
      ? t("tasks.nextRun", { time: formatTime(task.nextRunAt) })
      : t("tasks.plannedRun", { time: formatTime(task.runAt) });
  const showEnabledSwitch = !(task.kind === "once" && !task.nextRunAt);

  return (
    <Card
      asChild
      className="min-h-[148px] cursor-pointer px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-canvas-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <article
        role="button"
        tabIndex={0}
        aria-label={t("tasks.viewDetail", { name: task.name })}
        onClick={() => props.onOpen(task)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onOpen(task);
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-body-sm font-medium text-foreground">{task.name}</h2>
          </div>
          <div
            className="flex flex-none items-center gap-1 [-webkit-app-region:no-drag]"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {showEnabledSwitch ? (
              <Switch
                checked={task.enabled}
                aria-label={t("tasks.toggle", { name: task.name })}
                onCheckedChange={(enabled) => {
                  console.debug("[tasks-view] 切换定时任务启用状态", {
                    taskId: task.id,
                    enabled
                  });
                  void props.onUpdate(task.id, { enabled });
                }}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("tasks.runNow")}
              className="size-8 rounded-xs"
              onClick={() => {
                console.debug("[tasks-view] 立即执行定时任务", { taskId: task.id });
                void props.onRunNow(task.id);
              }}
            >
              <Bolt className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("tasks.delete")}
              className="size-8 rounded-xs text-muted-foreground hover:text-error-deep"
              onClick={() => {
                console.debug("[tasks-view] 删除定时任务", { taskId: task.id });
                void props.onDelete(task.id);
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-caption leading-relaxed text-body">
          {task.prompt}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-hairline pt-3 text-caption">
          <span className="min-w-0 truncate text-mute">{scheduleText}</span>
          <span className="flex-none">
            <TaskStatus task={task} />
          </span>
        </div>
      </article>
    </Card>
  );
}

/** 定时任务详情弹窗：列表卡只放摘要，完整计划、历史和错误信息在这里查看。 */
function TaskDetailDialog(props: {
  task: ScheduledTask | undefined;
  open: boolean;
  onOpenChange(): void;
}) {
  const { t } = useTranslation();
  const { task, open, onOpenChange } = props;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? undefined : onOpenChange())}>
      <DialogContent className="max-w-[620px] gap-0 p-0">
        {task ? (
          <>
            <DialogHeader className="items-start gap-2 border-b px-7 pb-4 pt-7 text-left sm:text-left">
              <span className="font-mono text-micro text-mute">{t("tasks.detailTitle")}</span>
              <div className="flex w-full min-w-0 items-start justify-between gap-3">
                <DialogTitle className="min-w-0 truncate text-body-lg">{task.name}</DialogTitle>
                <span className="flex-none text-caption">
                  <TaskStatus task={task} />
                </span>
              </div>
              <DialogDescription className="whitespace-pre-wrap text-caption leading-relaxed text-body">
                {task.prompt}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 px-7 py-5">
              <TaskDetailSection title={t("tasks.scheduleLabel")}>
                {task.kind === "once" ? (
                  <TaskDetailField
                    label={t("tasks.plannedRunLabel")}
                    value={formatTime(task.runAt)}
                  />
                ) : (
                  <>
                    <TaskDetailField label={t("tasks.cronLabel")} value={task.cron ?? "—"} mono />
                    <TaskDetailField
                      label={t("tasks.nextRunLabel")}
                      value={formatTime(task.nextRunAt)}
                    />
                  </>
                )}
                <TaskDetailField
                  label={t("tasks.lastRunLabel")}
                  value={formatTime(task.lastRunAt)}
                />
                <TaskDetailField
                  label={t("tasks.lastStatusLabel")}
                  value={<TaskStatus task={task} />}
                />
              </TaskDetailSection>

              <TaskDetailSection title={t("tasks.executionLabel")}>
                <TaskDetailField
                  label={t("tasks.accessLabel")}
                  value={task.fullAccess ? t("tasks.fullAccessOn") : t("tasks.approvalAccess")}
                />
                <TaskDetailField
                  label={t("tasks.createdAtLabel")}
                  value={formatTime(task.createdAt)}
                />
                <TaskDetailField
                  label={t("tasks.updatedAtLabel")}
                  value={formatTime(task.updatedAt)}
                />
              </TaskDetailSection>

              {task.lastError ? (
                <div className="rounded-sm border border-error-soft bg-error-soft/30 px-3 py-2">
                  <div className="text-micro text-error-deep">{t("tasks.lastErrorLabel")}</div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-caption leading-relaxed text-error-deep">
                    {task.lastError}
                  </p>
                </div>
              ) : null}
            </div>

            <DialogFooter className="border-t px-7 py-4">
              <Button type="button" variant="secondary" size="sm" onClick={onOpenChange}>
                {t("tasks.close")}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailSection(props: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="font-mono text-micro text-mute">{props.title}</h3>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{props.children}</div>
    </section>
  );
}

function TaskDetailField(props: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-sm border border-hairline bg-canvas-soft px-3 py-2">
      <div className="text-micro text-mute">{props.label}</div>
      <div
        className={cn(
          "mt-1 min-w-0 break-words text-caption text-foreground",
          props.mono && "font-mono"
        )}
      >
        {props.value}
      </div>
    </div>
  );
}
