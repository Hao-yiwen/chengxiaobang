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
});
