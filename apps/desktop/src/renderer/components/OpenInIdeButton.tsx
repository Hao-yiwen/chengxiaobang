import { ChevronIcon } from "@/assets/file-type-icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstalledProjectOpener } from "../global";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { selectActiveProject, useAppStore } from "@/store";

export function OpenInIdeButton() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const [openers, setOpeners] = useState<InstalledProjectOpener[]>([]);
  const [loading, setLoading] = useState(false);
  const path = project?.path;
  const desktopBridgeReady = Boolean(
    window.chengxiaobang?.detectProjectOpeners &&
      window.chengxiaobang?.openProjectInApp
  );

  useEffect(() => {
    setOpeners([]);
    if (!path || !window.chengxiaobang?.detectProjectOpeners) {
      if (path) {
        console.warn("[open-project] 当前环境缺少项目打开器 bridge", { projectPath: path });
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.chengxiaobang
      .detectProjectOpeners()
      .then((detected) => {
        if (!cancelled) {
          console.debug("[open-project] 本机项目打开器检测完成", {
            projectPath: path,
            count: detected.length
          });
          setOpeners(detected);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("[open-project] 本机项目打开器检测失败", { projectPath: path, error });
          setOpeners([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) {
    return null;
  }

  const projectPath = path;

  function onOpenChange(open: boolean): void {
    if (open) {
      if (!window.chengxiaobang?.detectProjectOpeners) {
        console.warn("[open-project] 菜单打开失败：当前环境缺少项目打开器 bridge", {
          projectPath
        });
        return;
      }
      setLoading(true);
      void window.chengxiaobang
        .detectProjectOpeners()
        .then((detected) => {
          console.debug("[open-project] 菜单打开时刷新项目打开器", {
            projectPath,
            count: detected.length
          });
          setOpeners(detected);
        })
        .catch((error) => {
          console.error("[open-project] 菜单打开时刷新项目打开器失败", {
            projectPath,
            error
          });
          setOpeners([]);
        })
        .finally(() => setLoading(false));
    }
  }

  async function openWith(opener: InstalledProjectOpener): Promise<void> {
    if (!window.chengxiaobang?.openProjectInApp) {
      console.error("[open-project] 打开项目失败：当前环境缺少项目打开 bridge", {
        opener: opener.name,
        projectPath
      });
      return;
    }
    const result = await window.chengxiaobang?.openProjectInApp?.(opener.appPath, projectPath);
    if (result && !result.ok) {
      console.error("[open-project] 打开项目失败", {
        opener: opener.name,
        projectPath,
        error: result.error
      });
    }
  }

  const triggerOpener = openers[0];

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("ide.openProjectInApp")}
          aria-label={t("ide.openProjectInApp")}
          className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-canvas-soft px-2.5 text-foreground transition-colors hover:bg-canvas-soft-2 data-[state=open]:bg-canvas-soft-2"
        >
          {triggerOpener?.iconDataUrl ? (
            <img
              src={triggerOpener.iconDataUrl}
              alt=""
              className="size-5 rounded-sm object-contain"
              draggable={false}
            />
          ) : (
            <span
              aria-hidden
              className="block size-5 rounded-sm bg-canvas-soft-2 shadow-hairline"
            />
          )}
          <ChevronIcon className="size-3.5 text-body" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-[200px] rounded-lg border border-border bg-canvas p-1.5 shadow-modal"
      >
        {openers.length === 0 ? (
          <DropdownMenuItem disabled className="h-8 text-sm text-body">
            {loading
              ? t("ide.detecting")
              : desktopBridgeReady
                ? t("ide.noneDetected")
                : t("ide.desktopOnly")}
          </DropdownMenuItem>
        ) : (
          openers.map((opener) => (
            <DropdownMenuItem
              key={opener.id}
              className="h-8 cursor-pointer gap-2.5 rounded-md px-2 text-sm text-ink"
              onSelect={() => void openWith(opener)}
            >
              {opener.iconDataUrl ? (
                <img
                  src={opener.iconDataUrl}
                  alt=""
                  className="size-[18px] shrink-0 rounded object-contain"
                  draggable={false}
                />
              ) : (
                <span
                  aria-hidden
                  className="block size-[18px] shrink-0 rounded bg-canvas-soft-2 shadow-hairline"
                />
              )}
              <span className="truncate">{opener.name}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
