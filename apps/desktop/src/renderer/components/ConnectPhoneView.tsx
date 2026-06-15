import {
  ArrowClockwiseIcon as RefreshCw,
  ChatCenteredTextIcon as MessageSquareText,
  CheckCircleIcon as CheckCircle,
  CircleNotchIcon as Loader2,
  PlusIcon as Plus,
  QrCodeIcon as QrCode,
  WarningCircleIcon as WarningCircle
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Session } from "@chengxiaobang/shared";
import { QRCodeSVG } from "qrcode.react";
import feishuLogoUrl from "../../../assets/feishu-logo.png";
import connectPhoneIllustrationUrl from "../../../assets/connect-phone-illustration.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const MIN_INSTALL_POLL_MS = 3000;
const QR_VISIBLE_TTL_SECONDS = 10 * 60;

type ConnectPhoneTab = "bindings" | "scan";

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

/** 手机连接页：未连接时扫码，已连接后管理飞书绑定会话。 */
export function ConnectPhoneView() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const sessions = useAppStore((state) => state.sessions);
  const feishuConfig = useAppStore((state) => state.feishuConfig);
  const loadData = useAppStore((state) => state.loadData);
  const loadFeishuConfig = useAppStore((state) => state.loadFeishuConfig);
  const selectSession = useAppStore((state) => state.selectSession);
  const startFeishuInstall = useAppStore((state) => state.startFeishuInstall);
  const pollFeishuInstall = useAppStore((state) => state.pollFeishuInstall);

  const [activeTab, setActiveTab] = useState<ConnectPhoneTab>("bindings");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [install, setInstall] = useState<InstallState>(INITIAL_INSTALL_STATE);
  const installPollTimerRef = useRef<number | undefined>(undefined);
  const installExpiryTimerRef = useRef<number | undefined>(undefined);
  const installAttemptRef = useRef(0);
  const autoInstallStartedRef = useRef(false);
  const configuredLogRef = useRef(false);
  const headerInset = !sidebarOpen && window.chengxiaobang?.platform === "darwin";
  const isConfigured = Boolean(feishuConfig?.enabled && feishuConfig.appId.trim());
  const boundSessions = sessions.filter((session) => session.feishuChatId);

  useEffect(() => {
    let disposed = false;
    console.debug("[connect-phone] 进入连接飞书页，加载飞书连接状态");
    void loadFeishuConfig().finally(() => {
      if (!disposed) {
        setConfigLoaded(true);
      }
    });
    return () => {
      disposed = true;
      cancelInstallAttempt();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!configLoaded) {
      return;
    }
    if (isConfigured) {
      if (!configuredLogRef.current) {
        configuredLogRef.current = true;
        console.info("[connect-phone] 已有飞书连接，默认展示绑定列表", {
          boundCount: boundSessions.length
        });
        setActiveTab("bindings");
      }
      return;
    }
    if (autoInstallStartedRef.current) {
      return;
    }
    autoInstallStartedRef.current = true;
    console.debug("[connect-phone] 未发现飞书连接，自动生成二维码");
    void startInstall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, isConfigured]);

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

  function addConnection(): void {
    console.info("[connect-phone] 点击新增飞书连接", { activeTab });
    setActiveTab("scan");
    void startInstall();
  }

  function refreshBindings(): void {
    console.debug("[connect-phone] 刷新飞书绑定列表");
    void loadData();
  }

  function openBoundSession(sessionId: string): void {
    console.info("[connect-phone] 打开飞书绑定会话", { sessionId });
    void selectSession(sessionId);
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
          setActiveTab("bindings");
          void loadData();
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

  const showTabbedManagement = configLoaded && isConfigured;
  const showScanPanel = !showTabbedManagement || activeTab === "scan";

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
        <div className="mx-auto grid max-w-[1040px] items-center gap-12 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-sm border bg-background p-5" data-testid="connect-phone-feishu-panel">
            {showTabbedManagement ? (
              <ConnectPhoneTabs
                activeTab={activeTab}
                onSelect={setActiveTab}
                onAddConnection={addConnection}
              />
            ) : null}
            {showScanPanel ? (
              <ScanPanel install={install} onRefresh={() => void startInstall()} />
            ) : (
              <BoundSessionsPanel
                sessions={boundSessions}
                onRefresh={refreshBindings}
                onOpenSession={openBoundSession}
              />
            )}
          </div>

          <img
            src={connectPhoneIllustrationUrl}
            alt={t("connectPhone.illustrationAlt")}
            className="hidden max-h-[calc(100vh-140px)] w-full max-w-[560px] select-none justify-self-center object-contain lg:block"
            draggable={false}
          />
        </div>
      </div>
    </section>
  );
}

function ConnectPhoneTabs(props: {
  activeTab: ConnectPhoneTab;
  onSelect: (tab: ConnectPhoneTab) => void;
  onAddConnection: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-5 flex items-center justify-between gap-3 border-b pb-3">
      <div className="flex min-w-0 rounded-sm bg-canvas-soft-2 p-0.5" role="tablist">
        <TabButton
          active={props.activeTab === "bindings"}
          label={t("connectPhone.bindingsTab")}
          onClick={() => props.onSelect("bindings")}
        />
        <TabButton
          active={props.activeTab === "scan"}
          label={t("connectPhone.scanTab")}
          onClick={() => props.onSelect("scan")}
        />
      </div>
      <button
        type="button"
        aria-label={t("connectPhone.addConnection")}
        title={t("connectPhone.addConnection")}
        onClick={props.onAddConnection}
        className="flex size-8 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

function TabButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={cn(
        "h-7 rounded-xs px-3 text-caption transition-colors",
        props.active
          ? "bg-background font-medium text-foreground shadow-hairline"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {props.label}
    </button>
  );
}

function ScanPanel({ install, onRefresh }: { install: InstallState; onRefresh: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <h2 className="mb-5 flex items-center justify-center gap-2 text-center text-body-sm font-medium text-foreground">
        <img
          src={feishuLogoUrl}
          alt=""
          aria-hidden="true"
          className="size-[20px] flex-none object-contain"
        />
        {t("connectPhone.qrTitle")}
      </h2>
      <QrSurface install={install} onRefresh={onRefresh} />
    </>
  );
}

function BoundSessionsPanel(props: {
  sessions: Session[];
  onRefresh: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="feishu-binding-panel">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-body-sm font-medium text-foreground">
          <img
            src={feishuLogoUrl}
            alt=""
            aria-hidden="true"
            className="size-[20px] flex-none object-contain"
          />
          <span className="truncate">{t("connectPhone.bindingsTitle")}</span>
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={props.onRefresh}>
          <RefreshCw className="size-4" />
          {t("connectPhone.refreshBindings")}
        </Button>
      </div>
      {props.sessions.length === 0 ? (
        <div
          className="flex min-h-[246px] flex-col items-center justify-center gap-3 rounded-sm border border-dashed bg-canvas-soft-2 px-4 text-center"
          data-testid="feishu-binding-empty"
        >
          <span className="flex size-10 items-center justify-center rounded-full border bg-background text-muted-foreground">
            <MessageSquareText className="size-5" />
          </span>
          <div>
            <div className="text-caption font-medium text-foreground">
              {t("connectPhone.bindingsEmptyTitle")}
            </div>
            <p className="mt-1 max-w-[240px] text-caption leading-relaxed text-muted-foreground">
              {t("connectPhone.bindingsEmptyHint")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2" data-testid="feishu-binding-list">
          {props.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => props.onOpenSession(session.id)}
              className="flex w-full min-w-0 items-center gap-3 rounded-sm border bg-background px-3 py-2.5 text-left transition-colors hover:bg-canvas-soft-2"
            >
              <span className="flex size-8 flex-none items-center justify-center rounded-xs bg-canvas-soft-2 text-muted-foreground">
                <MessageSquareText className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-medium text-foreground">
                  {session.title}
                </span>
                <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                  {t("connectPhone.boundSessionHint")}
                </span>
              </span>
              <span className="flex-none text-micro font-medium text-link">
                {t("connectPhone.openSession")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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
