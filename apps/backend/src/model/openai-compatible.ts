import type { Message, ProviderConfig } from "@chengxiaobang/shared";

export interface ModelDelta {
  type: "text" | "thinking";
  delta: string;
}

export interface ModelClient {
  streamCompletion(input: {
    provider: ProviderConfig;
    apiKey?: string;
    messages: Message[];
    signal: AbortSignal;
  }): AsyncGenerator<ModelDelta>;
  testProvider(provider: ProviderConfig, apiKey?: string): Promise<void>;
}

export class OpenAICompatibleModelClient implements ModelClient {
  async *streamCompletion(input: {
    provider: ProviderConfig;
    apiKey?: string;
    messages: Message[];
    signal: AbortSignal;
  }): AsyncGenerator<ModelDelta> {
    if (!input.apiKey) {
      yield* localFallbackStream(input.messages);
      return;
    }

    const response = await fetch(`${trimSlash(input.provider.baseURL)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.provider.model,
        messages: input.messages.map((message) => ({
          role: message.role === "tool" ? "user" : message.role,
          content: message.content
        })),
        stream: true
      }),
      signal: input.signal
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`模型请求失败 ${response.status}: ${text || response.statusText}`);
    }

    yield* parseOpenAIStream(response.body, input.signal);
  }

  async testProvider(provider: ProviderConfig, apiKey?: string): Promise<void> {
    if (!apiKey) {
      throw new Error("请先填写 API Key");
    }
    const response = await fetch(`${trimSlash(provider.baseURL)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`连接失败 ${response.status}: ${response.statusText}`);
    }
  }
}

export async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<ModelDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        return;
      }
      const parsed = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning_content?: string;
            reasoning?: string;
          };
        }>;
      };
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.reasoning_content) {
        yield { type: "thinking", delta: delta.reasoning_content };
      }
      if (delta?.reasoning) {
        yield { type: "thinking", delta: delta.reasoning };
      }
      if (delta?.content) {
        yield { type: "text", delta: delta.content };
      }
    }
  }
}

async function* localFallbackStream(messages: Message[]): AsyncGenerator<ModelDelta> {
  const latest = messages.at(-1)?.content ?? "";
  const text =
    latest.trim().length > 0
      ? `我是程小帮，已经收到：${latest.trim()}。配置模型 API Key 后，我会使用真实模型流式回复。`
      : "我是程小帮。";
  for (const char of text) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    yield { type: "text", delta: char };
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
