import {
  CheckCircleIcon,
  CommentTextIcon,
  PlusIcon,
  RefreshIcon,
  WarningCircleIcon
} from "@/assets/file-type-icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectPhoneTarget, Session } from "@chengxiaobang/shared";
import { QRCodeSVG } from "qrcode.react";
import feishuLogoUrl from "../../../assets/feishu-logo.png";
import connectPhoneIllustrationUrl from "../../../assets/connect-phone-illustration.png";
import connectWechatIllustrationUrl from "../../../assets/connect-wechat-illustration.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const MIN_INSTALL_POLL_MS = 3000;
const QR_VISIBLE_TTL_SECONDS = 10 * 60;
const CONNECT_TARGETS = ["wechat", "feishu"] as const satisfies readonly ConnectPhoneTarget[];

type ConnectTarget = (typeof CONNECT_TARGETS)[number];
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

/** 手机连接页：选择微信或飞书/Lark，扫码后在桌面端管理绑定会话。 */
export function ConnectPhoneView() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const sessions = useAppStore((state) => state.sessions);
  const feishuConfig = useAppStore((state) => state.feishuConfig);
  const wechatConfig = useAppStore((state) => state.wechatConfig);
  const loadData = useAppStore((state) => state.loadData);
  const loadConnectPhoneConfig = useAppStore((state) => state.loadConnectPhoneConfig);
  const selectSession = useAppStore((state) => state.selectSession);
  const startConnectPhoneInstall = useAppStore((state) => state.startConnectPhoneInstall);
  const pollConnectPhoneInstall = useAppStore((state) => state.pollConnectPhoneInstall);

  const [activeTarget, setActiveTarget] = useState<ConnectTarget>("wechat");
  const [activeTab, setActiveTab] = useState<ConnectPhoneTab>("scan");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [install, setInstall] = useState<InstallState>(INITIAL_INSTALL_STATE);
  const installPollTimerRef = useRef<number | undefined>(undefined);
  const installExpiryTimerRef = useRef<number | undefined>(undefined);
  const installAttemptRef = useRef(0);
  const autoInstallKeyRef = useRef<string | undefined>(undefined);
  const headerInset = !sidebarOpen && window.chengxiaobang?.platform === "darwin";
  const isConfigured = isTargetConfigured(activeTarget, { feishuConfig, wechatConfig });
  const boundSessions = sessions.filter((session) => isSessionBoundToTarget(session, activeTarget));
  const illustrationUrl =
    activeTarget === "wechat" ? connectWechatIllustrationUrl : connectPhoneIllustrationUrl;

  useEffect(() => {
    let disposed = false;
    console.debug("[connect-phone] 进入连接手机页，加载连接状态");
    void loadConnectPhoneConfig().finally(() => {
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
    if (!configLoaded || activeTarget !== "wechat") {
      return;
    }
    const wechatConfigured = isTargetConfigured("wechat", { feishuConfig, wechatConfig });
    const feishuConfigured = isTargetConfigured("feishu", { feishuConfig, wechatConfig });
    if (!wechatConfigured && feishuConfigured) {
      console.info("[connect-phone] 检测到已有飞书连接，默认切到飞书管理");
      setActiveTarget("feishu");
    }
  }, [activeTarget, configLoaded, feishuConfig, wechatConfig]);

  useEffect(() => {
    cancelInstallAttempt();
    autoInstallKeyRef.current = undefined;
    setInstall(INITIAL_INSTALL_STATE);
    setActiveTab(isConfigured ? "bindings" : "scan");
    console.info("[connect-phone] 切换连接平台", {
      target: activeTarget,
      configured: isConfigured
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTarget, isConfigured]);

  useEffect(() => {
    if (activeTab === "scan") {
      return;
    }
    cancelInstallAttempt();
    autoInstallKeyRef.current = undefined;
    setInstall(INITIAL_INSTALL_STATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (!configLoaded || isConfigured || activeTab !== "scan" || install.status !== "idle") {
      return;
    }
    const wechatConfigured = isTargetConfigured("wechat", { feishuConfig, wechatConfig });
    const feishuConfigured = isTargetConfigured("feishu", { feishuConfig, wechatConfig });
    if (activeTarget === "wechat" && !wechatConfigured && feishuConfigured) {
      return;
    }
    const autoInstallKey = `${activeTarget}:${isConfigured ? "bound" : "new"}`;
    if (autoInstallKeyRef.current === autoInstallKey) {
      return;
    }
    autoInstallKeyRef.current = autoInstallKey;
    console.info("[connect-phone] 自动生成扫码二维码", { target: activeTarget });
    void startInstall(activeTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeTarget, configLoaded, feishuConfig, install.status, isConfigured, wechatConfig]);

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

  function selectTarget(target: ConnectTarget): void {
    if (target === activeTarget) {
      return;
    }
    setActiveTarget(target);
  }

  function addConnection(): void {
    console.info("[connect-phone] 点击新增连接", { target: activeTarget, activeTab });
    setActiveTab("scan");
    void startInstall(activeTarget);
  }

  function selectTab(tab: ConnectPhoneTab): void {
    setActiveTab(tab);
    if (tab === "scan") {
      void startInstall(activeTarget);
    }
  }

  function refreshBindings(): void {
    console.debug("[connect-phone] 刷新绑定列表", { target: activeTarget });
    void loadData();
  }

  function openBoundSession(sessionId: string): void {
    console.info("[connect-phone] 打开绑定会话", { target: activeTarget, sessionId });
    void selectSession(sessionId);
  }

  async function startInstall(target: ConnectTarget): Promise<void> {
    if (install.status === "loading") {
      return;
    }
    console.info("[connect-phone] 开始生成扫码二维码", { target });
    clearInstallTimers();
    const attempt = installAttemptRef.current + 1;
    installAttemptRef.current = attempt;
    setInstall({ ...INITIAL_INSTALL_STATE, status: "loading" });

    let started;
    try {
      started = await startConnectPhoneInstall({ target });
    } catch (error) {
      if (attempt !== installAttemptRef.current) {
        return;
      }
      console.warn("[connect-phone] 生成扫码二维码异常", { target, error });
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
      console.warn("[connect-phone] 生成扫码二维码失败", { target, message: started.message });
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
      console.info("[connect-phone] 二维码已过期，显示刷新按钮", {
        target,
        visibleTtlSeconds,
        platformExpiresIn: started.expiresIn
      });
      cancelInstallAttempt();
      setInstall((current) =>
        current.deviceCode === started.deviceCode && current.status === "showing"
          ? {
              ...current,
              status: "expired",
              error: t("connectPhone.installExpired")
            }
          : current
      );
    }, visibleTtlSeconds * 1000);

    const poll = async (): Promise<void> => {
      try {
        const result = await pollConnectPhoneInstall({ target, deviceCode: started.deviceCode });
        if (attempt !== installAttemptRef.current) {
          return;
        }
        if (result.done) {
          console.info("[connect-phone] 扫码连接成功", {
            target: result.target,
            status: result.status.status
          });
          cancelInstallAttempt();
          setInstall((current) => ({
            ...current,
            status: "success",
            error: ""
          }));
          setActiveTab("bindings");
          void loadConnectPhoneConfig();
          void loadData();
          return;
        }
        if (result.error) {
          console.warn("[connect-phone] 扫码连接轮询失败", { target, error: result.error });
          cancelInstallAttempt();
          setInstall((current) => ({
            ...current,
            status: "error",
            error: result.error ?? t("connectPhone.installFailed")
          }));
        }
      } catch (error) {
        if (attempt !== installAttemptRef.current) {
          return;
        }
        console.warn("[connect-phone] 扫码连接轮询异常", { target, error });
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
    if (target === "wechat") {
      void poll();
    }
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
        <div className="mx-auto grid max-w-[1040px] items-center gap-12 lg:grid-cols-[336px_minmax(0,1fr)]">
          <div className="rounded-sm border bg-background p-5" data-testid="connect-phone-panel">
            <ConnectTargetSelector activeTarget={activeTarget} onSelect={selectTarget} />
            {showTabbedManagement ? (
              <ConnectPhoneTabs
                activeTab={activeTab}
                onSelect={selectTab}
                onAddConnection={addConnection}
              />
            ) : null}
            {showScanPanel ? (
              <ScanPanel
                target={activeTarget}
                install={install}
                onRefresh={() => void startInstall(activeTarget)}
              />
            ) : (
              <BoundSessionsPanel
                target={activeTarget}
                sessions={boundSessions}
                onRefresh={refreshBindings}
                onOpenSession={openBoundSession}
              />
            )}
          </div>

          <img
            src={illustrationUrl}
            alt={
              activeTarget === "wechat"
                ? t("connectPhone.wechatIllustrationAlt")
                : t("connectPhone.feishuIllustrationAlt")
            }
            className={cn(
              "hidden max-h-[calc(100vh-140px)] w-full max-w-[560px] select-none justify-self-center object-contain lg:block",
              activeTarget === "wechat" && "scale-[0.965]"
            )}
            draggable={false}
          />
        </div>
      </div>
    </section>
  );
}

function ConnectTargetSelector(props: {
  activeTarget: ConnectTarget;
  onSelect: (target: ConnectTarget) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-5 grid grid-cols-2 gap-2" role="group" aria-label={t("connectPhone.platformLabel")}>
      {CONNECT_TARGETS.map((target) => {
        const active = props.activeTarget === target;
        return (
          <button
            key={target}
            type="button"
            aria-pressed={active}
            onClick={() => props.onSelect(target)}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-sm border px-3 text-caption font-medium transition-colors",
              active
                ? "border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground hover:border-soft-blue hover:bg-soft-blue-surface-hover hover:text-soft-blue-strong"
                : "border-border bg-background text-muted-foreground hover:bg-canvas-soft-2 hover:text-foreground"
            )}
          >
            <ProviderIcon target={target} className="size-4" />
            {t(target === "wechat" ? "connectPhone.wechatTitle" : "connectPhone.feishuTitle")}
          </button>
        );
      })}
    </div>
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
        <PlusIcon className="size-4" />
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

function ScanPanel(props: {
  target: ConnectTarget;
  install: InstallState;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h2 className="mb-5 flex items-center justify-center gap-2 text-center text-body-sm font-medium text-foreground">
        <ProviderIcon target={props.target} className="size-[20px]" />
        {t(props.target === "wechat" ? "connectPhone.wechatQrTitle" : "connectPhone.feishuQrTitle")}
      </h2>
      <QrSurface
        target={props.target}
        install={props.install}
        onRefresh={props.onRefresh}
      />
      <p className="mx-auto mt-4 max-w-[246px] text-center text-caption leading-relaxed text-muted-foreground">
        {t(props.target === "wechat" ? "connectPhone.wechatScanHint" : "connectPhone.feishuScanHint")}
      </p>
    </>
  );
}

function BoundSessionsPanel(props: {
  target: ConnectTarget;
  sessions: Session[];
  onRefresh: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const emptyHint =
    props.target === "wechat"
      ? t("connectPhone.wechatBindingsEmptyHint")
      : t("connectPhone.feishuBindingsEmptyHint");
  return (
    <div data-testid={`${props.target}-binding-panel`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-body-sm font-medium text-foreground">
          <ProviderIcon target={props.target} className="size-[20px]" />
          <span className="truncate">{t("connectPhone.bindingsTitle")}</span>
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={props.onRefresh}>
          <RefreshIcon className="size-4" />
          {t("connectPhone.refreshBindings")}
        </Button>
      </div>
      {props.sessions.length === 0 ? (
        <div
          className="flex min-h-[246px] flex-col items-center justify-center gap-3 rounded-sm border border-dashed bg-canvas-soft-2 px-4 text-center"
          data-testid={`${props.target}-binding-empty`}
        >
          <span className="flex size-10 items-center justify-center rounded-full border bg-background text-muted-foreground">
            <CommentTextIcon className="size-5" />
          </span>
          <div>
            <div className="text-caption font-medium text-foreground">
              {t("connectPhone.bindingsEmptyTitle")}
            </div>
            <p className="mt-1 max-w-[240px] text-caption leading-relaxed text-muted-foreground">
              {emptyHint}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2" data-testid={`${props.target}-binding-list`}>
          {props.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => props.onOpenSession(session.id)}
              className="flex w-full min-w-0 items-center gap-3 rounded-sm border bg-background px-3 py-2.5 text-left transition-colors hover:bg-canvas-soft-2"
            >
              <span className="flex size-8 flex-none items-center justify-center rounded-xs bg-canvas-soft-2 text-muted-foreground">
                <CommentTextIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-medium text-foreground">
                  {session.title}
                </span>
                <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                  {t(
                    props.target === "wechat"
                      ? "connectPhone.wechatBoundSessionHint"
                      : "connectPhone.feishuBoundSessionHint"
                  )}
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

function QrSurface(props: {
  target: ConnectTarget;
  install: InstallState;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  if (props.install.status === "showing" && props.install.url) {
    return (
      <QrStateFrame target={props.target}>
        <QrFrame url={props.install.url} expired={false} onRefresh={props.onRefresh} />
      </QrStateFrame>
    );
  }

  if (props.install.status === "loading") {
    return (
      <QrStateFrame target={props.target}>
        <div className="grid justify-items-center gap-3 text-caption text-muted-foreground">
          <RefreshIcon className="size-7 animate-spin" />
          <span>{t("connectPhone.installLoading")}</span>
        </div>
      </QrStateFrame>
    );
  }

  if (props.install.status === "success") {
    return (
      <QrStateFrame target={props.target}>
        <div className="grid justify-items-center gap-3">
          <CheckCircleIcon className="size-10 text-success" />
          <div className="text-caption font-medium text-foreground">
            {t("connectPhone.connected")}
          </div>
          <RefreshButton onClick={props.onRefresh} />
        </div>
      </QrStateFrame>
    );
  }

  if (props.install.status === "expired" && props.install.url) {
    return (
      <QrStateFrame target={props.target}>
        <QrFrame url={props.install.url} expired onRefresh={props.onRefresh} />
      </QrStateFrame>
    );
  }

  if (props.install.status === "expired" || props.install.status === "error") {
    const isExpired = props.install.status === "expired";
    return (
      <QrStateFrame target={props.target}>
        <div className="grid justify-items-center gap-3">
          <WarningCircleIcon className={cn("size-9", isExpired ? "text-muted-foreground" : "text-destructive")} />
          <div className="max-w-[220px] text-caption font-medium text-foreground">
            {props.install.error ||
              (isExpired ? t("connectPhone.installExpired") : t("connectPhone.installFailed"))}
          </div>
          <RefreshButton onClick={props.onRefresh} />
        </div>
      </QrStateFrame>
    );
  }

  return (
    <QrStateFrame target={props.target}>
      <div className="grid justify-items-center gap-3 text-caption text-muted-foreground">
        <RefreshIcon className="size-7 animate-spin" />
        <span>{t("connectPhone.installLoading")}</span>
      </div>
    </QrStateFrame>
  );
}

function QrStateFrame({ target, children }: { target: ConnectTarget; children: ReactNode }) {
  return (
    <div
      className="mx-auto flex size-[246px] items-center justify-center text-center"
      data-testid={`${target}-qr-surface`}
    >
      {children}
    </div>
  );
}

function QrFrame(props: { url: string; expired: boolean; onRefresh: () => void }) {
  const isImage = props.url.startsWith("data:image/");
  return (
    <div className="relative size-[246px] rounded-sm border bg-background p-3 shadow-subtle" data-testid="connect-phone-qr-frame">
      <div className={cn(props.expired && "opacity-20")}>
        {isImage ? (
          <img src={props.url} alt="" className="size-[220px] object-contain" />
        ) : (
          <QRCodeSVG value={props.url} size={220} marginSize={1} />
        )}
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
      <RefreshIcon className="size-4" />
      {t("connectPhone.installRefresh")}
    </Button>
  );
}

function ProviderIcon({ target, className }: { target: ConnectTarget; className?: string }) {
  if (target === "wechat") {
    return <WechatIcon className={className} />;
  }
  return <img src={feishuLogoUrl} alt="" aria-hidden="true" className={cn("object-contain", className)} />;
}

function WechatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M10.2 5.1C6.3 5.1 3.1 7.6 3.1 10.8c0 1.8 1 3.4 2.6 4.5l-.6 2.1 2.4-1.2c.8.2 1.7.4 2.7.4 3.9 0 7.1-2.6 7.1-5.8s-3.2-5.7-7.1-5.7Z"
        fill="#18C26E"
      />
      <path
        d="M14.4 10.4c3.3 0 6 2.1 6 4.8 0 1.5-.8 2.8-2.1 3.7l.5 1.7-2-1c-.7.2-1.5.3-2.4.3-3.3 0-6-2.1-6-4.7 0-2.7 2.7-4.8 6-4.8Z"
        fill="#35D98A"
      />
      <circle cx="7.9" cy="10.3" r="0.75" fill="white" />
      <circle cx="12.1" cy="10.3" r="0.75" fill="white" />
      <circle cx="12.6" cy="14.9" r="0.62" fill="white" />
      <circle cx="16.2" cy="14.9" r="0.62" fill="white" />
    </svg>
  );
}

function isTargetConfigured(
  target: ConnectTarget,
  input: {
    feishuConfig?: { enabled: boolean; appId: string };
    wechatConfig?: { enabled: boolean; accountId: string };
  }
): boolean {
  if (target === "wechat") {
    return Boolean(input.wechatConfig?.enabled && input.wechatConfig.accountId.trim());
  }
  return Boolean(input.feishuConfig?.enabled && input.feishuConfig.appId.trim());
}

function isSessionBoundToTarget(session: Session, target: ConnectTarget): boolean {
  return target === "wechat" ? Boolean(session.wechatChatId) : Boolean(session.feishuChatId);
}
