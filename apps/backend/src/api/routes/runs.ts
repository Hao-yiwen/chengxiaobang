import { Hono } from "hono";
import {
  approvalDecisionSchema,
  encodeSseEvent,
  type RunRequest,
  runRequestSchema
} from "@chengxiaobang/shared";
import type { AgentRunner } from "../../agent/agent-runner";
import type { AppContext } from "../context";

export function runRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.post("/runs/stream", async (c) => {
    const input = runRequestSchema.parse(await c.req.json());
    return runStreamResponse(context.runner, input);
  });

  app.post("/runs/:runId/abort", (c) => {
    return c.json({ aborted: context.runner.abort(c.req.param("runId")) });
  });

  app.post("/approvals/:toolCallId", async (c) => {
    const decision = approvalDecisionSchema.parse(await c.req.json());
    return c.json({
      accepted: context.runner.approvals.decide(
        c.req.param("toolCallId"),
        decision.approved
      )
    });
  });

  return app;
}

function runStreamResponse(runner: AgentRunner, input: RunRequest): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      // SSE comment heartbeat keeps approval waits and slow model startup alive.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      try {
        for await (const event of runner.stream(input)) {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[api] /api/runs/stream 运行失败:", message);
        controller.enqueue(
          encoder.encode(
            encodeSseEvent({ type: "run_end", runId: "setup", status: "failed", error: message })
          )
        );
      } finally {
        clearInterval(heartbeat);
      }
      controller.close();
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}
