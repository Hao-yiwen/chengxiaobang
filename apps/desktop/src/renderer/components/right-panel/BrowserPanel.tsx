import {
  ArrowLeftIcon,
  ArrowTopRightIcon,
  GlobeOutlineIcon,
  RefreshIcon
} from "@/assets/file-type-icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalUrlMenu, openExternalUrlWithDefaultBrowser } from "@/components/ExternalUrlMenu";
import { localPathFromFileUrl, normalizeBrowserUrl } from "@/lib/url";
import { useAppStore } from "@/store";

/** 工具栏会调用的 Electron <webview> API 子集。 */
interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
}

const NAV_BUTTON_CLASS =
  "flex size-7 flex-none items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export function BrowserPanel() {
  const { t } = useTranslation();
  const url = useAppStore((state) => state.browserUrl);
  const setBrowserUrl = useAppStore((state) => state.setBrowserUrl);
  const setNotice = useAppStore((state) => state.setNotice);
  const [address, setAddress] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const webviewRef = useRef<WebviewElement | null>(null);
  // Electron 的 <webview> 需要桌面壳层支持；普通浏览器和 jsdom 回退到沙箱 iframe。
  const hasWebview = Boolean(window.chengxiaobang);
  const currentLocalPath = url ? localPathFromFileUrl(url) : undefined;

  useEffect(() => setAddress(url), [url]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view || !url) {
      return;
    }
    // 这些事件只会在 webview 挂载后触发，因此处理函数里可以安全读取导航状态。
    const sync = () => {
      setCanGoBack(view.canGoBack());
      setCanGoForward(view.canGoForward());
      setAddress(view.getURL());
    };
    view.addEventListener("did-navigate", sync);
    view.addEventListener("did-navigate-in-page", sync);
    return () => {
      view.removeEventListener("did-navigate", sync);
      view.removeEventListener("did-navigate-in-page", sync);
    };
  }, [url, hasWebview, reloadNonce]);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const normalized = normalizeBrowserUrl(address);
    if (!normalized) {
      console.warn("[BrowserPanel] 忽略无效地址栏输入", { input: address });
      return;
    }
    console.info("[BrowserPanel] 地址栏导航", { input: address, url: normalized });
    setBrowserUrl(normalized);
    setReloadNonce((value) => value + 1);
  }

  function reload(): void {
    if (hasWebview && webviewRef.current) {
      webviewRef.current.reload();
    } else {
      setReloadNonce((value) => value + 1);
    }
  }

  async function openExternal(): Promise<void> {
    if (!url) {
      return;
    }
    const localPath = localPathFromFileUrl(url);
    if (localPath) {
      const result = await window.chengxiaobang?.openPath?.(localPath);
      if (result && !result.ok) {
        console.warn("[BrowserPanel] 本地文件外部打开失败", { localPath, error: result.error });
        setNotice(result.error ? `打开文件失败：${result.error}` : t("rightPanel.fileLoadFailed"));
      }
      return;
    }
    openExternalUrlWithDefaultBrowser(url);
  }

  const externalButton = (
    <button
      type="button"
      title={t("rightPanel.openExternal")}
      disabled={!url}
      onClick={() => void openExternal()}
      className={NAV_BUTTON_CLASS}
    >
      <ArrowTopRightIcon className="size-3.5" />
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-1 border-b px-3 py-2">
        <button
          type="button"
          title={t("rightPanel.back")}
          disabled={!canGoBack}
          onClick={() => webviewRef.current?.goBack()}
          className={NAV_BUTTON_CLASS}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          title={t("rightPanel.forward")}
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward()}
          className={NAV_BUTTON_CLASS}
        >
          <ArrowLeftIcon className="size-3.5 rotate-180" />
        </button>
        <button
          type="button"
          title={t("rightPanel.reload")}
          disabled={!url}
          onClick={reload}
          className={NAV_BUTTON_CLASS}
        >
          <RefreshIcon className="size-3.5" />
        </button>
        <form onSubmit={submit} className="min-w-0 flex-1">
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={t("rightPanel.browserPlaceholder")}
            aria-label={t("rightPanel.browserPlaceholder")}
            spellCheck={false}
            className="h-7 w-full rounded-xs border bg-muted/40 px-2.5 font-mono text-micro outline-none transition-colors focus:border-form-focus"
          />
        </form>
        {url && !currentLocalPath ? (
          <ExternalUrlMenu url={url}>{externalButton}</ExternalUrlMenu>
        ) : (
          externalButton
        )}
      </div>
      <div className="min-h-0 flex-1">
        {url ? (
          hasWebview ? (
            <webview
              key={`view:${reloadNonce}`}
              ref={(element) => {
                webviewRef.current = element as WebviewElement | null;
              }}
              src={url}
              partition="persist:chengxiaobang-browser"
              webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
              className="h-full w-full bg-white"
            />
          ) : (
            <iframe
              key={`frame:${reloadNonce}`}
              title={t("rightPanel.browser")}
              src={url}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
              className="h-full w-full border-0 bg-white"
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="flex max-w-[320px] flex-col items-center gap-3 text-caption leading-relaxed text-muted-foreground">
              <GlobeOutlineIcon
                aria-hidden="true"
                data-testid="browser-empty-icon"
                className="size-12 flex-none text-muted-foreground"
              />
              <p>{t("rightPanel.browserEmpty")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
