const BAIDU_HOME_URL = "https://www.baidu.com/";
const SITE_ALIASES = new Map([
  ["百度", BAIDU_HOME_URL],
  ["baidu", BAIDU_HOME_URL],
  ["谷歌", "https://www.google.com/"],
  ["google", "https://www.google.com/"],
  ["github", "https://github.com/"],
  ["淘宝", "https://www.taobao.com/"],
  ["taobao", "https://www.taobao.com/"],
  ["天猫", "https://www.tmall.com/"],
  ["tmall", "https://www.tmall.com/"],
  ["京东", "https://www.jd.com/"],
  ["jd", "https://www.jd.com/"],
  ["知乎", "https://www.zhihu.com/"],
  ["zhihu", "https://www.zhihu.com/"],
  ["b站", "https://www.bilibili.com/"],
  ["哔哩哔哩", "https://www.bilibili.com/"],
  ["bilibili", "https://www.bilibili.com/"],
  ["微博", "https://weibo.com/"],
  ["weibo", "https://weibo.com/"],
  ["youtube", "https://www.youtube.com/"]
]);
const BLOCKED_SCHEMES = new Set(["about", "chrome", "data", "file", "ftp", "javascript", "mailto"]);

/**
 * 将地址栏输入归一化为可浏览的网页 URL。
 * - 纯端口（"5173"）→ 127.0.0.1 本地服务
 * - 站点别名（"百度" / "谷歌"）→ 对应官网
 * - 明确网址 → 补 http(s) 后访问
 * - 其它文本 → 不跳转
 */
export function normalizeBrowserUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^\d{2,5}$/.test(trimmed)) {
    return `http://127.0.0.1:${trimmed}/`;
  }

  const scheme = leadingScheme(trimmed);
  if (scheme) {
    if (scheme === "http" || scheme === "https") {
      return normalizeHttpUrl(trimmed);
    }
    if (BLOCKED_SCHEMES.has(scheme) || trimmed.toLowerCase().startsWith(`${scheme}://`)) {
      return undefined;
    }
  }

  const aliasUrl = SITE_ALIASES.get(trimmed.toLowerCase());
  if (aliasUrl) {
    return aliasUrl;
  }

  if (looksLikeWebAddress(trimmed)) {
    const protocol = looksLikeLocalAddress(trimmed) ? "http" : "https";
    return normalizeHttpUrl(`${protocol}://${trimmed}`);
  }

  return undefined;
}

function leadingScheme(input: string): string | undefined {
  const match = input.match(/^([a-z][a-z0-9+.-]*):/i);
  return match?.[1]?.toLowerCase();
}

function normalizeHttpUrl(input: string): string | undefined {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function looksLikeWebAddress(input: string): boolean {
  if (/\s/.test(input)) {
    return false;
  }
  return /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:.]+\]|(?:[a-z0-9-]+\.)+[a-z0-9-]+)(?::\d{1,5})?(?:[/?#].*)?$/i.test(
    input
  );
}

function looksLikeLocalAddress(input: string): boolean {
  return /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:.]+\])(?::\d{1,5})?(?:[/?#].*)?$/i.test(
    input
  );
}

export function localPathFromFileUrl(input: string): string | undefined {
  try {
    const url = new URL(input);
    if (url.protocol !== "file:" || url.host) {
      return undefined;
    }
    return localPathFromFileHref(url.href);
  } catch {
    return undefined;
  }
}

export function localPathFromFileHref(href: string): string | undefined {
  const prefix = "file://";
  if (!href.toLowerCase().startsWith(prefix)) {
    return undefined;
  }
  const path = decodeURIComponent(href.slice(prefix.length).split(/[?#]/, 1)[0] ?? "");
  if (/^\/[A-Za-z]:(?:\/|$)/.test(path)) {
    return path.slice(1).replace(/\//g, "\\");
  }
  return path;
}
