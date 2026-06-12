import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type StreamOptions,
  type Usage
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

export interface ScriptedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ScriptedTurn {
  thinking?: string;
  text?: string;
  toolCalls?: ScriptedToolCall[];
  usage?: Partial<Usage>;
  /** End the turn as a provider error instead of a normal stop. */
  error?: string;
  /** End the turn as aborted after streaming any text/thinking. */
  abort?: boolean;
  /** Runs before the turn's events are emitted — e.g. trigger runner.abort(). */
  onStart?: () => void | Promise<void>;
}

export interface CapturedCall {
  model: Model<any>;
  context: Context;
  options?: StreamOptions;
}

/**
 * The model-side test seam: a pi StreamFn that replays scripted turns and
 * records every (model, context, options) call so tests can assert exactly
 * what the model was shown.
 */
export function scriptedStreamFn(turns: ScriptedTurn[]): {
  streamFn: StreamFn;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const remaining = [...turns];

  const streamFn: StreamFn = (model, context, options) => {
    calls.push({ model, context, options });
    const turn = remaining.shift();
    const stream = createAssistantMessageEventStream();
    if (!turn) {
      const message = buildMessage(model, { error: "scripted stream exhausted" });
      stream.push({ type: "error", reason: "error", error: message });
      return stream;
    }

    void (async () => {
      await turn.onStart?.();
      const message = buildMessage(model, turn);
      stream.push({ type: "start", partial: message });
      let contentIndex = 0;
      if (turn.thinking) {
        stream.push({ type: "thinking_start", contentIndex, partial: message });
        stream.push({
          type: "thinking_delta",
          contentIndex,
          delta: turn.thinking,
          partial: message
        });
        stream.push({
          type: "thinking_end",
          contentIndex,
          content: turn.thinking,
          partial: message
        });
        contentIndex += 1;
      }
      if (turn.text) {
        stream.push({ type: "text_start", contentIndex, partial: message });
        stream.push({ type: "text_delta", contentIndex, delta: turn.text, partial: message });
        stream.push({ type: "text_end", contentIndex, content: turn.text, partial: message });
        contentIndex += 1;
      }
      for (const toolCall of turn.toolCalls ?? []) {
        stream.push({ type: "toolcall_start", contentIndex, partial: message });
        stream.push({
          type: "toolcall_end",
          contentIndex,
          toolCall: { type: "toolCall", ...toolCall },
          partial: message
        });
        contentIndex += 1;
      }
      if (turn.error !== undefined || turn.abort) {
        stream.push({
          type: "error",
          reason: turn.abort ? "aborted" : "error",
          error: message
        });
      } else {
        stream.push({
          type: "done",
          reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
          message
        });
      }
    })();

    return stream;
  };

  return { streamFn, calls };
}

function buildMessage(model: Model<any>, turn: ScriptedTurn): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (turn.thinking) {
    content.push({ type: "thinking", thinking: turn.thinking });
  }
  if (turn.text) {
    content.push({ type: "text", text: turn.text });
  }
  for (const toolCall of turn.toolCalls ?? []) {
    content.push({ type: "toolCall", ...toolCall });
  }
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 3,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 8,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      ...turn.usage
    },
    stopReason:
      turn.error !== undefined
        ? "error"
        : turn.abort
          ? "aborted"
          : (turn.toolCalls?.length ?? 0) > 0
            ? "toolUse"
            : "stop",
    ...(turn.error !== undefined ? { errorMessage: turn.error } : {}),
    timestamp: Date.now()
  };
}
