import { describe, expect, it } from "vitest";
import { parseOpenAIStream } from "../src/model/openai-compatible";

describe("parseOpenAIStream", () => {
  it("maps reasoning and content deltas", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"reasoning_content":"想一下","content":"你好"}}]}\n'
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n"));
        controller.close();
      }
    });

    const deltas = [];
    for await (const delta of parseOpenAIStream(body, new AbortController().signal)) {
      deltas.push(delta);
    }

    expect(deltas).toEqual([
      { type: "thinking", delta: "想一下" },
      { type: "text", delta: "你好" }
    ]);
  });

  it("accumulates streamed tool_calls and reports usage", async () => {
    const chunks = [
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"write_file","arguments":"{\\"path\\":"}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}',
      '{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15,"prompt_cache_hit_tokens":8}}'
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${chunk}\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n"));
        controller.close();
      }
    });

    const deltas = [];
    for await (const delta of parseOpenAIStream(body, new AbortController().signal)) {
      deltas.push(delta);
    }

    expect(deltas).toContainEqual({
      type: "usage",
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15, cachedPromptTokens: 8 }
    });
    expect(deltas).toContainEqual({
      type: "tool_calls",
      toolCalls: [{ id: "call_1", name: "write_file", arguments: '{"path":"a.txt"}' }]
    });
  });
});
