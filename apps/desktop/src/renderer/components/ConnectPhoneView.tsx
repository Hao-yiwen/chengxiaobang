import {
  ArrowClockwiseIcon as RefreshCw,
  CheckCircleIcon as CheckCircle,
  CircleNotchIcon as Loader2,
  QrCodeIcon as QrCode,
  WarningCircleIcon as WarningCircle
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import connectPhoneIllustrationUrl from "../../../assets/connect-phone-illustration.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const MIN_INSTALL_POLL_MS = 3000;
const QR_VISIBLE_TTL_SECONDS = 10 * 60;

type InstallState = {
  status: "idle" | "loading" | "showing" | "success" | "expired" | "error";
  url: string;
  deviceCode: string;
  error: string;
};

const INITIAL_INSTALL_STATE: InstallState = {
  status: "idle",
  url: "",
  deviceCode: "",
  error: ""
};

/** 手机连接页：进入后自动生成飞书二维码，右侧直接展示手机聊天图。 */
export function ConnectPhoneView() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const startFeishuInstall = useAppStore((state) => state.startFeishuInstall);
  const pollFeishuInstall = useAppStore((state) => state.pollFeishuInstall);

  const [install, setInstall] = useState<InstallState>(INITIAL_INSTALL_STATE);
  const installPollTimerRef = useRef<number | undefined>(undefined);
  const installExpiryTimerRef = useRef<number | undefined>(undefined);
  const installAttemptRef = useRef(0);
  const headerInset = !sidebarOpen && window.chengxiaobang?.platform === "darwin";

  useEffect(() => {
    console.debug("[connect-phone] 进入连接飞书页，自动生成二维码");
    void startInstall();
    return () => cancelInstallAttempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearInstallTimers(): void {
    if (installPollTimerRef.current !== undefined) {
      window.clearInterval(installPollTimerRef.current);
      installPollTimerRef.current = undefined;
    }
    if (installExpiryTimerRef.current !== undefined) {
      window.clearTimeout(installExpiryTimerRef.current);
      installExpiryTimerRef.current = undefined;
    }
  }

  function cancelInstallAttempt(): void {
    installAttemptRef.current += 1;
    clearInstallTimers();
  }

  async function startInstall(): Promise<void> {
    if (install.status === "loading") {
      return;
    }
    console.info("[connect-phone] 开始生成飞书二维码");
    clearInstallTimers();
    const attempt = installAttemptRef.current + 1;
    installAttemptRef.current = attempt;
    setInstall({ ...INITIAL_INSTALL_STATE, status: "loading" });

    let started;
    try {
      started = await startFeishuInstall({ domain: "feishu" });
    } catch (error) {
      if (attempt !== installAttemptRef.current) {
        return;
      }
      console.warn("[connect-phone] 生成飞书二维码异常", { error });
      setInstall({
        ...INITIAL_INSTALL_STATE,
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (attempt !== installAttemptRef.current) {
      return;
    }
    if (!started.ok) {
      console.warn("[connect-phone] 生成飞书二维码失败", { message: started.message });
      setInstall({
        ...INITIAL_INSTALL_STATE,
        status: "error",
        error: started.message
      });
      return;
    }

    setInstall({
      status: "showing",
      url: started.url,
      deviceCode: started.deviceCode,
      error: ""
    });

    const visibleTtlSeconds = Math.max(1, Math.min(started.expiresIn, QR_VISIBLE_TTL_SECONDS));
    installExpiryTimerRef.current = window.setTimeout(() => {
      console.info("[connect-phone] 飞书二维码已过期，显示覆盖刷新按钮", {
        visibleTtlSeconds,
        platformExpiresIn: started.expiresIn
      });
      cancelInstallAttempt();
      setInstall((current) =>
        current.deviceCode === started.deviceCode && current.status === "showing"
          ? {
              ...current,
              status: "expired",
              error: t("settings.feishu.installExpired")
            }
          : current
      );
    }, visibleTtlSeconds * 1000);

    const poll = async (): Promise<void> => {
      try {
        const result = await pollFeishuInstall({ deviceCode: started.deviceCode });
        if (attempt !== installAttemptRef.current) {
          return;
        }
        if (result.done) {
          console.info("[connect-phone] 飞书扫码连接成功", {
            appId: result.config.appId,
            status: result.status.status
          });
          clearInstallTimers();
          setInstall((current) => ({
            ...current,
            status: "success",
            error: ""
          }));
          return;
        }
        if (result.error) {
          console.warn("[connect-phone] 飞书连接轮询失败", { error: result.error });
          cancelInstallAttempt();
          setInstall((current) => ({
            ...current,
            status: "error",
            error: result.error ?? t("settings.feishu.installFailed")
          }));
        }
      } catch (error) {
        if (attempt !== installAttemptRef.current) {
          return;
        }
        console.warn("[connect-phone] 飞书连接轮询异常", { error });
        cancelInstallAttempt();
        setInstall((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    };

    installPollTimerRef.current = window.setInterval(
      () => void poll(),
      Math.max(started.interval * 1000, MIN_INSTALL_POLL_MS)
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <header
        className={cn(
          "flex min-h-[76px] flex-none items-end justify-between gap-4 border-b px-12 pb-3 pt-5 transition-[padding] duration-200 ease-out",
          headerInset ? "pl-[124px]" : "[-webkit-app-region:drag]"
        )}
      >
        <div className="min-w-0">
          <h1 className="truncate text-body-sm font-medium text-foreground">
            {t("connectPhone.title")}
          </h1>
          <p className="mt-0.5 truncate text-caption text-mute">
            {t("connectPhone.helpText")}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-12 py-8">
        <div className="mx-auto grid max-w-[1040px] items-center gap-12 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-sm border bg-background p-5" data-testid="connect-phone-feishu-panel">
            <h2 className="mb-5 text-center text-body-sm font-medium text-foreground">
              {t("connectPhone.qrTitle")}
            </h2>
            <QrSurface install={install} onRefresh={() => void startInstall()} />
          </div>

          <img
            src={connectPhoneIllustrationUrl}
            alt={t("connectPhone.illustrationAlt")}
            className="hidden max-h-[calc(100vh-140px)] w-full select-none object-contain xl:block"
            draggable={false}
          />
        </div>
      </div>
    </section>
  );
}

function QrSurface({ install, onRefresh }: { install: InstallState; onRefresh: () => void }) {
  const { t } = useTranslation();

  if (install.status === "showing" && install.url) {
    return (
      <QrStateFrame>
        <QrFrame url={install.url} expired={false} onRefresh={onRefresh} />
      </QrStateFrame>
    );
  }

  if (install.status === "loading") {
    return (
      <QrStateFrame>
        <div className="grid justify-items-center gap-3 text-caption text-muted-foreground">
          <Loader2 className="size-7 animate-spin" />
          <span>{t("settings.feishu.installLoading")}</span>
        </div>
      </QrStateFrame>
    );
  }

  if (install.status === "success") {
    return (
      <QrStateFrame>
        <div className="grid justify-items-center gap-3">
          <CheckCircle className="size-10 text-success" />
          <div className="text-caption font-medium text-foreground">
            {t("settings.feishu.status.connected")}
          </div>
          <RefreshButton onClick={onRefresh} />
        </div>
      </QrStateFrame>
    );
  }

  if (install.status === "expired" && install.url) {
    return (
      <QrStateFrame>
        <QrFrame url={install.url} expired onRefresh={onRefresh} />
      </QrStateFrame>
    );
  }

  if (install.status === "expired" || install.status === "error") {
    const isExpired = install.status === "expired";
    return (
      <QrStateFrame>
        <div className="grid justify-items-center gap-3">
          <WarningCircle className={cn("size-9", isExpired ? "text-muted-foreground" : "text-destructive")} />
          <div className="max-w-[220px] text-caption font-medium text-foreground">
            {install.error ||
              (isExpired ? t("settings.feishu.installExpired") : t("settings.feishu.installFailed"))}
          </div>
          <RefreshButton onClick={onRefresh} />
        </div>
      </QrStateFrame>
    );
  }

  return (
    <QrStateFrame>
      <div className="grid justify-items-center gap-4">
        <QrCode className="size-10 text-muted-foreground" />
        <RefreshButton onClick={onRefresh} />
      </div>
    </QrStateFrame>
  );
}

function QrStateFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="mx-auto flex size-[246px] items-center justify-center text-center"
      data-testid="feishu-qr-surface"
    >
      {children}
    </div>
  );
}

function QrFrame(props: { url: string; expired: boolean; onRefresh: () => void }) {
  return (
    <div className="relative size-[246px] rounded-sm border bg-background p-3 shadow-subtle" data-testid="feishu-qr-frame">
      <div className={cn(props.expired && "opacity-20")}>
        <QRCodeSVG value={props.url} size={220} marginSize={1} />
      </div>
      {props.expired ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-background/75 backdrop-blur-[1px]">
          <RefreshButton onClick={props.onRefresh} />
        </div>
      ) : null}
    </div>
  );
}

function RefreshButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button type="button" size="sm" onClick={onClick}>
      <RefreshCw className="size-4" />
      {t("settings.feishu.installRefresh")}
    </Button>
  );
}
