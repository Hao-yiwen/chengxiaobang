import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { textResult } from "./tool-result";

const MAX_FETCH_CHARS = 20_000;

const fetchUrlParams = Type.Object({
  url: Type.String({ description: "要抓取的 http(s) 地址" })
});

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("仅支持 http(s) 地址");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "chengxiaobang/0.1 (+local-agent)" }
    });
    if (!response.ok) {
      throw new Error(`请求失败 ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    const text = /html/i.test(contentType) ? htmlToText(raw) : raw.trim();
    return text.length > MAX_FETCH_CHARS
      ? `${text.slice(0, MAX_FETCH_CHARS)}\n…（内容已截断，共 ${text.length} 字）`
      : text || "（无内容）";
  } finally {
    clearTimeout(timeout);
  }
}

export function createWebTools(): AgentTool<any>[] {
  const fetchUrlTool: AgentTool<typeof fetchUrlParams> = {
    name: "fetch_url",
    label: "抓取网页",
    description: "抓取一个网页或接口的内容并返回纯文本，用于联网查资料、读取文档或 API 数据。",
    parameters: fetchUrlParams,
    execute: async (_id, params) => textResult(await fetchUrl(params.url))
  };

  return [fetchUrlTool];
}
