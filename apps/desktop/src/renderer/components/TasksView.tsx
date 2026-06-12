import { LightningIcon as Bolt, TrashIcon as Trash2 } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduledTask } from "@chengxiaobang/shared";
import { Button } from "@/components/ui/button";
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

export function TasksView() {
  const { t } = useTranslation();
  const tasks = useAppStore((state) => state.tasks);
  const loadTasks = useAppStore((state) => state.loadTasks);
  const updateTask = useAppStore((state) => state.updateTask);
  const runTaskNow = useAppStore((state) => state.runTaskNow);
  const deleteTask = useAppStore((state) => state.deleteTask);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  // 侧边栏折叠后，Electron 红绿灯 + 折叠按钮悬浮在头部左侧，标题需要让位。
  const headerInset = !sidebarOpen && Boolean(window.chengxiaobang);

  useEffect(() => {
    console.debug("[tasks-view] 进入任务页，加载定时任务");
    void loadTasks();
  }, [loadTasks]);

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
          <div className="border-b border-border py-4 text-body-sm text-body">
            {t("tasks.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <article
                key={task.id}
                className="rounded-md border border-border bg-canvas px-4 py-3 shadow-stack"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-body-sm font-medium text-foreground">
                      {task.name}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-caption leading-relaxed text-body">
                      {task.prompt}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-mute">
                      <span>{t("tasks.cron", { cron: task.cron })}</span>
                      <span>{t("tasks.nextRun", { time: formatTime(task.nextRunAt) })}</span>
                      <span>
                        {t("tasks.lastRun", { time: formatTime(task.lastRunAt) })} ·{" "}
                        <TaskStatus task={task} />
                      </span>
                    </div>
                    {task.lastError ? (
                      <p className="mt-2 text-caption text-error-deep">{task.lastError}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-none items-center gap-1 [-webkit-app-region:no-drag]">
                    <Switch
                      checked={task.enabled}
                      aria-label={t("tasks.toggle", { name: task.name })}
                      onCheckedChange={(enabled) => {
                        console.debug("[tasks-view] 切换定时任务启用状态", {
                          taskId: task.id,
                          enabled
                        });
                        void updateTask(task.id, { enabled });
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={t("tasks.runNow")}
                      className="size-8 rounded-xs"
                      onClick={() => {
                        console.debug("[tasks-view] 立即执行定时任务", { taskId: task.id });
                        void runTaskNow(task.id);
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
                        void deleteTask(task.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
