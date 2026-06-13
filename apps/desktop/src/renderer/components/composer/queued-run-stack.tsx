import {
  DotsThreeIcon as More,
  ListChecksIcon as ListChecks,
  PencilSimpleIcon as Pencil,
  PlayIcon as Play,
  SparkleIcon as Sparkles,
  TrashIcon as Trash
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import type { QueuedRunItem } from "@/store";

export function QueuedRunStack(props: {
  items: QueuedRunItem[];
  paused: boolean;
  canSteer: boolean;
  onSteer: (id: string) => void;
  onEdit: (item: QueuedRunItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onResume: () => void;
}) {
  const { t } = useTranslation();
  const visibleItems = props.items.slice(0, 3);
  const hiddenCount = Math.max(0, props.items.length - visibleItems.length);
  return (
    <div
      data-testid="composer-queue-stack"
      className="absolute bottom-full left-3 right-3 z-20 mb-1.5 rounded-lg border border-border bg-card/95 p-1 shadow-[0_8px_18px_rgba(0,0,0,0.05)] backdrop-blur"
    >
      {visibleItems.map((item, index) => (
        <div
          key={item.id}
          className="group flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-canvas-soft-2/70"
        >
          <span className="flex size-5 flex-none items-center justify-center rounded-sm bg-canvas-soft-2 text-[11px] font-medium leading-none text-muted-foreground">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {props.paused ? (
                <span className="flex-none text-[11px] font-medium leading-4 text-muted-foreground">
                  {t("composer.queuePaused")}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-foreground">
                {item.content.trim() || t("composer.queueAttachmentOnly")}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-micro text-muted-foreground">
              <span>
                {item.displayAttachments.length > 0
                  ? t("composer.queueAttachmentCount", {
                      count: item.displayAttachments.length
                    })
                  : t("composer.queueWaiting")}
              </span>
              {index === 0 && props.paused ? (
                <button
                  type="button"
                  onClick={props.onResume}
                  className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 font-medium text-link transition-colors hover:bg-link/10"
                >
                  <Play className="size-3" />
                  {t("composer.queueResume")}
                </button>
              ) : null}
            </div>
          </div>
          {props.canSteer ? (
            <button
            type="button"
            title={t("composer.queueSteer")}
            aria-label={t("composer.queueSteer")}
            onClick={() => props.onSteer(item.id)}
            className="inline-flex h-6 flex-none items-center gap-1 rounded-sm border border-border bg-background px-1.5 text-caption font-medium text-foreground transition-colors hover:bg-canvas-soft-2"
          >
            <Sparkles className="size-3" />
            {t("composer.queueSteer")}
          </button>
        ) : null}
        <button
          type="button"
          title={t("composer.queueEdit")}
          aria-label={t("composer.queueEdit")}
          onClick={() => props.onEdit(item)}
          className="flex size-6 flex-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          title={t("composer.queueRemove")}
          aria-label={t("composer.queueRemove")}
          onClick={() => props.onRemove(item.id)}
          className="flex size-6 flex-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-destructive"
        >
          <Trash className="size-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
              <button
              type="button"
              title={t("composer.queueMore")}
              aria-label={t("composer.queueMore")}
              className="flex size-6 flex-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
            >
              <More className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onSelect={() => props.onEdit(item)}>
                <Pencil className="size-4 text-muted-foreground" />
                {t("composer.queueEdit")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={props.onClear}>
                <ListChecks className="size-4 text-muted-foreground" />
                {t("composer.queueClear")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div className="mx-1 mb-0.5 mt-0.5 rounded-md bg-canvas-soft px-2 py-1 text-caption text-muted-foreground">
          {t("composer.queueHidden", { count: hiddenCount })}
        </div>
      ) : null}
    </div>
  );
}
