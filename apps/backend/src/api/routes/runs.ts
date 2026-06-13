import { Hono } from "hono";
import {
  approvalDecisionSchema,
  encodeSseEvent,
  isStreamEvent,
  type AppEvent,
  type RunRequest,
  type RunStartResponse,
  type StreamEvent,
  runRequestSchema,
  runSteeringRequestSchema
} from "@chengxiaobang/shared";
import type { AgentRunner } from "../../agent/agent-runner";
import type { EventHub } from "../../events/event-hub";
import type { AppContext } from "../context";

const HEARTBEAT_MS = 15_000;

export function runRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.post("/runs/stream", async (c) => {
    const input = runRequestSchema.parse(await c.req.json());
    return runStreamResponse(context.runner, input);
  });

  app.post("/runs", async (c) => {
    const input = runRequestSchema.parse(await c.req.json());
    const started = await startRunAndPublish(context, input);
    return c.json(started);
  });

  app.get("/runs/active", async (c) => {
    const sessionId = c.req.query("sessionId")?.trim() || undefined;
    const runs = await context.runner.listActiveRunSnapshots(sessionId);
    console.info("[run-routes] 返回活跃 run 快照", {
      sessionId,
      count: runs.length
    });
    return c.json({ runs });
  });

  app.get("/events", (c) => eventStreamResponse(context.eventHub, c.req.raw.signal));

  app.post("/runs/:runId/abort", (c) => {
    return c.json({ aborted: context.runner.abort(c.req.param("runId")) });
  });

  app.post("/runs/:runId/steering", async (c) => {
    const runId = c.req.param("runId");
    const input = runSteeringRequestSchema.parse(await c.req.json());
    const accepted = context.runner.enqueueSteering(runId, input);
    console.info("[run-routes] 收到运行中引导", {
      runId,
      accepted,
      clientRequestId: input.clientRequestId,
      promptChars: input.prompt.length,
      displayAttachmentCount: input.displayAttachments.length,
      nativeAttachmentCount: input.attachments.length
    });
    if (!accepted) {
      return c.json({ error: "当前运行已结束，无法注入引导" }, 409);
    }
    return c.json({ accepted: true });
  });

  app.post("/approvals/:toolCallId", async (c) => {
    const decision = approvalDecisionSchema.parse(await c.req.json());
    console.info(
      `[run-routes] 收到审批决议 toolCallId=${c.req.param("toolCallId")} approved=${decision.approved}`
    );
    return c.json({
      accepted: context.runner.approvals.decide(c.req.param("toolCallId"), decision)
    });
  });

  return app;
}

function runStreamResponse(runner: AgentRunner, input: RunRequest): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      // SSE 注释心跳用于维持审批等待和慢模型启动期间的连接。
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      try {
        for await (const event of runner.stream(input)) {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[api] /api/runs/stream 运行失败:", message);
        controller.enqueue(
          encoder.encode(
            encodeSseEvent({ type: "setup_error", error: message })
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

function eventStreamResponse(eventHub: EventHub<AppEvent>, signal: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      try {
        for await (const event of eventHub.subscribe(signal)) {
          controller.enqueue(encoder.encode(encodeSseEvent(event)));
        }
      } catch (error) {
        console.warn("[api] /api/events 事件流中断", {
          error: error instanceof Error ? error.message : String(error)
        });
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

function startRunAndPublish(context: AppContext, input: RunRequest): Promise<RunStartResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let startedRunId: string | undefined;

    void (async () => {
      try {
        for await (const event of context.runner.stream(input)) {
          if (!isStreamEvent(event)) {
            continue;
          }
          if (event.type === "run_started") {
            startedRunId = event.runId;
            context.eventHub.publish(event);
            if (!settled) {
              settled = true;
              resolve({
                runId: event.runId,
                sessionId: event.sessionId,
                ...(event.clientRequestId ? { clientRequestId: event.clientRequestId } : {}),
                ...(event.providerId ? { providerId: event.providerId } : {}),
                ...(event.model ? { model: event.model } : {}),
                ...(event.reasoningMode ? { reasoningMode: event.reasoningMode } : {})
              });
            }
            continue;
          }
          context.eventHub.publish(event);
        }
        if (!settled) {
          settled = true;
          reject(new Error("运行启动失败：后端没有返回 run_started 事件"));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!settled) {
          settled = true;
          console.error("[api] /api/runs 启动失败:", message);
          reject(error);
          return;
        }
        console.error("[api] /api/runs 后台运行失败:", message);
        if (startedRunId) {
          await context.store
            .updateRunStatus(startedRunId, "failed", undefined, message)
            .catch((storeError) => {
              console.warn("[api] 后台运行失败状态写入失败", {
                runId: startedRunId,
                error: storeError instanceof Error ? storeError.message : String(storeError)
              });
            });
          context.eventHub.publish({
            type: "run_end",
            runId: startedRunId,
            status: "failed",
            error: message
          });
        }
      }
    })();
  });
}
