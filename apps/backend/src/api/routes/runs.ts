import { Hono } from "hono";
import {
  approvalDecisionSchema,
  encodeSseEvent,
  isStreamEvent,
  normalizeErrorMessage,
  type AppEvent,
  type RunRequest,
  type RunStartResponse,
  type StreamEvent,
  runRequestSchema,
  runSteeringRequestSchema
} from "@chengxiaobang/shared";
import type { AgentRunner } from "../../agent/agent-runner";
import type { EventHub } from "../../events/event-hub";
import { bindLogContext, errorToLogFields, getLogger } from "../../logging/logger";
import type { AppContext } from "../context";

const HEARTBEAT_MS = 15_000;
const log = getLogger({ module: "run-routes" });

export function runRoutes(context: AppContext): Hono {
  const app = new Hono();

  app.post("/runs/stream", async (c) => {
    const input = runRequestSchema.parse(await c.req.json());
    bindLogContext({
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId
    });
    return runStreamResponse(context.runner, input, c.req.raw.signal);
  });

  app.post("/runs", async (c) => {
    const input = runRequestSchema.parse(await c.req.json());
    bindLogContext({
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId
    });
    const started = await startRunAndPublish(context, input);
    return c.json(started);
  });

  app.get("/runs/active", async (c) => {
    const sessionId = c.req.query("sessionId")?.trim() || undefined;
    bindLogContext({ sessionId });
    const runs = await context.runner.listActiveRunSnapshots(sessionId);
    log.info("返回活跃 run 快照", {
      action: "active_runs.list",
      sessionId,
      count: runs.length
    });
    return c.json({ runs });
  });

  app.get("/events", (c) =>
    eventStreamResponse(context.eventHub, {
      signal: c.req.raw.signal,
      lastEventId:
        c.req.query("lastEventId")?.trim() ||
        c.req.header("last-event-id")?.trim() ||
        c.req.header("Last-Event-ID")?.trim()
    })
  );

  app.post("/runs/:runId/abort", (c) => {
    const runId = c.req.param("runId");
    bindLogContext({ runId });
    return c.json({ aborted: context.runner.abort(runId) });
  });

  app.post("/runs/:runId/steering", async (c) => {
    const runId = c.req.param("runId");
    const input = runSteeringRequestSchema.parse(await c.req.json());
    bindLogContext({ runId, clientRequestId: input.clientRequestId });
    const accepted = context.runner.enqueueSteering(runId, input);
    log.info("收到运行中引导", {
      action: "run.steering",
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
    const toolCallId = c.req.param("toolCallId");
    bindLogContext({ toolCallId });
    log.info("收到审批决议", {
      action: "approval.decide",
      toolCallId,
      approved: decision.approved,
      approvalScope: decision.approvalScope
    });
    return c.json({
      accepted: context.runner.approvals.decide(toolCallId, decision)
    });
  });

  return app;
}

function runStreamResponse(
  runner: AgentRunner,
  input: RunRequest,
  signal: AbortSignal
): Response {
  // 本路径(POST /api/runs/stream,流式回退路径)把 run 生命周期绑定到这条 HTTP 请求:
  // 客户端断连(刷新/关闭页面)时中止对应后端 run,避免 pi 循环/模型/工具/持久化继续跑完、
  // 占着 activeSessionIds/abortControllers 并持续消耗 token。捕获首个 run_started 的 runId,
  // 断连或请求 signal 中止时据此 abort。
  // 注意:桌面默认走的不是这条,而是 startRun(POST /api/runs)+ 全局 /api/events——那条路径
  // run 与请求解耦、可断线续传(/events 用 lastEventId 重连 + recoverActiveRunSnapshot 恢复),
  // 断开 /events 只结束订阅、不中止 run(见 startRunAndPublish)。
  let capturedRunId: string | undefined;
  let consumerGone = false;
  const abortCurrentRun = (reason: string): void => {
    if (!capturedRunId) {
      return;
    }
    log.warn("/api/runs/stream 消费者断开，中止后端 run", {
      action: "run_stream.abort_on_disconnect",
      runId: capturedRunId,
      reason
    });
    runner.abort(capturedRunId);
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const onAbort = (): void => abortCurrentRun("request-signal-abort");
      signal.addEventListener("abort", onAbort, { once: true });
      // 消费者取消后再 enqueue 会抛错,这里统一兜底并标记 consumerGone,避免炸掉 start()。
      const safeEnqueue = (bytes: Uint8Array): void => {
        if (consumerGone) {
          return;
        }
        try {
          controller.enqueue(bytes);
        } catch {
          consumerGone = true;
        }
      };
      // SSE 注释心跳用于维持审批等待和慢模型启动期间的连接。
      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(": keep-alive\n\n"));
        if (consumerGone) {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);

      try {
        for await (const event of runner.stream(input)) {
          if (event.type === "run_started") {
            capturedRunId = event.runId;
            bindLogContext({
              runId: event.runId,
              sessionId: event.sessionId,
              clientRequestId: event.clientRequestId
            });
          }
          safeEnqueue(encoder.encode(encodeSseEvent(event)));
        }
      } catch (error) {
        // 合并:用 PR#5 的错误归一化 + 结构化日志,同时保留本分支的 safeEnqueue(消费者已取消时不抛)。
        const normalizedError = normalizeErrorMessage(error);
        log.error("/api/runs/stream 运行失败", {
          action: "run_stream.failed",
          displayError: normalizedError,
          ...errorToLogFields(error)
        });
        safeEnqueue(
          encoder.encode(encodeSseEvent({ type: "setup_error", error: normalizedError }))
        );
      } finally {
        clearInterval(heartbeat);
        signal.removeEventListener("abort", onAbort);
      }
      try {
        controller.close();
      } catch {
        // 消费者已取消,close 会抛错,忽略即可。
      }
    },
    cancel(reason) {
      consumerGone = true;
      abortCurrentRun(typeof reason === "string" ? reason : "stream-cancel");
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

function eventStreamResponse(
  eventHub: EventHub<AppEvent>,
  options: { signal: AbortSignal; lastEventId?: string }
): Response {
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
        for await (const envelope of eventHub.subscribeEnvelopes({
          signal: options.signal,
          afterId: options.lastEventId
        })) {
          controller.enqueue(encoder.encode(encodeSseEvent(envelope.event, envelope.id)));
      }
    } catch (error) {
        log.warn("/api/events 事件流中断", {
          action: "events.stream_interrupted",
          ...errorToLogFields(error)
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

// 主路径(桌面默认):run 在与单条 HTTP 请求解耦的后台运行(生命周期随会话/进程),
// 事件经 eventHub 广播给 /api/events。因此 /events 断开只结束该订阅、**不**中止 run——
// 这是「刷新/重连后可断线续传」(配合 lastEventId + recoverActiveRunSnapshot)的有意设计;
// 真正的永久放弃由应用退出杀后端兜底(desktop main 的 stopAndWait)。
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
            bindLogContext({
              runId: event.runId,
              sessionId: event.sessionId,
              clientRequestId: event.clientRequestId
            });
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
        const normalizedError = normalizeErrorMessage(error);
        if (!settled) {
          settled = true;
          log.error("/api/runs 启动失败", {
            action: "run.start_failed",
            displayError: normalizedError,
            ...errorToLogFields(error)
          });
          reject(error);
          return;
        }
        log.error("/api/runs 后台运行失败", {
          action: "run.background_failed",
          displayError: normalizedError,
          ...errorToLogFields(error)
        });
        if (startedRunId) {
          // 持久化与推送给前端的 run_end 都用归一化后的精简错误,完整 error 已在上方日志。
          await context.store
            .updateRunStatus(startedRunId, "failed", undefined, normalizedError)
            .catch((storeError) => {
              log.warn("后台运行失败状态写入失败", {
                action: "run.persist_failed_status_failed",
                runId: startedRunId,
                ...errorToLogFields(storeError)
              });
            });
          context.eventHub.publish({
            type: "run_end",
            runId: startedRunId,
            status: "failed",
            error: normalizedError
          });
        }
      }
    })();
  });
}
