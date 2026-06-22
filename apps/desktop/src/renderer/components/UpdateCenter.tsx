import {
  CheckCircleIcon,
  DownloadIcon,
  LightningBoltIcon,
  RefreshIcon,
  WarningCircleIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopUpdateState } from "../../common/update";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UpdateAction = "download" | "install" | "retry";

export function UpdateCenter() {
  const { t } = useTranslation();
  const [state, setState] = useState<DesktopUpdateState>();
  const [dismissedKey, setDismissedKey] = useState<string>();
  const bridge = window.chengxiaobang;

  useEffect(() => {
    let mounted = true;
    if (!bridge?.getUpdateState) {
      console.debug("[update-ui] 当前环境没有更新 bridge，跳过更新中心初始化");
      return;
    }
    void bridge.getUpdateState().then((next) => {
      if (mounted) {
        console.debug("[update-ui] 读取初始更新状态", { status: next.status });
        setState(next);
      }
    });
    const off = bridge.onUpdateState?.((next) => {
      console.debug("[update-ui] 收到更新状态", {
        status: next.status,
        availableVersion: next.availableVersion
      });
      setState(next);
    });
    return () => {
      mounted = false;
      off?.();
    };
  }, [bridge]);

  const viewModel = useMemo(() => (state ? buildUpdateViewModel(state, t) : undefined), [state, t]);
  const visible = Boolean(viewModel && state && shouldShowUpdatePanel(state));
  const stateKey = state ? updateStateKey(state) : undefined;

  if (!visible || !state || !viewModel || dismissedKey === stateKey) {
    return null;
  }

  async function runAction(action: UpdateAction): Promise<void> {
    if (!state) {
      return;
    }
    try {
      console.info("[update-ui] 用户触发更新操作", { action, status: state.status });
      if (action === "download") {
        await bridge?.downloadUpdate?.();
      } else if (action === "install") {
        await bridge?.installUpdate?.();
      } else {
        await bridge?.checkForUpdates?.({ manual: true });
      }
    } catch (error) {
      console.error("[update-ui] 更新操作失败", {
        action,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const Icon = viewModel.icon;
  const percent = Math.round(state.progress?.percent ?? 0);

  return (
    <aside
      aria-live="polite"
      className="fixed bottom-3 left-3 z-[70] w-[min(320px,calc(100vw-24px))] rounded-md border border-border bg-canvas text-foreground shadow-overlay [-webkit-app-region:no-drag]"
    >
      <div className="flex items-start gap-3 p-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 flex-none items-center justify-center rounded-xs",
            viewModel.iconClassName
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-caption font-medium">{viewModel.title}</h2>
              <p className="mt-0.5 max-h-[160px] overflow-y-auto break-words text-micro leading-snug text-muted-foreground">
                {viewModel.description}
              </p>
            </div>
            <button
              type="button"
              title={t("updates.dismiss")}
              onClick={() => {
                console.debug("[update-ui] 用户关闭更新弹窗", { status: state.status });
                setDismissedKey(stateKey);
              }}
              className="flex size-6 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
            >
              <XMarkIcon className="size-3.5" />
            </button>
          </div>
          {state.status === "downloading" ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-canvas-soft-2">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-1 text-micro text-muted-foreground">
                {t("updates.progress", { percent })}
              </div>
            </div>
          ) : null}
          {viewModel.action ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant={viewModel.action === "retry" ? "outline" : "default"}
                onClick={() => void runAction(viewModel.action!)}
              >
                {viewModel.action === "download" ? <DownloadIcon className="size-4" /> : null}
                {viewModel.action === "install" ? <LightningBoltIcon className="size-4" /> : null}
                {viewModel.action === "retry" ? <RefreshIcon className="size-4" /> : null}
                {viewModel.actionLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function shouldShowUpdatePanel(state: DesktopUpdateState): boolean {
  if (state.status === "available" || state.status === "downloading" || state.status === "downloaded") {
    return true;
  }
  return Boolean(state.isManualCheck && (state.status === "not_available" || state.status === "error" || state.status === "disabled"));
}

function updateStateKey(state: DesktopUpdateState): string {
  return [
    state.status,
    state.availableVersion ?? "",
    state.lastCheckedAt ?? "",
    state.error ?? "",
    Math.round(state.progress?.percent ?? 0)
  ].join(":");
}

function buildUpdateViewModel(
  state: DesktopUpdateState,
  t: TFunction
): {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  action?: UpdateAction;
  actionLabel?: string;
} {
  if (state.status === "available") {
    return {
      title: t("updates.availableTitle", { version: state.availableVersion }),
      description: t("updates.availableDesc", { current: state.currentVersion }),
      icon: DownloadIcon,
      iconClassName: "bg-link-bg-soft text-link",
      action: "download",
      actionLabel: t("updates.download")
    };
  }
  if (state.status === "downloading") {
    return {
      title: t("updates.downloadingTitle"),
      description: t("updates.downloadingDesc", { version: state.availableVersion }),
      icon: DownloadIcon,
      iconClassName: "bg-canvas-soft-2 text-foreground"
    };
  }
  if (state.status === "downloaded") {
    return {
      title: t("updates.downloadedTitle"),
      description: t("updates.downloadedDesc", { version: state.availableVersion }),
      icon: CheckCircleIcon,
      iconClassName: "bg-link-bg-soft text-link",
      action: "install",
      actionLabel: t("updates.install")
    };
  }
  if (state.status === "not_available") {
    return {
      title: t("updates.notAvailableTitle"),
      description: t("updates.notAvailableDesc", { current: state.currentVersion }),
      icon: CheckCircleIcon,
      iconClassName: "bg-canvas-soft-2 text-muted-foreground"
    };
  }
  if (state.status === "disabled") {
    return {
      title: t("updates.disabledTitle"),
      description: state.error ?? t("updates.disabledDesc"),
      icon: WarningCircleIcon,
      iconClassName: "bg-warning-soft text-warning-deep"
    };
  }
  if (state.status === "error") {
    return {
      title: t("updates.errorTitle"),
      description: state.error ?? t("updates.errorDesc"),
      icon: WarningCircleIcon,
      iconClassName: "bg-error-soft text-error-deep",
      action: "retry",
      actionLabel: t("updates.retry")
    };
  }
  return {
    title: t("updates.checkingTitle"),
    description: t("updates.checkingDesc"),
    icon: RefreshIcon,
    iconClassName: "bg-canvas-soft-2 text-muted-foreground"
  };
}
