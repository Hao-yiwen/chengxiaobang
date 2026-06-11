import { ArrowLeft, ArrowRight, ExternalLink, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeBrowserUrl } from "@/lib/url";
import { useAppStore } from "@/store";

/** The subset of Electron's <webview> API the toolbar drives. */
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
  const [address, setAddress] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const webviewRef = useRef<WebviewElement | null>(null);
  // Electron's <webview> tag needs the desktop shell (webviewTag is enabled in
  // the main process); plain browsers and jsdom fall back to a sandboxed iframe.
  const hasWebview = Boolean(window.chengxiaobang);

  useEffect(() => setAddress(url), [url]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view || !url) {
      return;
    }
    // These fire only after the webview attaches, so calling its navigation
    // methods inside the handler is safe.
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
    if (normalized) {
      setBrowserUrl(normalized);
      setReloadNonce((value) => value + 1);
    }
  }

  function reload(): void {
    if (hasWebview && webviewRef.current) {
      webviewRef.current.reload();
    } else {
      setReloadNonce((value) => value + 1);
    }
  }

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
          <ArrowLeft className="size-3.5" />
        </button>
        <button
          type="button"
          title={t("rightPanel.forward")}
          disabled={!canGoForward}
          onClick={() => webviewRef.current?.goForward()}
          className={NAV_BUTTON_CLASS}
        >
          <ArrowRight className="size-3.5" />
        </button>
        <button
          type="button"
          title={t("rightPanel.reload")}
          disabled={!url}
          onClick={reload}
          className={NAV_BUTTON_CLASS}
        >
          <RotateCw className="size-3.5" />
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
        <button
          type="button"
          title={t("rightPanel.openExternal")}
          disabled={!url}
          onClick={() => url && window.open(url, "_blank")}
          className={NAV_BUTTON_CLASS}
        >
          <ExternalLink className="size-3.5" />
        </button>
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
          <div className="flex h-full items-center justify-center px-6 text-center text-caption text-muted-foreground">
            {t("rightPanel.browserEmpty")}
          </div>
        )}
      </div>
    </div>
  );
}
