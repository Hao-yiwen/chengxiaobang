const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 10;
const MAX_RESULT_TEXT_CHARS = 900;

interface TavilyResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
}

interface TavilyResponse {
  answer?: unknown;
  results?: unknown;
  usage?: unknown;
}

export interface TavilySearchInput {
  apiKey: string;
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
}

export async function searchTavily(input: TavilySearchInput): Promise<string> {
  const query = input.query.trim();
  if (!query) {
    throw new Error("请提供搜索关键词");
  }
  const maxResults = normalizeMaxResults(input.maxResults);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  console.info("[web-search] 发起 Tavily 搜索", {
    query,
    maxResults
  });

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "chengxiaobang/0.1 (+local-agent)"
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        topic: "general",
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false
      })
    });
    const durationMs = Date.now() - startedAt;
    console.info("[web-search] Tavily 搜索响应", {
      query,
      status: response.status,
      ok: response.ok,
      durationMs
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Tavily 搜索失败 ${response.status} ${response.statusText}${
          detail ? `：${truncateSingleLine(detail, 240)}` : ""
        }`
      );
    }
    const body = (await response.json()) as TavilyResponse;
    return formatTavilyResponse(query, body, durationMs);
  } catch (error) {
    console.warn("[web-search] Tavily 搜索失败", {
      query,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abort);
    clearTimeout(timeout);
  }
}

export function formatTavilyResponse(
  query: string,
  body: TavilyResponse,
  durationMs: number
): string {
  const results = Array.isArray(body.results)
    ? body.results.filter(isTavilyResult).slice(0, MAX_RESULTS)
    : [];
  const usage = readUsage(body.usage);
  const lines = [
    "Tavily 网络搜索结果",
    `查询：${query}`,
    `耗时：${durationMs}ms${usage ? `，用量：${usage}` : ""}`
  ];
  const answer = stringValue(body.answer);
  if (answer) {
    lines.push("", `综合摘要：${truncateText(answer, MAX_RESULT_TEXT_CHARS)}`);
  }
  if (results.length === 0) {
    lines.push("", "没有返回可用结果。");
    return lines.join("\n");
  }
  lines.push("");
  for (const [index, result] of results.entries()) {
    const title = stringValue(result.title) || "未命名结果";
    const url = stringValue(result.url) || "（无 URL）";
    const content = truncateText(stringValue(result.content) || "（无摘要）", MAX_RESULT_TEXT_CHARS);
    const score = numberValue(result.score);
    lines.push(
      `${index + 1}. ${title}`,
      `   URL：${url}`,
      `   摘要：${content}${score === undefined ? "" : `（相关度 ${score.toFixed(3)}）`}`
    );
  }
  return lines.join("\n");
}

function normalizeMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(MAX_RESULTS, Math.max(1, Math.round(value)));
}

function isTavilyResult(value: unknown): value is TavilyResult {
  return Boolean(value && typeof value === "object");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readUsage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const credits = (value as { credits?: unknown }).credits;
  return numberValue(credits) === undefined ? undefined : `${credits} credits`;
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function truncateSingleLine(text: string, max: number): string {
  return truncateText(text.replace(/\s+/g, " ").trim(), max);
}
