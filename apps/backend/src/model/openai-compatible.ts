import type {
  AssistantToolCall,
  ProviderConfig,
  TokenUsage
} from "@chengxiaobang/shared";

export type ModelRole = "system" | "user" | "assistant" | "tool";

/** A message in the live model conversation (richer than the persisted Message). */
export interface ModelMessage {
  role: ModelRole;
  content: string;
  toolCalls?: AssistantToolCall[];
  toolCallId?: string;
}

/** An OpenAI-style function tool definition advertised to the model. */
export interface ModelTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ModelDelta =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_calls"; toolCalls: AssistantToolCall[] }
  | { type: "usage"; usage: TokenUsage };

export interface StreamCompletionInput {
  provider: ProviderConfig;
  apiKey?: string;
  messages: ModelMessage[];
  tools?: ModelTool[];
  signal: AbortSignal;
}

export interface ModelClient {
  streamCompletion(input: StreamCompletionInput): AsyncGenerator<ModelDelta>;
  testProvider(provider: ProviderConfig, apiKey?: string): Promise<void>;
}

export class OpenAICompatibleModelClient implements ModelClient {
  async *streamCompletion(input: StreamCompletionInput): AsyncGenerator<ModelDelta> {
    if (!input.apiKey) {
      yield* localFallbackStream(input.messages);
      return;
    }

    const hasTools = (input.tools?.length ?? 0) > 0;
    const response = await fetch(`${trimSlash(input.provider.baseURL)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.provider.model,
        messages: input.messages.map(toWireMessage),
        stream: true,
        stream_options: { include_usage: true },
        ...(hasTools ? { tools: input.tools, tool_choice: "auto" } : {})
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

interface WireMessage {
  role: ModelRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

function toWireMessage(message: ModelMessage): WireMessage {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments }
      }))
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId
    };
  }
  return { role: message.role, content: message.content };
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<ModelDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCalls = new Map<number, ToolCallAccumulator>();

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
        yield* flushToolCalls(toolCalls);
        return;
      }
      const parsed = JSON.parse(payload) as OpenAIStreamChunk;
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
      if (delta?.tool_calls) {
        for (const call of delta.tool_calls) {
          accumulateToolCall(toolCalls, call);
        }
      }
      if (parsed.usage) {
        yield { type: "usage", usage: toTokenUsage(parsed.usage) };
      }
    }
  }
  yield* flushToolCalls(toolCalls);
}

function accumulateToolCall(
  toolCalls: Map<number, ToolCallAccumulator>,
  call: OpenAIToolCallDelta
): void {
  const index = call.index ?? 0;
  const existing =
    toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
  if (call.id) {
    existing.id = call.id;
  }
  if (call.function?.name) {
    existing.name = call.function.name;
  }
  if (call.function?.arguments) {
    existing.arguments += call.function.arguments;
  }
  toolCalls.set(index, existing);
}

function* flushToolCalls(
  toolCalls: Map<number, ToolCallAccumulator>
): Generator<ModelDelta> {
  if (toolCalls.size === 0) {
    return;
  }
  const calls: AssistantToolCall[] = [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call], offset) => ({
      id: call.id || `call_${offset}`,
      name: call.name,
      arguments: call.arguments || "{}"
    }))
    .filter((call) => call.name);
  if (calls.length > 0) {
    yield { type: "tool_calls", toolCalls: calls };
  }
  toolCalls.clear();
}

function toTokenUsage(usage: OpenAIUsage): TokenUsage {
  const cached =
    usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens:
      usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
    ...(typeof cached === "number" ? { cachedPromptTokens: cached } : {})
  };
}

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: OpenAIToolCallDelta[];
    };
  }>;
  usage?: OpenAIUsage;
}

async function* localFallbackStream(messages: ModelMessage[]): AsyncGenerator<ModelDelta> {
  const latest = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
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
