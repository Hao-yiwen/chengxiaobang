import { askUserArgsSchema, createId, isStreamEvent } from "@chengxiaobang/shared";
import type { MessageAttachment } from "@chengxiaobang/shared";
import { saveDisplayAttachmentSnapshots } from "../../lib/attachment-preparation";
import { showSystemNotification } from "../../lib/notifications";
import { apiClientRef } from "../client";
import type { AppState, AppStoreGet, AppStoreSet, QueuedRunItem } from "../types";
import {
  messageAttachmentsToDescriptors,
  prepareRunInputFromVisibleMessage
} from "../helpers/attachments";
import { appendMessage, upsertSession, upsertToolCall } from "../helpers/collections";
import {
  clearActiveComposerDraft,
  clearActiveComposerInput,
  rememberComposerDraft,
  sessionComposerDraftScope,
  switchComposerDraftScope
} from "../helpers/composer-drafts";
import {
  addNotificationToast,
  scheduledTaskFinishedDescription,
  scheduledTaskFinishedTitle,
  scheduledTaskToastKind
} from "../helpers/notifications";
import {
  dropQueuedRun,
  pauseRunQueue,
  queuedRunsForSession,
  unpauseRunQueue,
  upsertQueuedRunsForSession
} from "../helpers/queues";
import {
  configuredProviderById,
  firstConfiguredProvider,
  normalizeModelForProvider
} from "../helpers/providers";
import {
  activeRunRecoveryPatch,
  autoOpenProgressPanelPatch,
  logRecoveredFailedRuns,
  runModelFromStarted,
  settleInterruptedRunHistory,
  settledSessionHistoryPatch,
  shouldHandleRunEvent
} from "../helpers/run-history";
import { latestActiveRunSnapshot, runRecordFromEndEvent, upsertRunHistory } from "../helpers/run-records";
import { clearRunRunning, clearSessionRunning, markRunRunning, markSessionRunning } from "../helpers/running";
import { resolveRunProvider, selectActiveProject } from "../selectors";

function missingRunProviderPatch(state: AppState, source: string): Partial<AppState> {
  const configuredProvider = firstConfiguredProvider(state.providers);
  if (configuredProvider) {
    console.warn("[store] 发起模型运行失败：尚未选择供应商", {
      source,
      view: state.view,
      activeSessionId: state.activeSessionId,
      fallbackProviderId: configuredProvider.id
    });
    return { notice: "请先选择供应商" };
  }
  console.warn("[store] 发起模型运行失败：尚未配置供应商", {
    source,
    view: state.view,
    activeSessionId: state.activeSessionId,
    targetOnboardingStep: "model"
  });
  return { onboardingOpen: true, onboardingStep: "model" };
}

export function createRunActions(set: AppStoreSet, get: AppStoreGet): Partial<AppState> {
  return {
      async submit() {
        const state = get();
        if (!apiClientRef.current || (state.input.trim().length === 0 && state.attachments.length === 0)) {
          return;
        }
        if (
          state.isRunning &&
          state.pendingTool?.name === "ask_user" &&
          state.activeRunId === state.pendingTool.runId
        ) {
          const answer = state.input.trim();
          const parsedAskUser = askUserArgsSchema.safeParse(state.pendingTool.args);
          const questions = parsedAskUser.success
            ? parsedAskUser.data.questions
            : [{ question: "用户回答" }];
          if (questions.length > 1) {
            console.warn("[store] 多题 ask_user 不接受输入框快捷回答，请使用提问面板提交", {
              toolCallId: state.pendingTool.id,
              questionCount: questions.length
            });
            return;
          }
          console.info("[store] 将输入框内容作为 ask_user 回答", {
            toolCallId: state.pendingTool.id,
            answerLength: answer.length
          });
          get().approve(state.pendingTool.id, {
            approved: true,
            answer: { answers: [{ question: questions[0]?.question ?? "用户回答", text: answer }] }
          });
          set((state) => clearActiveComposerInput(state, "submit.askUser"));
          return;
        }
        if (
          state.view !== "home" &&
          state.isRunning &&
          (state.activeRunId || state.activeRunClientRequestId)
        ) {
          if (!state.activeSessionId) {
            console.warn("[store] 当前运行尚未绑定会话，暂不能加入排队", {
              activeRunId: state.activeRunId,
              activeRunClientRequestId: state.activeRunClientRequestId
            });
            return;
          }
          const selectedProvider = resolveRunProvider(state);
          if (!selectedProvider) {
            set(missingRunProviderPatch(state, "submit.queue"));
            return;
          }
          const modelState = normalizeModelForProvider(
            selectedProvider,
            state.model,
            undefined,
            "submit.queue"
          );
          let displayAttachments: MessageAttachment[];
          try {
            displayAttachments = await saveDisplayAttachmentSnapshots(
              state.attachments,
              window.chengxiaobang
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn("[store] 排队消息附件快照保存失败，取消入队", {
              sessionId: state.activeSessionId,
              attachmentCount: state.attachments.length,
              error: message
            });
            set({ notice: `附件保存失败：${message}` });
            return;
          }
          const item: QueuedRunItem = {
            id: createId("queued_run"),
            sessionId: state.activeSessionId,
            projectId: selectActiveProject(state)?.id ?? null,
            content: state.input,
            sourceAttachments: state.attachments.map((attachment) => ({
              path: attachment.path,
              name: attachment.name,
              size: attachment.size,
              kind: attachment.kind,
              ...(attachment.text !== undefined ? { text: attachment.text } : {})
            })),
            displayAttachments,
            providerId: selectedProvider.id,
            model: modelState.model ?? selectedProvider.model,
            accessMode: state.accessMode,
            planMode: state.planMode,
            createdAt: Date.now()
          };
          console.info("[store] 当前会话运行中，消息已加入排队", {
            sessionId: item.sessionId,
            queuedRunId: item.id,
            activeRunId: state.activeRunId,
            activeRunClientRequestId: state.activeRunClientRequestId,
            providerId: item.providerId,
            model: item.model ?? selectedProvider.model,
            contentChars: item.content.length,
            displayAttachmentCount: item.displayAttachments.length
          });
          set((current) => ({
            ...upsertQueuedRunsForSession(current, item.sessionId, [
              ...queuedRunsForSession(current, item.sessionId),
              item
            ]),
            ...unpauseRunQueue(current, item.sessionId),
            ...clearActiveComposerDraft(current, "submit.queue")
          }));
          return;
        }
        const selectedProvider = resolveRunProvider(state);
        if (!selectedProvider) {
          set(missingRunProviderPatch(state, "submit"));
          return;
        }
        const modelState = normalizeModelForProvider(
          selectedProvider,
          state.model,
          undefined,
          "submit"
        );
        const { attachments, input } = state;
        let displayAttachments: MessageAttachment[];
        try {
          displayAttachments = await saveDisplayAttachmentSnapshots(attachments, window.chengxiaobang);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[store] 附件快照保存失败，取消本次运行", {
            attachmentCount: attachments.length,
            error: message
          });
          set({ notice: `附件保存失败：${message}` });
          return;
        }
        const preparedRun = await prepareRunInputFromVisibleMessage({
          content: input,
          attachments: messageAttachmentsToDescriptors(displayAttachments),
          provider: selectedProvider,
          model: modelState.model,
          bridge: window.chengxiaobang
        });
        if (preparedRun.warnings.length > 0) {
          console.warn("[store] 附件准备存在警告", {
            warnings: preparedRun.warnings,
            inputModalities: preparedRun.inputModalities
          });
          set({ notice: preparedRun.warnings.join("\n") });
        }
        if (!preparedRun.prompt.trim()) {
          return;
        }
        set((state) => clearActiveComposerDraft(state, "submit"));
        await get().runPrompt(preparedRun.prompt, preparedRun.nativeAttachments, {
          content: input,
          attachments: displayAttachments
        });
      },

      async regenerateLast() {
        const state = get();
        if (!apiClientRef.current || state.isRunning || !state.activeSessionId) {
          return;
        }
        const sessionId = state.activeSessionId;
        const lastUser = [...state.messages].reverse().find((item) => item.role === "user");
        if (!lastUser) {
          console.warn("[store] 重新生成失败：会话中没有可重试的用户消息", {
            sessionId
          });
          return;
        }
        const selectedProvider = resolveRunProvider(state);
        if (!selectedProvider) {
          set(missingRunProviderPatch(state, "regenerateLast"));
          return;
        }
        const modelState = normalizeModelForProvider(
          selectedProvider,
          state.model,
          undefined,
          "regenerateLast"
        );
        const preparedRun = await prepareRunInputFromVisibleMessage({
          content: lastUser.content,
          attachments: messageAttachmentsToDescriptors(lastUser.attachments ?? []),
          provider: selectedProvider,
          model: modelState.model,
          bridge: window.chengxiaobang
        });
        if (!preparedRun.prompt.trim()) {
          return;
        }
        console.info("[store] 重试最后一条用户消息", {
          sessionId,
          messageId: lastUser.id,
          contentChars: lastUser.content.length,
          attachmentCount: lastUser.attachments?.length ?? 0
        });
        await apiClientRef.current.rewindSession(sessionId, lastUser.id);
        await get().loadSessionDetail(sessionId);
        console.info("[store] 重试请求已刷新本地会话历史", {
          sessionId,
          messageId: lastUser.id,
          contentPreview: lastUser.content.slice(0, 80),
          attachmentCount: lastUser.attachments?.length ?? 0
        });
        await get().runPrompt(preparedRun.prompt, preparedRun.nativeAttachments, {
          content: lastUser.content,
          attachments: lastUser.attachments ?? []
        });
      },

      async editAndResend(messageId, content) {
        const state = get();
        const originalMessage = state.messages.find((item) => item.id === messageId);
        if (
          !apiClientRef.current ||
          state.isRunning ||
          !state.activeSessionId ||
          (content.trim().length === 0 && (originalMessage?.attachments?.length ?? 0) === 0)
        ) {
          return;
        }
        const selectedProvider = resolveRunProvider(state);
        if (!selectedProvider) {
          set(missingRunProviderPatch(state, "editAndResend"));
          return;
        }
        const modelState = normalizeModelForProvider(
          selectedProvider,
          state.model,
          undefined,
          "editAndResend"
        );
        const displayAttachments = originalMessage?.attachments ?? [];
        const preparedRun = await prepareRunInputFromVisibleMessage({
          content,
          attachments: messageAttachmentsToDescriptors(displayAttachments),
          provider: selectedProvider,
          model: modelState.model,
          bridge: window.chengxiaobang
        });
        if (!preparedRun.prompt.trim()) {
          return;
        }
        await apiClientRef.current.rewindSession(state.activeSessionId, messageId);
        await get().loadSessionDetail(state.activeSessionId);
        await get().runPrompt(preparedRun.prompt, preparedRun.nativeAttachments, {
          content,
          attachments: displayAttachments
        });
      },

      async runPrompt(prompt, attachments = [], display = {}, options = {}) {
        const state = get();
        if (!apiClientRef.current || (prompt.trim().length === 0 && attachments.length === 0)) {
          return;
        }
        const selectedProvider = options.providerId
          ? configuredProviderById(state.providers, options.providerId)
          : resolveRunProvider(state);
        if (!selectedProvider) {
          console.warn("[store] 发起模型运行失败：找不到入队时的供应商配置", {
            source: options.source ?? "runPrompt",
            providerId: options.providerId
          });
          set(
            options.providerId
              ? {
                  onboardingOpen: state.onboardingOpen,
                  notice: "排队消息使用的模型配置已不可用"
                }
              : missingRunProviderPatch(state, options.source ?? "runPrompt")
          );
          return;
        }
        const modelState = normalizeModelForProvider(
          selectedProvider,
          options.preserveSelection ? options.model : (options.model ?? state.model),
          undefined,
          options.source ?? "runPrompt"
        );
        if (
          !options.preserveSelection &&
          (selectedProvider.id !== state.providerId ||
            modelState.model !== state.model ||
            state.reasoningMode !== undefined)
        ) {
          set({ providerId: selectedProvider.id, ...modelState });
        }
        get().clearRunState();
        const clientRequestId = createId("client_run");
        const activeSessionId = options.sessionId ?? state.activeSessionId;
        const accessMode = options.accessMode ?? state.accessMode;
        const planMode = options.planMode ?? state.planMode;
        const { model } = modelState;
        const providerId = selectedProvider.id;
        const activeProject = selectActiveProject(get());
        const projectId =
          options.projectId !== undefined ? options.projectId : (activeProject?.id ?? null);
        const runPrompt = prompt.trim().length > 0 ? prompt : "请分析这些图片。";
        const displayContent = display.content ?? runPrompt;
        const displayAttachments = display.attachments ?? [];
        console.info("[store] 发起模型运行", {
          source: options.source ?? "runPrompt",
          providerId,
          model: model ?? selectedProvider.model,
          sessionId: activeSessionId,
          projectId,
          nativeAttachmentCount: attachments.length,
          displayAttachmentCount: displayAttachments.length,
          promptChars: runPrompt.length,
          displayChars: displayContent.length
        });
        const runInput = {
          sessionId: activeSessionId,
          projectId,
          prompt: runPrompt,
          displayContent,
          displayAttachments,
          clientRequestId,
          providerId,
          accessMode,
          planMode,
          ...(model ? { model } : {}),
          ...(attachments.length > 0 ? { attachments } : {})
        };
        set({
          isRunning: true,
          view: "chat",
          activeRunClientRequestId: clientRequestId,
          progressPanelOpen: false
        });
        try {
          if (apiClientRef.current.startRun && apiClientRef.current.subscribeRunEvents) {
            const started = await apiClientRef.current.startRun(runInput);
            const startedModel = started.model
              ? {
                  providerId: started.providerId,
                  model: started.model,
                  reasoningMode: started.reasoningMode
                }
              : undefined;
            set((current) => {
              if (current.activeRunClientRequestId !== clientRequestId) {
                return {};
              }
              return {
                ...switchComposerDraftScope(
                  current,
                  sessionComposerDraftScope(started.sessionId),
                  "runPrompt.startRun"
                ),
                activeRunId: current.activeRunId ?? started.runId,
                activeSessionId: started.sessionId,
                view: "chat",
                ...markRunRunning(current, started.runId, started.sessionId),
                ...(startedModel
                  ? { activeRunModel: startedModel, lastRunModel: startedModel }
                  : {})
              };
            });
            return;
          }
          await apiClientRef.current.streamRun(runInput, (event) => {
            get().handleRunEvent(event, { force: true });
          });
        } catch (error) {
          console.error("[store] 运行流中断:", error);
          set((current) => ({
            isRunning: false,
            activeRunId: undefined,
            activeRunClientRequestId: undefined,
            progressPanelOpen: false,
            progressPanelAutoOpenedRunId: undefined,
            activeRunModel: undefined,
            activeRunLastAssistant: undefined,
            pendingTool: undefined,
            runningTool: undefined,
            toolActivity: undefined,
            ...(current.activeRunId
              ? clearRunRunning(current, current.activeRunId, current.activeSessionId)
              : current.activeSessionId
                ? clearSessionRunning(current, current.activeSessionId)
                : {}),
            events: [
              ...current.events,
              {
                type: "run_end",
                runId: "local",
                status: "failed",
                error: error instanceof Error ? error.message : String(error)
              }
            ]
          }));
        }
      },

      removeQueuedRun(id) {
        console.info("[store] 移除排队消息", { queuedRunId: id });
        set((state) => dropQueuedRun(state, id));
      },

      editQueuedRunInComposer(id) {
        const state = get();
        const item = Object.values(state.queuedRunsBySession)
          .flat()
          .find((queued) => queued.id === id);
        if (!item) {
          console.warn("[store] 排队消息编辑失败：未找到队列项", { queuedRunId: id });
          return;
        }
        const attachments = item.sourceAttachments.map((attachment) => ({ ...attachment }));
        const scope = sessionComposerDraftScope(item.sessionId);
        console.info("[store] 将排队消息撤回到输入框编辑", {
          queuedRunId: id,
          sessionId: item.sessionId,
          contentChars: item.content.length,
          attachmentCount: attachments.length,
          providerId: item.providerId,
          model: item.model,
          accessMode: item.accessMode,
          planMode: item.planMode
        });
        set((current) => ({
          ...dropQueuedRun(current, id),
          composerDraftsByScope: rememberComposerDraft(current, "editQueuedRunInComposer", scope, {
            input: item.content,
            attachments
          }),
          activeComposerDraftScope: scope,
          input: item.content,
          attachments,
          providerId: item.providerId,
          model: item.model,
          reasoningMode: undefined,
          accessMode: item.accessMode,
          planMode: item.planMode
        }));
      },

      clearQueuedRuns(sessionId) {
        const targetSessionId = sessionId ?? get().activeSessionId;
        if (!targetSessionId) {
          return;
        }
        console.info("[store] 清空会话排队消息", {
          sessionId: targetSessionId,
          queuedCount: queuedRunsForSession(get(), targetSessionId).length
        });
        set((state) => {
          const { [targetSessionId]: _queue, ...queuedRunsBySession } =
            state.queuedRunsBySession;
          const { [targetSessionId]: _paused, ...pausedRunQueuesBySession } =
            state.pausedRunQueuesBySession;
          return { queuedRunsBySession, pausedRunQueuesBySession };
        });
      },

      async resumeQueuedRuns(sessionId) {
        const targetSessionId = sessionId ?? get().activeSessionId;
        if (!targetSessionId) {
          return;
        }
        set((state) => unpauseRunQueue(state, targetSessionId));
        await get().startNextQueuedRun(targetSessionId);
      },

      async sendQueuedRunAsSteering(id) {
        const state = get();
        const activeRunId = state.activeRunId;
        const item = Object.values(state.queuedRunsBySession)
          .flat()
          .find((queued) => queued.id === id);
        if (!apiClientRef.current || !apiClientRef.current.steerRun || !activeRunId || !item) {
          console.warn("[store] 运行中引导发送失败：缺少 active run 或队列项", {
            queuedRunId: id,
            activeRunId,
            hasClient: Boolean(apiClientRef.current),
            hasSteerRun: Boolean(apiClientRef.current?.steerRun),
            hasItem: Boolean(item)
          });
          return;
        }
        const provider = configuredProviderById(state.providers, item.providerId);
        if (!provider) {
          console.warn("[store] 运行中引导发送失败：模型配置不可用", {
            queuedRunId: id,
            providerId: item.providerId
          });
          set({ notice: "排队消息使用的模型配置已不可用" });
          return;
        }
        const preparedRun = await prepareRunInputFromVisibleMessage({
          content: item.content,
          attachments: messageAttachmentsToDescriptors(item.displayAttachments),
          provider,
          model: item.model,
          bridge: window.chengxiaobang
        });
        if (preparedRun.warnings.length > 0) {
          console.warn("[store] 运行中引导附件准备存在警告", {
            queuedRunId: id,
            warnings: preparedRun.warnings,
            inputModalities: preparedRun.inputModalities
          });
          set({ notice: preparedRun.warnings.join("\n") });
        }
        if (!preparedRun.prompt.trim() && preparedRun.nativeAttachments.length === 0) {
          console.warn("[store] 运行中引导内容为空，已跳过", { queuedRunId: id });
          return;
        }
        const clientRequestId = createId("client_steer");
        try {
          await apiClientRef.current.steerRun(activeRunId, {
            prompt: preparedRun.prompt.trim().length > 0 ? preparedRun.prompt : "请分析这些图片。",
            displayContent: item.content,
            displayAttachments: item.displayAttachments,
            clientRequestId,
            attachments: preparedRun.nativeAttachments
          });
          console.info("[store] 运行中引导已发送", {
            queuedRunId: id,
            runId: activeRunId,
            sessionId: item.sessionId,
            clientRequestId,
            promptChars: preparedRun.prompt.length,
            nativeAttachmentCount: preparedRun.nativeAttachments.length
          });
          set((current) => dropQueuedRun(current, id));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[store] 运行中引导发送失败，保留排队消息", {
            queuedRunId: id,
            runId: activeRunId,
            error: message
          });
          set({ notice: message });
        }
      },

      async startNextQueuedRun(sessionId) {
        const state = get();
        const targetSessionId = sessionId ?? state.activeSessionId;
        if (!targetSessionId || state.isRunning || state.pausedRunQueuesBySession[targetSessionId]) {
          console.debug("[store] 跳过排队消息自动启动", {
            sessionId: targetSessionId,
            isRunning: state.isRunning,
            paused: targetSessionId ? Boolean(state.pausedRunQueuesBySession[targetSessionId]) : false
          });
          return;
        }
        const item = queuedRunsForSession(state, targetSessionId)[0];
        if (!item) {
          return;
        }
        const provider = configuredProviderById(state.providers, item.providerId);
        if (!provider) {
          console.warn("[store] 排队消息启动失败：模型配置不可用，已暂停队列", {
            sessionId: targetSessionId,
            queuedRunId: item.id,
            providerId: item.providerId
          });
          set((current) => ({
            ...pauseRunQueue(current, targetSessionId),
            notice: "排队消息使用的模型配置已不可用"
          }));
          return;
        }
        const preparedRun = await prepareRunInputFromVisibleMessage({
          content: item.content,
          attachments: messageAttachmentsToDescriptors(item.displayAttachments),
          provider,
          model: item.model,
          bridge: window.chengxiaobang
        });
        if (preparedRun.warnings.length > 0) {
          console.warn("[store] 排队消息附件准备存在警告", {
            sessionId: targetSessionId,
            queuedRunId: item.id,
            warnings: preparedRun.warnings,
            inputModalities: preparedRun.inputModalities
          });
          set({ notice: preparedRun.warnings.join("\n") });
        }
        if (!preparedRun.prompt.trim() && preparedRun.nativeAttachments.length === 0) {
          console.warn("[store] 排队消息内容为空，已移除", {
            sessionId: targetSessionId,
            queuedRunId: item.id
          });
          set((current) => dropQueuedRun(current, item.id));
          await get().startNextQueuedRun(targetSessionId);
          return;
        }
        console.info("[store] 启动下一条排队消息", {
          sessionId: targetSessionId,
          queuedRunId: item.id,
          remainingQueuedCount: queuedRunsForSession(state, targetSessionId).length - 1,
          providerId: item.providerId,
          model: item.model ?? provider.model,
          contentChars: item.content.length,
          displayAttachmentCount: item.displayAttachments.length
        });
        set((current) => dropQueuedRun(current, item.id));
        await get().runPrompt(
          preparedRun.prompt,
          preparedRun.nativeAttachments,
          { content: item.content, attachments: item.displayAttachments },
          {
            sessionId: item.sessionId,
            projectId: item.projectId,
            providerId: item.providerId,
            model: item.model,
            accessMode: item.accessMode,
            planMode: item.planMode,
            source: "queuedRun",
            preserveSelection: true
          }
        );
      },

      async abortRun() {
        const { activeRunId } = get();
        if (!apiClientRef.current || !activeRunId) {
          return;
        }
        await apiClientRef.current.abort(activeRunId);
      },

      approve(toolCallId, decision) {
        const normalized = typeof decision === "boolean" ? { approved: decision } : decision;
        void apiClientRef.current?.approve(toolCallId, normalized);
      },

      handleAppEvent(event) {
        if (isStreamEvent(event)) {
          get().handleRunEvent(event);
          return;
        }
        console.info("[store] 收到定时任务事件", {
          type: event.type,
          taskId: event.taskId,
          sessionId: event.sessionId,
          status: event.type === "scheduled_task_finished" ? event.status : undefined
        });
        if (event.type === "scheduled_task_started") {
          set((state) => ({
            ...markSessionRunning(state, event.sessionId),
            runningTaskIds: { ...state.runningTaskIds, [event.taskId]: true }
          }));
          void get().loadTasks();
          return;
        }

        const title = scheduledTaskFinishedTitle(event);
        const description = scheduledTaskFinishedDescription(event);
        set((state) => {
          const { [event.taskId]: _removed, ...runningTaskIds } = state.runningTaskIds;
          return {
            ...clearSessionRunning(state, event.sessionId),
            runningTaskIds,
            ...addNotificationToast(state, {
              kind: scheduledTaskToastKind(event.status),
              title,
              description
            })
          };
        });
        void showSystemNotification({ title, body: description }).then((sent) => {
          if (!sent) {
            console.info("[store] 系统通知未发送，保留应用内提示", {
              taskId: event.taskId,
              status: event.status
            });
          }
        });
        void get().loadTasks();
      },

      handleRunEvent(event, options) {
        const currentState = get();
        const runEndSessionId =
          event.type === "run_end" ? currentState.runningRunSessionById[event.runId] : undefined;
        if (event.type === "run_started") {
          set((state) => markRunRunning(state, event.runId, event.sessionId));
        } else if (event.type === "run_end") {
          set((state) => clearRunRunning(state, event.runId, runEndSessionId));
        }
        if (!shouldHandleRunEvent(get(), event, options?.force)) {
          return;
        }
        if (event.type === "session_updated") {
          // AI 标题可能来自其他 run；侧边栏元数据可以全局接收。
          set((current) => ({
            sessions: upsertSession(current.sessions, event.session)
          }));
          return;
        }

        set((current) => ({ events: [...current.events, event] }));
        switch (event.type) {
          case "setup_error":
            console.warn("[store] run 启动阶段失败", { error: event.error });
            set((current) => ({
              isRunning: false,
              activeRunId: undefined,
              activeRunClientRequestId: undefined,
              activeRunModel: undefined,
              activeRunLastAssistant: undefined,
              pendingTool: undefined,
              runningTool: undefined,
              toolActivity: undefined,
              streamText: "",
              thinking: "",
              thinkingStartedAt: undefined,
              notice: event.error,
              ...(current.activeRunId && current.activeSessionId
                ? clearRunRunning(current, current.activeRunId, current.activeSessionId)
                : current.activeSessionId
                  ? clearSessionRunning(current, current.activeSessionId)
                  : {})
            }));
            break;
          case "run_started": {
            const runModel = runModelFromStarted(event);
            set((state) => ({
              ...switchComposerDraftScope(
                state,
                sessionComposerDraftScope(event.sessionId),
                "handleRunEvent.run_started"
              ),
              activeRunId: event.runId,
              activeSessionId: event.sessionId,
              activeRunClientRequestId: event.clientRequestId ?? get().activeRunClientRequestId,
              progressPanelOpen: false,
              progressPanelAutoOpenedRunId: undefined,
              activeRunModel: runModel,
              view: "chat",
              isRunning: true,
              ...markRunRunning(state, event.runId, event.sessionId),
              ...(runModel ? { lastRunModel: runModel } : {})
            }));
            break;
          }
          case "delta":
            if (event.channel === "text") {
              set((current) => ({ streamText: current.streamText + event.delta }));
            } else {
              set((current) => ({
                thinking: current.thinking + event.delta,
                thinkingStartedAt: current.thinkingStartedAt ?? Date.now()
              }));
            }
            break;
          case "tool_activity":
            set({ toolActivity: event.activity });
            break;
          case "message":
            // 一个 run 会推送 user 回显、工具间 assistant 轮次和最终回答。
            // assistant 消息已带持久化 reasoning，因此这里只清理实时缓冲。
            set((current) => ({
              messages: appendMessage(current.messages, event.message),
              ...(event.message.role === "assistant"
                ? {
                    streamText: "",
                    thinking: "",
                    thinkingStartedAt: undefined,
                    activeRunLastAssistant: event.message
                  }
                : {})
            }));
            break;
          case "tool_call":
            // tool_call.status 是状态机：pending_approval 独立进底部 dock，
            // 智能审批等待态不需要用户点击，进入历史/活动区展示即可。
            if (event.toolCall.status === "pending_approval") {
              set({
                pendingTool: event.toolCall,
                runningTool: undefined,
                toolActivity: undefined
              });
            } else if (
              event.toolCall.status === "running" ||
              event.toolCall.status === "pending_smart_approval"
            ) {
              set((current) => ({
                pendingTool: undefined,
                runningTool: event.toolCall,
                toolActivity: undefined,
                toolHistory: upsertToolCall(current.toolHistory, event.toolCall),
                ...autoOpenProgressPanelPatch(current, event.toolCall)
              }));
            } else {
              set((current) => ({
                pendingTool: undefined,
                runningTool: undefined,
                toolActivity: undefined,
                toolHistory: upsertToolCall(current.toolHistory, event.toolCall),
                ...autoOpenProgressPanelPatch(current, event.toolCall)
              }));
            }
            break;
          case "run_end": {
            const sessionId = runEndSessionId ?? get().activeSessionId;
            set((current) => ({
              isRunning: false,
              activeRunId: undefined,
              activeRunClientRequestId: undefined,
              progressPanelAutoOpenedRunId: undefined,
              activeRunModel: undefined,
              activeRunLastAssistant: undefined,
              pendingTool: undefined,
              runningTool: undefined,
              toolActivity: undefined,
              streamText: "",
              thinking: "",
              thinkingStartedAt: undefined,
              ...(sessionId
                ? {
                    runHistory: upsertRunHistory(
                      current.runHistory,
                      runRecordFromEndEvent(
                        event,
                        sessionId,
                        current.runHistory.find((run) => run.id === event.runId)
                      )
                    )
                  }
                : {}),
              ...(sessionId ? clearRunRunning(current, event.runId, sessionId) : {}),
              ...(event.status === "completed" ? {} : pauseRunQueue(current, sessionId)),
              ...(event.status === "completed" ? { lastUsage: event.usage } : {}),
              ...(event.status === "completed" &&
              event.usage &&
              current.activeRunModel &&
              current.activeRunLastAssistant?.durationMs !== undefined
                ? {
                    runMeta: {
                      ...current.runMeta,
                      [current.activeRunLastAssistant.id]: {
                        durationMs: current.activeRunLastAssistant.durationMs,
                        promptTokens: event.usage.promptTokens,
                        completionTokens: event.usage.completionTokens,
                        model: current.activeRunModel.model,
                        ...(current.activeRunModel.reasoningMode
                          ? { reasoningMode: current.activeRunModel.reasoningMode }
                          : {})
                      }
                    }
                  }
                : {})
            }));
            void (async () => {
              await get().refresh();
              if (sessionId && apiClientRef.current) {
                await get().loadSessionDetail(sessionId);
              }
              if (event.status === "completed" && sessionId) {
                await get().startNextQueuedRun(sessionId);
              }
            })();
            break;
          }
        }
      },

      async recoverActiveRunSnapshot() {
        const state = get();
        if (!apiClientRef.current) {
          return;
        }
        try {
          const activeSnapshots = apiClientRef.current.listActiveRuns
            ? await apiClientRef.current.listActiveRuns(state.activeSessionId)
            : [];
          const activeSnapshot = latestActiveRunSnapshot(activeSnapshots);
          if (activeSnapshot && state.view === "home" && !state.activeSessionId) {
            console.info("[store] 首页跳过活跃 run 自动恢复", {
              sessionId: activeSnapshot.run.sessionId,
              runId: activeSnapshot.run.id
            });
            return;
          }

          if (activeSnapshot) {
            if (!state.activeSessionId && state.view === "chat") {
              await get().loadData();
            }
            const session = get().sessions.find((item) => item.id === activeSnapshot.run.sessionId);
            const [messages, history] = await Promise.all([
              apiClientRef.current.listMessages(activeSnapshot.run.sessionId),
              apiClientRef.current.listSessionRuns(activeSnapshot.run.sessionId)
            ]);
            logRecoveredFailedRuns(
              activeSnapshot.run.sessionId,
              history.runs,
              "recoverActiveRunSnapshot.active"
            );
            set((current) => ({
              ...switchComposerDraftScope(
                current,
                sessionComposerDraftScope(activeSnapshot.run.sessionId),
                "recoverActiveRunSnapshot"
              ),
              activeSessionId: activeSnapshot.run.sessionId,
              activeProjectId: session?.projectId ?? current.activeProjectId,
              ...(session ? { accessMode: session.accessMode } : {}),
              messages,
              ...activeRunRecoveryPatch(
                current,
                activeSnapshot,
                history,
                "recoverActiveRunSnapshot"
              )
            }));
            return;
          }

          const { activeSessionId, activeRunId } = get();
          if (!activeSessionId) {
            console.info("[store] 没有可恢复的后端活跃 run", {
              sessionId: activeSessionId,
              runId: activeRunId
            });
            return;
          }

          console.info("[store] 后端无活跃快照，检查当前 run 是否已结束", {
            sessionId: activeSessionId,
            runId: activeRunId
          });
          const [messages, history] = await Promise.all([
            apiClientRef.current.listMessages(activeSessionId),
            apiClientRef.current.listSessionRuns(activeSessionId)
          ]);
          const settled = settleInterruptedRunHistory(
            activeSessionId,
            history,
            "recoverActiveRunSnapshot.settled"
          );
          if (!activeRunId) {
            if (settled.interruptedRunIds.length === 0) {
              console.info("[store] 没有可恢复的后端活跃 run", {
                sessionId: activeSessionId,
                runId: activeRunId
              });
            }
            set((state) =>
              settledSessionHistoryPatch(state, activeSessionId, messages, settled.history)
            );
            return;
          }
          const activeRun = history.runs.find((run) => run.id === activeRunId);
          if (!apiClientRef.current.listActiveRuns && activeRun?.status === "running") {
            set((current) => ({
              messages,
              ...activeRunRecoveryPatch(
                current,
                {
                  run: activeRun,
                  toolCalls: history.toolCalls.filter((toolCall) => toolCall.runId === activeRunId)
                },
                history,
                "recoverActiveRunSnapshot.legacy"
              )
            }));
            return;
          }
          if (!activeRun || activeRun.status !== "running" || apiClientRef.current.listActiveRuns) {
            logRecoveredFailedRuns(
              activeSessionId,
              settled.history.runs,
              "recoverActiveRunSnapshot.settled"
            );
            set((state) =>
              settledSessionHistoryPatch(state, activeSessionId, messages, settled.history)
            );
            return;
          }
        } catch (error) {
          console.warn("[store] 活跃运行状态恢复失败", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      },
  };
}
