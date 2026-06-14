import { apiClientRef } from "../client";
import type { AppState, AppStoreGet, AppStoreSet } from "../types";
import {
  configuredProviderById,
  firstConfiguredProvider,
  isConfiguredProvider
} from "../helpers/providers";
import {
  normalizeModelSelectionForProvider,
  restoreHomeModelSelection
} from "../helpers/model-selection";

export function createSettingsActions(set: AppStoreSet, get: AppStoreGet): Partial<AppState> {
  return {
      async saveProvider(input) {
        if (!apiClientRef.current) {
          return;
        }
        const saved = await apiClientRef.current.saveProvider(input);
        await get().refresh();
        if (isConfiguredProvider(saved)) {
          const modelState = normalizeModelSelectionForProvider(
            saved,
            saved.model,
            undefined,
            "saveProvider"
          );
          set((state) => ({
            ...(state.view === "home" || !state.activeSessionId
              ? {
                  providerId: saved.id,
                  ...modelState,
                  homeModelSelection: { providerId: saved.id, ...modelState }
                }
              : {}),
            notice: undefined,
            onboardingOpen: false
          }));
        }
      },

      async deleteProvider(id) {
        if (!apiClientRef.current) {
          return;
        }
        const ok = await apiClientRef.current.deleteProvider(id);
        if (!ok) {
          return;
        }
        await get().refresh();
        const stillConfigured = firstConfiguredProvider(get().providers);
        set((state) => {
          const nextProvider =
            state.providerId === id
              ? stillConfigured
              : configuredProviderById(state.providers, state.providerId);
          const nextReasoningMode = state.providerId === id ? undefined : state.reasoningMode;
          const modelState = nextProvider
            ? normalizeModelSelectionForProvider(
                nextProvider,
                state.model,
                nextReasoningMode,
                "deleteProvider"
              )
            : { model: undefined, reasoningMode: undefined };
          return {
            providerId: nextProvider?.id,
            ...modelState,
            ...(state.view === "home" || !state.activeSessionId
              ? restoreHomeModelSelection(
                  { ...state, homeModelSelection: state.homeModelSelection.providerId === id ? {} : state.homeModelSelection },
                  state.providers,
                  "deleteProvider"
                )
              : {})
          };
        });
      },

      async testProvider(id) {
        await apiClientRef.current?.testProvider(id);
      },

      async loadFeishuConfig() {
        if (!apiClientRef.current) {
          return;
        }
        try {
          const [config, status] = await Promise.all([
            apiClientRef.current.getFeishuConfig(),
            apiClientRef.current.getFeishuStatus()
          ]);
          set({ feishuConfig: config, feishuStatus: status });
        } catch (error) {
          console.warn("加载飞书配置失败", error);
        }
      },

      async saveFeishuConfig(input) {
        if (!apiClientRef.current) {
          return;
        }
        // 反馈在设置区内联展示；全局 notice 只在首页/对话页渲染。
        const { config, status } = await apiClientRef.current.saveFeishuConfig(input);
        set({ feishuConfig: config, feishuStatus: status });
      },

      async startFeishuInstall(input) {
        if (!apiClientRef.current?.startFeishuInstall) {
          return { ok: false, message: "飞书扫码安装服务不可用" };
        }
        return apiClientRef.current.startFeishuInstall(input);
      },

      async pollFeishuInstall(input) {
        if (!apiClientRef.current?.pollFeishuInstall) {
          return { done: false, error: "飞书扫码安装服务不可用" };
        }
        const result = await apiClientRef.current.pollFeishuInstall(input);
        if (result.done) {
          set({ feishuConfig: result.config, feishuStatus: result.status });
        }
        return result;
      },

      async refreshFeishuStatus() {
        if (!apiClientRef.current) {
          return;
        }
        try {
          set({ feishuStatus: await apiClientRef.current.getFeishuStatus() });
        } catch {
          // 轮询的临时失败不清空状态，继续保留上一次可用结果。
        }
      },

      async loadWebSearchConfig() {
        if (!apiClientRef.current?.getWebSearchConfig) {
          return;
        }
        try {
          set({ webSearchConfig: await apiClientRef.current.getWebSearchConfig() });
        } catch (error) {
          console.warn("[store] 加载网络搜索配置失败", error);
        }
      },

      async saveWebSearchConfig(input) {
        if (!apiClientRef.current?.saveWebSearchConfig) {
          return;
        }
        console.info("[store] 保存网络搜索配置", {
          enabled: input.enabled,
          hasApiKey: Boolean(input.apiKey?.trim())
        });
        const config = await apiClientRef.current.saveWebSearchConfig(input);
        set({ webSearchConfig: config });
      },

      async testWebSearchConfig() {
        if (!apiClientRef.current?.testWebSearchConfig) {
          return;
        }
        console.info("[store] 测试网络搜索配置");
        await apiClientRef.current.testWebSearchConfig();
      },

      async loadTasks() {
        if (!apiClientRef.current) {
          return;
        }
        try {
          set({ tasks: await apiClientRef.current.listTasks() });
        } catch (error) {
          console.warn("加载定时任务失败", error);
        }
      },

      async updateTask(id, input) {
        if (!apiClientRef.current) {
          return;
        }
        const task = await apiClientRef.current.updateTask(id, input);
        set((state) => ({
          tasks: state.tasks.map((item) => (item.id === id ? task : item))
        }));
      },

      async deleteTask(id) {
        if (!apiClientRef.current) {
          return;
        }
        const ok = await apiClientRef.current.deleteTask(id);
        if (!ok) {
          return;
        }
        set((state) => ({ tasks: state.tasks.filter((item) => item.id !== id) }));
      },

      async runTaskNow(id) {
        if (!apiClientRef.current) {
          return;
        }
        await apiClientRef.current.runTaskNow(id);
        // 执行是异步的，立刻重拉一次拿到 lastRunAt 的推进；
        // 终态由任务页的轮询带回。
        await get().loadTasks();
      },

      async loadSkills() {
        if (!apiClientRef.current?.listSkills) {
          return;
        }
        try {
          set({ skills: await apiClientRef.current.listSkills() });
        } catch (error) {
          console.warn("[store] 加载技能列表失败", error);
        }
      },

      async getSkillDetail(name) {
        if (!apiClientRef.current?.getSkillDetail) {
          return undefined;
        }
        try {
          return await apiClientRef.current.getSkillDetail(name);
        } catch (error) {
          console.warn("[store] 加载技能详情失败", { name, error });
          return undefined;
        }
      },

      async setSkillEnabled(name, enabled) {
        if (!apiClientRef.current?.setMarketSkillEnabled) {
          return;
        }
        console.info("[store] 切换市场技能", { name, enabled });
        const skills = await apiClientRef.current.setMarketSkillEnabled(name, enabled);
        set({ skills });
        // 技能即 / 命令：激活集合变化后命令面板需要同步。
        await get().refreshSlashCommands(get().activeProjectId);
      },

      async importSkillFromUrl(url) {
        if (!apiClientRef.current?.importSkillFromUrl) {
          return;
        }
        console.info("[store] 经链接导入自定义技能", { url });
        await apiClientRef.current.importSkillFromUrl(url);
        await get().loadSkills();
        await get().refreshSlashCommands(get().activeProjectId);
      },

      async createCustomSkill(input) {
        if (!apiClientRef.current?.createCustomSkill) {
          return;
        }
        console.info("[store] 创建自定义技能", { name: input.name });
        await apiClientRef.current.createCustomSkill(input);
        await get().loadSkills();
        await get().refreshSlashCommands(get().activeProjectId);
      },

      async deleteCustomSkill(name) {
        if (!apiClientRef.current?.deleteCustomSkill) {
          return;
        }
        console.info("[store] 删除自定义技能", { name });
        const ok = await apiClientRef.current.deleteCustomSkill(name);
        if (!ok) {
          return;
        }
        set((state) => ({
          skills: state.skills.filter(
            (skill) => !(skill.source === "custom" && skill.name === name)
          )
        }));
        await get().refreshSlashCommands(get().activeProjectId);
      },

      clearRunState() {
        set({
          isRunning: false,
          streamText: "",
          thinking: "",
          thinkingStartedAt: undefined,
          events: [],
          toolActivity: undefined,
          runningTool: undefined,
          pendingTool: undefined,
          activeRunId: undefined,
          activeRunClientRequestId: undefined,
          progressPanelOpen: false,
          progressPanelAutoOpenedRunId: undefined,
          activeRunModel: undefined,
          activeRunLastAssistant: undefined
        });
      }
  };
}
