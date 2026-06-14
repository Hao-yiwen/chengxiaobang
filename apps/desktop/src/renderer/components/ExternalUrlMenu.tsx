import {
  forwardRef,
  isValidElement,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactElement
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import type { InstalledExternalBrowser } from "@/global";

const DEFAULT_BROWSER_ID = "default";
const DEFAULT_BROWSER_LABEL = "默认浏览器";

let browserCache: InstalledExternalBrowser[] | undefined;
let browserCachePromise: Promise<InstalledExternalBrowser[]> | undefined;
let browserDetectionFailed = false;

export function resetExternalUrlBrowserCacheForTest(): void {
  browserCache = undefined;
  browserCachePromise = undefined;
  browserDetectionFailed = false;
}

export function openExternalUrlWithDefaultBrowser(url: string): void {
  console.info("[ExternalUrlMenu] 使用默认浏览器打开外链", { url });
  window.open(url, "_blank", "noreferrer");
}

function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function detectBrowsers(): Promise<InstalledExternalBrowser[]> {
  if (browserCache) {
    return browserCache;
  }
  if (!browserCachePromise) {
    const bridge = window.chengxiaobang;
    if (!bridge?.detectExternalBrowsers) {
      browserCache = [];
      return browserCache;
    }
    console.info("[ExternalUrlMenu] 开始检测本机浏览器");
    browserCachePromise = bridge
      .detectExternalBrowsers()
      .then((browsers) => {
        browserCache = browsers;
        browserDetectionFailed = false;
        console.info("[ExternalUrlMenu] 本机浏览器检测完成", { count: browsers.length });
        return browsers;
      })
      .catch((error) => {
        browserCache = [];
        browserDetectionFailed = true;
        console.warn("[ExternalUrlMenu] 本机浏览器检测失败", {
          error: error instanceof Error ? error.message : String(error)
        });
        return browserCache;
      })
      .finally(() => {
        browserCachePromise = undefined;
      });
  }
  return browserCachePromise;
}

export function ExternalUrlMenu({
  url,
  children
}: {
  url: string;
  children: ReactElement;
}) {
  const setNotice = useAppStore((state) => state.setNotice);
  const [browsers, setBrowsers] = useState<InstalledExternalBrowser[]>(browserCache ?? []);
  const [loading, setLoading] = useState(false);

  if (!isExternalHttpUrl(url) || !isValidElement(children)) {
    return children;
  }

  async function loadBrowsers(): Promise<void> {
    if (browserCache) {
      setBrowsers(browserCache);
      return;
    }
    setLoading(true);
    const detected = await detectBrowsers();
    setBrowsers(detected);
    setLoading(false);
    if (browserDetectionFailed) {
      setNotice("浏览器检测失败，已保留默认浏览器");
      return;
    }
    if (!window.chengxiaobang?.detectExternalBrowsers) {
      return;
    }
    if (detected.length === 0) {
      console.info("[ExternalUrlMenu] 未检测到可选浏览器，仅保留默认浏览器");
    }
  }

  async function openWithBrowser(browser?: InstalledExternalBrowser): Promise<void> {
    const browserId = browser?.id ?? DEFAULT_BROWSER_ID;
    const browserName = browser?.name ?? DEFAULT_BROWSER_LABEL;
    const bridge = window.chengxiaobang;
    if (!bridge?.openExternalUrlInBrowser) {
      openExternalUrlWithDefaultBrowser(url);
      return;
    }
    const result = await bridge.openExternalUrlInBrowser(browserId, url);
    if (result.ok) {
      console.info("[ExternalUrlMenu] 外链已交给浏览器", { browserId, browserName, url });
      return;
    }
    const message = result.error ? `用 ${browserName} 打开链接失败：${result.error}` : `用 ${browserName} 打开链接失败`;
    console.warn("[ExternalUrlMenu] 外链交给浏览器失败", {
      browserId,
      browserName,
      url,
      error: result.error
    });
    setNotice(message);
  }

  return (
    <ContextMenu onOpenChange={(open) => open && void loadBrowsers()}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void openWithBrowser()}>
          {DEFAULT_BROWSER_LABEL}
        </ContextMenuItem>
        {(loading || browsers.length > 0) ? <ContextMenuSeparator /> : null}
        {loading ? (
          <ContextMenuItem disabled>正在检测浏览器...</ContextMenuItem>
        ) : (
          browsers.map((browser) => (
            <ContextMenuItem
              key={`${browser.id}:${browser.appPath}`}
              onSelect={() => void openWithBrowser(browser)}
            >
              {browser.name}
            </ContextMenuItem>
          ))
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export interface ExternalUrlAnchorProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
}

export const ExternalUrlAnchor = forwardRef<HTMLAnchorElement, ExternalUrlAnchorProps>(
  ({ href, children, className, onClick, rel, target, ...props }, ref) => {
    function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
      onClick?.(event);
      if (event.defaultPrevented) {
        return;
      }
      if (!isExternalHttpUrl(href)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      openExternalUrlWithDefaultBrowser(href);
    }

    return (
      <ExternalUrlMenu url={href}>
        <a
          ref={ref}
          href={href}
          target={target ?? "_blank"}
          rel={rel ?? "noreferrer"}
          className={cn(className)}
          onClick={handleClick}
          {...props}
        >
          {children}
        </a>
      </ExternalUrlMenu>
    );
  }
);
ExternalUrlAnchor.displayName = "ExternalUrlAnchor";
