import { basename } from "node:path";
import {
  approvalDecisionSchema,
  encodeSseEvent,
  projectInputSchema,
  providerInputSchema,
  runRequestSchema,
  sessionInputSchema,
  sessionUpdateSchema,
  terminalExecRequestSchema
} from "@chengxiaobang/shared";
import { runCommand } from "../tools/shell";
import { ProviderService } from "../model/provider-service";
import type { StateStore } from "../repository/state-store";
import type { AgentRunner } from "../agent/agent-runner";
import { SlashCommandService } from "../tools/slash-command-service";
import { emptyResponse, errorResponse, jsonResponse, readJson, withCors } from "./json";

export interface AppOptions {
  token?: string;
  store: StateStore;
  providerService: ProviderService;
  runner: AgentRunner;
  slashCommandService?: SlashCommandService;
}

export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const slashCommandService = options.slashCommandService ?? new SlashCommandService();
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return emptyResponse();
      }
      if (url.pathname === "/api/health") {
        return jsonResponse({ ok: true, name: "程小帮" });
      }
      if (options.token && request.headers.get("x-chengxiaobang-token") !== options.token) {
        return errorResponse("未授权", 401);
      }

      if (url.pathname === "/api/projects" && request.method === "GET") {
        return jsonResponse({ projects: await options.store.listProjects() });
      }
      if (url.pathname === "/api/projects" && request.method === "POST") {
        const input = projectInputSchema.parse(await readJson<unknown>(request));
        const project = await options.store.createProject({
          path: input.path,
          name: input.name ?? basename(input.path)
        });
        return jsonResponse({ project }, 201);
      }
      if (url.pathname === "/api/sessions" && request.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        return jsonResponse({
          sessions: await options.store.listSessions(projectId ?? undefined)
        });
      }
      if (url.pathname === "/api/sessions" && request.method === "POST") {
        const input = sessionInputSchema.parse(await readJson<unknown>(request));
        const session = await options.store.createSession({
          projectId: input.projectId ?? null,
          title: input.title ?? "新对话",
          providerId: input.providerId,
          accessMode: input.accessMode ?? "approval"
        });
        return jsonResponse({ session }, 201);
      }
      if (url.pathname === "/api/slash-commands" && request.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        const project = projectId ? await options.store.getProject(projectId) : undefined;
        return jsonResponse(await slashCommandService.list(project));
      }
      const messagesMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
      if (messagesMatch && request.method === "GET") {
        return jsonResponse({
          messages: await options.store.listMessages(messagesMatch[1])
        });
      }
      const runsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/runs$/);
      if (runsMatch && request.method === "GET") {
        const [runs, toolCalls] = await Promise.all([
          options.store.listRuns(runsMatch[1]),
          options.store.listToolCallsForSession(runsMatch[1])
        ]);
        return jsonResponse({ runs, toolCalls });
      }
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && request.method === "PATCH") {
        const session = await options.store.updateSession(
          sessionMatch[1],
          sessionUpdateSchema.parse(await readJson<unknown>(request))
        );
        return jsonResponse({ session });
      }
      if (sessionMatch && request.method === "DELETE") {
        return jsonResponse({ deleted: await options.store.deleteSession(sessionMatch[1]) });
      }
      if (url.pathname === "/api/runs/stream" && request.method === "POST") {
        const input = runRequestSchema.parse(await readJson<unknown>(request));
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            for await (const event of options.runner.stream(input)) {
              controller.enqueue(encoder.encode(encodeSseEvent(event)));
            }
            controller.close();
          }
        });
        return new Response(stream, {
          headers: withCors({
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          })
        });
      }
      if (url.pathname === "/api/terminal/exec" && request.method === "POST") {
        // Terminal-panel commands are typed by the user themselves, so they
        // run directly without the tool-approval queue.
        const input = terminalExecRequestSchema.parse(await readJson<unknown>(request));
        const project = await options.store.getProject(input.projectId);
        if (!project) {
          return errorResponse("项目不存在", 404);
        }
        return jsonResponse({ result: await runCommand(input.command, project.path) });
      }
      const abortMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/abort$/);
      if (abortMatch && request.method === "POST") {
        return jsonResponse({ aborted: options.runner.abort(abortMatch[1]) });
      }
      const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
      if (approvalMatch && request.method === "POST") {
        const decision = approvalDecisionSchema.parse(await readJson<unknown>(request));
        return jsonResponse({
          accepted: options.runner.approvals.decide(approvalMatch[1], decision.approved)
        });
      }
      if (url.pathname === "/api/settings/providers" && request.method === "GET") {
        return jsonResponse({ providers: await options.providerService.listProviders() });
      }
      if (url.pathname === "/api/settings/providers" && request.method === "PUT") {
        const provider = await options.providerService.saveProvider(
          providerInputSchema.parse(await readJson<unknown>(request))
        );
        return jsonResponse({ provider });
      }
      const providerMatch = url.pathname.match(/^\/api\/settings\/providers\/([^/]+)$/);
      if (providerMatch && request.method === "DELETE") {
        return jsonResponse({
          deleted: await options.providerService.deleteProvider(providerMatch[1])
        });
      }
      const testProviderMatch = url.pathname.match(
        /^\/api\/settings\/providers\/([^/]+)\/test$/
      );
      if (testProviderMatch && request.method === "POST") {
        await options.providerService.testProvider(testProviderMatch[1]);
        return jsonResponse({ ok: true });
      }
      return errorResponse("接口不存在", 404);
    } catch (error) {
      return errorResponse(error, 500);
    }
  };
}
