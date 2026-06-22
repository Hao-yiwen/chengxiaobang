import { isIP } from "node:net";
import { completeSimple, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { LRUCache } from "lru-cache";
import type TurndownService from "turndown";
import type { ProviderConfig, TokenUsage } from "@chengxiaobang/shared";
import { buildModel, buildModelStreamOptions, toTokenUsage } from "../model/pi-model";
import { errorToLogFields, getLogger } from "../logging/logger";
import { textResult } from "./tool-result";

const log = getLogger({ module: "tools/web-fetch" });

const MAX_URL_LENGTH = 2000;
const MAX_HTTP_CONTENT_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 10;
const MAX_MARKDOWN_LENGTH = 100_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024;
const ERROR_BODY_PREVIEW_BYTES = 2048;

const WEB_FETCH_USER_AGENT = "chengxiaobang/0.1 (+local-agent)";

export const webFetchParams = Type.Object({
  url: Type.String({ description: "要抓取的 http(s) 地址" }),
  prompt: Type.String({ description: "抓取后要对网页内容执行的提取、总结或分析要求" })
});

interface CachedFetchedContent {
  url: string;
  finalUrl: string;
  content: string;
  contentType: string;
  bytes: number;
  code: number;
  codeText: string;
  contentBytes: number;
}

export interface FetchedContent extends CachedFetchedContent {
  fromCache: boolean;
}

export interface RedirectInfo {
  type: "redirect";
  originalUrl: string;
  redirectUrl: string;
  statusCode: number;
}

export interface WebFetchContentProcessorInput {
  url: string;
  finalUrl: string;
  prompt: string;
  markdown: string;
  contentType: string;
  signal: AbortSignal;
}

export interface WebFetchContentProcessorResult {
  text: string;
  usage?: TokenUsage;
  providerId?: string;
  model?: string;
}

export type WebFetchContentProcessor = (
  input: WebFetchContentProcessorInput
) => Promise<WebFetchContentProcessorResult>;

export interface WebFetchRuntime {
  provider?: ProviderConfig;
  apiKey?: string;
  signal?: AbortSignal;
  processContent?: WebFetchContentProcessor;
}

const URL_CACHE = new LRUCache<string, CachedFetchedContent>({
  maxSize: MAX_CACHE_SIZE_BYTES,
  ttl: CACHE_TTL_MS,
  sizeCalculation: (entry) => Math.max(1, entry.contentBytes)
});

type TurndownConstructor = new (options?: Record<string, unknown>) => TurndownService;
let turndownServicePromise: Promise<TurndownService> | undefined;

export function createWebFetchTool(runtime?: WebFetchRuntime): AgentTool<typeof webFetchParams> {
  const processor = resolveProcessor(runtime);
  return {
    name: "WebFetch",
    label: "抓取网页",
    description:
      "抓取一个公网网页或文本接口，先将 HTML 转成 Markdown，再按 prompt 用当前会话模型提取、总结或分析内容。HTTP 会自动升级到 HTTPS；跨域重定向会返回新 URL 供再次抓取。",
    parameters: webFetchParams,
    execute: async (_id, params, signal) => {
      const startedAt = Date.now();
      const normalizedUrl = normalizeWebFetchUrl(params.url);
      if (!processor) {
        log.warn("[web-fetch] 缺少模型处理器，无法执行工具", {
          action: "web_fetch.processor_missing",
          url: safeUrlForLog(params.url)
        });
        throw new Error("WebFetch 需要当前会话的模型上下文，请在对话运行中使用。");
      }
      const activeSignal = mergeAbortSignals(runtime?.signal, signal);
      try {
        const response = await getURLMarkdownContent(params.url, activeSignal.signal, normalizedUrl);
        if (isRedirectInfo(response)) {
          return textResult(formatRedirectResult(response, params.prompt, Date.now() - startedAt));
        }
        log.info("[web-fetch] 开始用模型处理网页内容", {
          action: "web_fetch.model_process_start",
          url: safeUrlForLog(params.url),
          finalUrl: safeUrlForLog(response.finalUrl),
          contentType: response.contentType,
          chars: response.content.length,
          fromCache: response.fromCache
        });
        const processStartedAt = Date.now();
        let processed: WebFetchContentProcessorResult;
        try {
          processed = await processor({
            url: response.url,
            finalUrl: response.finalUrl,
            prompt: params.prompt,
            markdown: truncateMarkdownForModel(response.content),
            contentType: response.contentType,
            signal: activeSignal.signal
          });
        } catch (error) {
          log.warn("[web-fetch] 网页内容模型处理失败", {
            action: "web_fetch.model_process_failed",
            url: safeUrlForLog(params.url),
            finalUrl: safeUrlForLog(response.finalUrl),
            durationMs: Date.now() - processStartedAt,
            ...errorToLogFields(error)
          });
          throw new Error(
            `网页抓取成功，但内容处理失败：${error instanceof Error ? error.message : String(error)}`
          );
        }
        log.info("[web-fetch] 网页内容模型处理完成", {
          action: "web_fetch.model_process_completed",
          url: safeUrlForLog(params.url),
          finalUrl: safeUrlForLog(response.finalUrl),
          durationMs: Date.now() - processStartedAt,
          model: processed.model,
          promptTokens: processed.usage?.promptTokens,
          completionTokens: processed.usage?.completionTokens,
          totalTokens: processed.usage?.totalTokens
        });
        return textResult(formatFetchedResult(response, processed, Date.now() - startedAt));
      } finally {
        activeSignal.dispose();
      }
    }
  };
}

export function createWebFetchModelProcessor(options: {
  provider: ProviderConfig;
  apiKey: string;
}): WebFetchContentProcessor {
  return async (input) => {
    const context = buildWebFetchModelContext(input);
    const modelStreamOptions = buildModelStreamOptions(options.provider);
    const message = await completeSimple(buildModel(options.provider), context, {
      apiKey: options.apiKey,
      ...modelStreamOptions,
      timeoutMs: FETCH_TIMEOUT_MS,
      signal: input.signal
    });
    if (message.stopReason !== "stop") {
      throw new Error(message.errorMessage ?? `模型处理未正常结束：${message.stopReason}`);
    }
    return {
      text: assistantText(message) || "（模型未返回可用内容）",
      usage: toTokenUsage(message.usage),
      providerId: options.provider.id,
      model: message.responseModel ?? message.model ?? options.provider.model
    };
  };
}

export function buildWebFetchModelContext(input: WebFetchContentProcessorInput): Context {
  return {
    systemPrompt: [
      "你是程小帮的网页内容提取助手。",
      "必须只基于用户提供的网页内容回答，不要补充网页之外的事实。",
      "按用户要求提取、总结或分析；保持简洁，保留必要细节、链接、代码片段和版本信息。",
      "引用原文时要短，避免大段复制；不要复现歌词。"
    ].join("\n"),
    messages: [
      {
        role: "user",
        timestamp: Date.now(),
        content: [
          `网页 URL：${input.finalUrl}`,
          `内容类型：${input.contentType || "未知"}`,
          "",
          "网页内容：",
          "---",
          input.markdown,
          "---",
          "",
          "用户要求：",
          input.prompt
        ].join("\n")
      }
    ],
    tools: []
  };
}

export async function getURLMarkdownContent(
  inputUrl: string,
  signal?: AbortSignal,
  normalizedInput?: { url: string; parsed: URL }
): Promise<FetchedContent | RedirectInfo> {
  const normalized = normalizedInput ?? normalizeWebFetchUrl(inputUrl);
  const cached = URL_CACHE.get(inputUrl);
  if (cached) {
    log.debug("[web-fetch] 命中 URL 内容缓存", {
      action: "web_fetch.cache_hit",
      url: safeUrlForLog(inputUrl),
      finalUrl: safeUrlForLog(cached.finalUrl),
      contentBytes: cached.contentBytes
    });
    return { ...cached, fromCache: true };
  }
  log.debug("[web-fetch] URL 内容缓存未命中", {
    action: "web_fetch.cache_miss",
    url: safeUrlForLog(inputUrl)
  });
  const response = await fetchWithPermittedRedirects(normalized.url, signal);
  if ("type" in response) {
    return {
      ...response,
      originalUrl: inputUrl
    };
  }
  const content = await responseToMarkdown(response.response, response.finalUrl);
  const entry: CachedFetchedContent = {
    url: inputUrl,
    finalUrl: response.finalUrl,
    content: content.content,
    contentType: content.contentType,
    bytes: content.bytes,
    code: response.response.status,
    codeText: response.response.statusText,
    contentBytes: Buffer.byteLength(content.content)
  };
  URL_CACHE.set(inputUrl, entry);
  return { ...entry, fromCache: false };
}

export function clearWebFetchCache(): void {
  URL_CACHE.clear();
}

function resolveProcessor(runtime: WebFetchRuntime | undefined): WebFetchContentProcessor | undefined {
  if (runtime?.processContent) {
    return runtime.processContent;
  }
  if (runtime?.provider && runtime.apiKey) {
    return createWebFetchModelProcessor({ provider: runtime.provider, apiKey: runtime.apiKey });
  }
  return undefined;
}

function normalizeWebFetchUrl(input: string): { url: string; parsed: URL } {
  if (input.length > MAX_URL_LENGTH) {
    log.warn("[web-fetch] URL 过长，已拒绝抓取", {
      action: "web_fetch.url_rejected",
      reason: "too_long",
      length: input.length
    });
    throw new Error(`URL 过长，最多支持 ${MAX_URL_LENGTH} 个字符`);
  }
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    log.warn("[web-fetch] URL 解析失败，已拒绝抓取", {
      action: "web_fetch.url_rejected",
      reason: "invalid_url"
    });
    throw new Error("无效 URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    log.warn("[web-fetch] 非 http(s) URL，已拒绝抓取", {
      action: "web_fetch.url_rejected",
      reason: "unsupported_protocol",
      protocol: parsed.protocol,
      url: safeUrlForLog(input)
    });
    throw new Error("仅支持 http(s) 地址");
  }
  if (parsed.username || parsed.password) {
    log.warn("[web-fetch] URL 包含用户名或密码，已拒绝抓取", {
      action: "web_fetch.url_rejected",
      reason: "credentials",
      url: safeUrlForLog(input)
    });
    throw new Error("WebFetch 不支持包含用户名或密码的 URL");
  }
  assertPublicHostname(parsed.hostname, input);
  if (parsed.protocol === "http:") {
    parsed.protocol = "https:";
    log.info("[web-fetch] 已将 HTTP URL 升级为 HTTPS", {
      action: "web_fetch.upgrade_https",
      url: safeUrlForLog(input),
      upgradedUrl: safeUrlForLog(parsed.toString())
    });
  }
  return { url: parsed.toString(), parsed };
}

function assertPublicHostname(hostname: string, inputUrl: string): void {
  const normalized = normalizeHostname(hostname);
  const reason = localHostnameRejectReason(normalized);
  if (reason) {
    log.warn("[web-fetch] 本地或内网主机，已拒绝抓取", {
      action: "web_fetch.url_rejected",
      reason,
      hostname: normalized,
      url: safeUrlForLog(inputUrl)
    });
    throw new Error("WebFetch 只支持公网 http(s) 地址，不支持 localhost、loopback 或内网地址");
  }
}

async function fetchWithPermittedRedirects(
  url: string,
  parentSignal: AbortSignal | undefined,
  depth = 0
): Promise<{ response: Response; finalUrl: string } | RedirectInfo> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`重定向次数过多，已超过 ${MAX_REDIRECTS} 次`);
  }
  const timeout = withTimeout(parentSignal, FETCH_TIMEOUT_MS, "WebFetch 请求超时");
  try {
    log.info("[web-fetch] 发起网页抓取请求", {
      action: "web_fetch.request_start",
      url: safeUrlForLog(url),
      depth
    });
    const response = await fetch(url, {
      signal: timeout.signal,
      redirect: "manual",
      headers: {
        Accept: "text/markdown, text/html, text/plain, application/json, application/xml, */*",
        "User-Agent": WEB_FETCH_USER_AGENT
      }
    });
    log.info("[web-fetch] 收到网页抓取响应", {
      action: "web_fetch.response",
      url: safeUrlForLog(url),
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") ?? "",
      contentLength: response.headers.get("content-length") ?? ""
    });
    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("重定向响应缺少 Location 头");
      }
      const redirectUrl = new URL(location, url).toString();
      assertPublicHostname(new URL(redirectUrl).hostname, redirectUrl);
      if (isPermittedRedirect(url, redirectUrl)) {
        log.info("[web-fetch] 跟随同域重定向", {
          action: "web_fetch.redirect_follow",
          url: safeUrlForLog(url),
          redirectUrl: safeUrlForLog(redirectUrl),
          status: response.status
        });
        return fetchWithPermittedRedirects(redirectUrl, parentSignal, depth + 1);
      }
      log.info("[web-fetch] 检测到跨域重定向，已交还模型确认", {
        action: "web_fetch.redirect_cross_host",
        url: safeUrlForLog(url),
        redirectUrl: safeUrlForLog(redirectUrl),
        status: response.status
      });
      return {
        type: "redirect",
        originalUrl: url,
        redirectUrl,
        statusCode: response.status
      };
    }
    if (!response.ok) {
      throw new Error(await formatHttpFailure(response));
    }
    return { response, finalUrl: url };
  } catch (error) {
    log.warn("[web-fetch] 网页抓取请求失败", {
      action: "web_fetch.request_failed",
      url: safeUrlForLog(url),
      ...errorToLogFields(error)
    });
    throw error;
  } finally {
    timeout.dispose();
  }
}

async function responseToMarkdown(
  response: Response,
  finalUrl: string
): Promise<{ content: string; contentType: string; bytes: number }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!isSupportedTextContentType(contentType)) {
    log.warn("[web-fetch] 响应内容类型不是文本，已拒绝", {
      action: "web_fetch.content_type_rejected",
      finalUrl: safeUrlForLog(finalUrl),
      contentType
    });
    throw new Error(`WebFetch 本轮只支持网页和文本内容，不支持该内容类型：${contentType || "未知"}`);
  }
  const body = await readResponseBody(response, MAX_HTTP_CONTENT_BYTES);
  const rawText = new TextDecoder("utf-8").decode(body);
  if (isHtmlContentType(contentType)) {
    log.debug("[web-fetch] 开始将 HTML 转换为 Markdown", {
      action: "web_fetch.html_to_markdown_start",
      finalUrl: safeUrlForLog(finalUrl),
      bytes: body.byteLength
    });
    const markdown = (await getTurndownService()).turndown(stripUnsafeHtmlBlocks(rawText)).trim();
    log.debug("[web-fetch] HTML 已转换为 Markdown", {
      action: "web_fetch.html_to_markdown_completed",
      finalUrl: safeUrlForLog(finalUrl),
      bytes: body.byteLength,
      markdownChars: markdown.length
    });
    return { content: markdown || "（无内容）", contentType, bytes: body.byteLength };
  }
  return {
    content: normalizeTextContent(rawText, contentType),
    contentType,
    bytes: body.byteLength
  };
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw new Error(`响应内容过大，Content-Length=${contentLength}，上限=${maxBytes}`);
  }
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`响应内容过大，实际大小=${buffer.byteLength}，上限=${maxBytes}`);
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`响应内容过大，已超过 ${maxBytes} 字节上限`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  try {
    const original = new URL(originalUrl);
    const redirect = new URL(redirectUrl);
    if (redirect.protocol !== original.protocol || redirect.port !== original.port) {
      return false;
    }
    if (redirect.username || redirect.password) {
      return false;
    }
    return stripLeadingWww(redirect.hostname) === stripLeadingWww(original.hostname);
  } catch {
    return false;
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isRedirectInfo(value: FetchedContent | RedirectInfo): value is RedirectInfo {
  return "type" in value && value.type === "redirect";
}

function localHostnameRejectReason(hostname: string): string | undefined {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "localhost";
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return ipv4RejectReason(hostname);
  }
  if (ipVersion === 6) {
    return ipv6RejectReason(hostname);
  }
  return undefined;
}

function ipv4RejectReason(hostname: string): string | undefined {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return "invalid_ip";
  }
  const [a, b] = parts;
  if (a === 0) return "unspecified";
  if (a === 10) return "private";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link_local";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "carrier_grade_nat";
  return undefined;
}

function ipv6RejectReason(hostname: string): string | undefined {
  const normalized = hostname.toLowerCase();
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return "unspecified";
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return "loopback";
  const firstGroup = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if ((firstGroup & 0xfe00) === 0xfc00) return "unique_local";
  if ((firstGroup & 0xffc0) === 0xfe80) return "link_local";
  return undefined;
}

function isSupportedTextContentType(contentType: string): boolean {
  const mime = contentMime(contentType);
  if (!mime) {
    return true;
  }
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/xhtml+xml" ||
    mime === "application/rss+xml" ||
    mime === "application/atom+xml" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  );
}

function isHtmlContentType(contentType: string): boolean {
  const mime = contentMime(contentType);
  return mime === "text/html" || mime === "application/xhtml+xml";
}

function contentMime(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function normalizeTextContent(text: string, contentType: string): string {
  if (contentMime(contentType) === "application/json" || contentMime(contentType).endsWith("+json")) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text.trim() || "（无内容）";
    }
  }
  return text.trim() || "（无内容）";
}

function truncateMarkdownForModel(content: string): string {
  return content.length > MAX_MARKDOWN_LENGTH
    ? `${content.slice(0, MAX_MARKDOWN_LENGTH)}\n\n[内容过长，已截断到 ${MAX_MARKDOWN_LENGTH} 字符。]`
    : content;
}

function formatFetchedResult(
  response: FetchedContent,
  processed: WebFetchContentProcessorResult,
  durationMs: number
): string {
  return [
    "WebFetch 结果",
    `URL：${response.url}`,
    `最终 URL：${response.finalUrl}`,
    `HTTP：${response.code}${response.codeText ? ` ${response.codeText}` : ""}`,
    `内容类型：${response.contentType || "未知"}`,
    `原始大小：${response.bytes} bytes`,
    `缓存：${response.fromCache ? "命中" : "未命中"}`,
    `耗时：${durationMs}ms`,
    processed.model ? `处理模型：${processed.providerId ? `${processed.providerId}/` : ""}${processed.model}` : undefined,
    processed.usage ? `模型用量：${formatUsage(processed.usage)}` : undefined,
    "",
    "处理结果：",
    processed.text
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function formatRedirectResult(redirect: RedirectInfo, prompt: string, durationMs: number): string {
  const statusText = redirectStatusText(redirect.statusCode);
  return [
    "REDIRECT DETECTED: URL 重定向到了不同主机，WebFetch 未自动跟随。",
    "",
    `Original URL: ${redirect.originalUrl}`,
    `Redirect URL: ${redirect.redirectUrl}`,
    `Status: ${redirect.statusCode}${statusText ? ` ${statusText}` : ""}`,
    `耗时：${durationMs}ms`,
    "",
    "如需继续抓取，请再次调用 WebFetch：",
    `- url: "${redirect.redirectUrl}"`,
    `- prompt: "${prompt}"`
  ].join("\n");
}

function formatUsage(usage: TokenUsage): string {
  return [
    `prompt=${usage.promptTokens}`,
    `completion=${usage.completionTokens}`,
    `total=${usage.totalTokens}`,
    usage.cachedPromptTokens ? `cached=${usage.cachedPromptTokens}` : undefined,
    usage.costUsd !== undefined ? `costUsd=${usage.costUsd}` : undefined
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

async function formatHttpFailure(response: Response): Promise<string> {
  let detail = "";
  try {
    const bytes = await readResponseBody(response, ERROR_BODY_PREVIEW_BYTES);
    detail = new TextDecoder("utf-8").decode(bytes).replace(/\s+/g, " ").trim();
  } catch {
    detail = "";
  }
  return `请求失败 ${response.status} ${response.statusText}${detail ? `：${detail}` : ""}`;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stripUnsafeHtmlBlocks(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

function getTurndownService(): Promise<TurndownService> {
  return (turndownServicePromise ??= import("turndown").then((module) => {
    const Turndown = ((module as unknown as { default?: TurndownConstructor }).default ??
      module) as unknown as TurndownConstructor;
    return new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced" });
  }));
}

function withTimeout(
  parent: AbortSignal | undefined,
  ms: number,
  message: string
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abort();
  } else {
    parent?.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error(message)), ms);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    }
  };
}

function mergeAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined
): { signal: AbortSignal; dispose: () => void } {
  if (!first && !second) {
    const controller = new AbortController();
    return { signal: controller.signal, dispose: () => undefined };
  }
  const controller = new AbortController();
  const abortFirst = () => controller.abort(first?.reason);
  const abortSecond = () => controller.abort(second?.reason);
  if (first?.aborted) {
    abortFirst();
  } else {
    first?.addEventListener("abort", abortFirst, { once: true });
  }
  if (second?.aborted) {
    abortSecond();
  } else {
    second?.addEventListener("abort", abortSecond, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      first?.removeEventListener("abort", abortFirst);
      second?.removeEventListener("abort", abortSecond);
    }
  };
}

function safeUrlForLog(raw: string): string {
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.length > 120 ? `${parsed.pathname.slice(0, 120)}...` : parsed.pathname;
    const query = parsed.search ? `?query_length=${parsed.search.length - 1}` : "";
    return `${parsed.origin}${path}${query}`;
  } catch {
    return raw.length > 160 ? `${raw.slice(0, 160)}...` : raw;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function stripLeadingWww(hostname: string): string {
  return normalizeHostname(hostname).replace(/^www\./, "");
}

function redirectStatusText(status: number): string {
  switch (status) {
    case 301:
      return "Moved Permanently";
    case 302:
      return "Found";
    case 303:
      return "See Other";
    case 307:
      return "Temporary Redirect";
    case 308:
      return "Permanent Redirect";
    default:
      return "";
  }
}
