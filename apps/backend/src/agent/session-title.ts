import type { Context } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ProviderConfig } from "@chengxiaobang/shared";
import { buildModel, buildModelStreamOptions } from "../model/pi-model";

/** Cap on how much of the user prompt is sent to the title model. */
const MAX_PROMPT_CHARS = 2000;
/** Hard cap on the stored title, above the prompt's soft 12-char ask. */
const MAX_TITLE_CHARS = 20;

const TITLE_PROMPT = [
  "你是一个会话命名助手。根据用户的第一条消息，为这个对话生成一个简短的中文标题。",
  "要求：",
  "- 概括用户的意图，而不是复述原文",
  "- 不超过 12 个字",
  "- 不要任何标点、引号或解释，直接输出标题本身"
].join("\n");

/**
 * Model request asking for a session title — exported so the prompt stays
 * unit-testable without the runner.
 */
export function buildTitleContext(prompt: string): Context {
  const compact = prompt.trim();
  const clipped = compact.length > MAX_PROMPT_CHARS ? compact.slice(0, MAX_PROMPT_CHARS) : compact;
  return {
    systemPrompt: TITLE_PROMPT,
    messages: [{ role: "user", content: clipped, timestamp: Date.now() }]
  };
}

/**
 * Clean a raw model answer into a sidebar-ready title: first line only,
 * wrapping quotes/brackets and trailing punctuation stripped, hard-capped in
 * length. Returns undefined when nothing usable remains.
 */
export function normalizeTitle(raw: string): string | undefined {
  const firstLine = raw.trim().split("\n")[0] ?? "";
  const cleaned = firstLine
    .replace(/^(标题|主题)[:：]\s*/, "")
    .replace(/^["'“”‘’「『《【\s]+/, "")
    .replace(/["'“”‘’」』》】\s。，,.!！?？;；:：]+$/, "")
    .trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.length > MAX_TITLE_CHARS ? cleaned.slice(0, MAX_TITLE_CHARS) : cleaned;
}

/**
 * One small model call that titles a new session from its first user message.
 * Throws on model errors — the caller decides whether to keep the fallback.
 */
export async function generateSessionTitle(options: {
  prompt: string;
  provider: ProviderConfig;
  apiKey: string;
  signal: AbortSignal;
  streamFn: StreamFn;
}): Promise<string | undefined> {
  const stream = await options.streamFn(
    buildModel(options.provider),
    buildTitleContext(options.prompt),
    {
      apiKey: options.apiKey,
      ...buildModelStreamOptions(options.provider),
      signal: options.signal
    }
  );
  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta") {
      text += event.delta;
    }
  }
  const result = await stream.result();
  if (result.stopReason === "error") {
    throw new Error(result.errorMessage ?? "模型请求失败");
  }
  // An aborted call may have streamed half a title — keep the fallback instead.
  if (result.stopReason === "aborted" || options.signal.aborted) {
    return undefined;
  }
  return normalizeTitle(text);
}
