import { getEncoding, type Tiktoken } from "js-tiktoken";

import { getLogger } from "../logging/logger";

const log = getLogger({ module: "usage/token-accounting" });

export type TokenCountSource = "js_tiktoken" | "fallback_estimate";

export interface TokenCountResult {
  tokens: number;
  source: TokenCountSource;
}

export interface ModelInputSnapshot {
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
}

/**
 * 统一封装模型输入 token 估算。正常路径使用纯 JS tiktoken；
 * 失败时回退到轻量字符估算，并在费用账本里记录来源。
 */
export class TokenAccountingService {
  private encoding?: Tiktoken;

  countInputTokens(input: ModelInputSnapshot): TokenCountResult {
    const serialized = stableJson({
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      tools: input.tools
    });
    try {
      const encoding = this.getEncoding();
      return {
        tokens: encoding.encode(serialized).length,
        source: "js_tiktoken"
      };
    } catch (error) {
      log.warn("[token-accounting] tiktoken 计数失败，回退到字符估算", {
        error: error instanceof Error ? error.message : String(error),
        chars: serialized.length
      });
      return {
        tokens: estimateTextTokens(serialized),
        source: "fallback_estimate"
      };
    }
  }

  private getEncoding(): Tiktoken {
    this.encoding ??= getEncoding("cl100k_base");
    return this.encoding;
  }
}

export function estimateTextTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const cjkCount = text.match(/[\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const nonCjkCount = Math.max(0, text.length - cjkCount);
  return Math.ceil(cjkCount + nonCjkCount / 4);
}

export function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (key, next) => {
      if (typeof next === "function") {
        return undefined;
      }
      if (key === "data" && typeof next === "string" && next.length > 512) {
        return `[image-base64:${next.length}]`;
      }
      if (typeof next !== "object" || next === null) {
        return next;
      }
      if (seen.has(next)) {
        return "[Circular]";
      }
      seen.add(next);
      return next;
    }) ?? ""
  );
}
