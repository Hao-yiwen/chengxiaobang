import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, normalize } from "node:path";
import initSqlJs, { type Database } from "sql.js";
import {
  createId,
  nowIso,
  type Project,
  type ProviderConfig,
  type RunRecord,
  type ScheduledTask,
  type Session,
  type SessionSearchResult,
  type TokenUsage,
  type ToolCall
} from "@chengxiaobang/shared";
import {
  mapMessage,
  mapProject,
  mapProvider,
  mapRun,
  mapScheduledTask,
  mapSession,
  mapSessionSearchResult,
  mapToolCall,
  mapUsageCostEntry,
  mapUsageStatsSourceRun
} from "./sqlite-mappers";
import { resolveSqlWasmPath } from "./sqlite-runtime";
import { initializeSqliteSchema } from "./sqlite-schema";
import type { Row, SqlParam } from "./sqlite-types";
import type {
  CreateMessageInput,
  CreateProjectInput,
  CreateRunInput,
  CreateScheduledTaskInput,
  CreateSessionInput,
  StateStore,
  StoredMessage,
  UpdateScheduledTaskInput,
  UpdateSessionInput,
  UpsertUsageCostEntryInput,
  UsageCostEntry,
  UsageCostEntryFilter,
  UsageStatsSourceRun
} from "./state-store";

const DEFAULT_SESSION_SEARCH_LIMIT = 30;
const MAX_SESSION_SEARCH_LIMIT = 100;

export class SqliteStateStore implements StateStore {
  private db?: Database;
  private flushQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    const SQL = await initSqlJs({
      locateFile: () => resolveSqlWasmPath()
    });
    let data: Uint8Array | undefined;
    try {
      data = await readFile(this.dbPath);
    } catch {
      data = undefined;
    }
    this.db = data ? new SQL.Database(data) : new SQL.Database();
    this.exec("pragma foreign_keys = on;");
    initializeSqliteSchema({
      exec: (sql) => this.exec(sql),
      run: (sql, params = []) => this.run(sql, params),
      query: (sql, params = []) => this.query(sql, params)
    });
    await this.flush();
  }

  async close(): Promise<void> {
    await this.flush();
    this.db?.close();
  }

  async listProjects(): Promise<Project[]> {
    return this.query("select * from projects order by updated_at desc").map(mapProject);
  }

  async getProject(id: string): Promise<Project | undefined> {
    return this.query("select * from projects where id = ?", [id]).map(mapProject)[0];
  }

  async getProjectByPath(path: string): Promise<Project | undefined> {
    return this.query("select * from projects where path = ?", [normalize(path)]).map(
      mapProject
    )[0];
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const path = normalize(input.path);
    const existing = await this.getProjectByPath(path);
    if (existing) {
      const timestamp = nowIso();
      this.run("update projects set name = ?, updated_at = ? where id = ?", [
        input.name,
        timestamp,
        existing.id
      ]);
      await this.flush();
      return { ...existing, name: input.name, updatedAt: timestamp };
    }

    const timestamp = nowIso();
    const project: Project = {
      id: createId("project"),
      name: input.name,
      path,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.run(
      "insert into projects (id, name, path, created_at, updated_at) values (?, ?, ?, ?, ?)",
      [project.id, project.name, project.path, project.createdAt, project.updatedAt]
    );
    await this.flush();
    return project;
  }

  async renameProject(id: string, name: string): Promise<Project> {
    const current = await this.getProject(id);
    if (!current) {
      console.warn("[sqlite-state-store] 重命名项目失败：项目不存在", id);
      throw new Error("项目不存在");
    }
    const next: Project = { ...current, name, updatedAt: nowIso() };
    this.run("update projects set name = ?, updated_at = ? where id = ?", [
      next.name,
      next.updatedAt,
      id
    ]);
    await this.flush();
    console.log("[sqlite-state-store] 已重命名项目:", id, "->", name);
    return next;
  }

  async setProjectPinned(id: string, pinned: boolean): Promise<Project> {
    const current = await this.getProject(id);
    if (!current) {
      console.warn("[sqlite-state-store] 置顶项目失败：项目不存在", id);
      throw new Error("项目不存在");
    }
    // 刻意不写 updated_at：置顶不应把项目顶到普通列表最前。
    this.run("update projects set pinned_at = ? where id = ?", [pinned ? nowIso() : null, id]);
    await this.flush();
    console.log("[sqlite-state-store] 已更新项目置顶:", id, "->", pinned);
    // 重读返回：取消置顶时 {...current} 会残留旧 pinnedAt。
    return (await this.getProject(id))!;
  }

  async listSessions(projectId?: string | null): Promise<Session[]> {
    const rows =
      projectId === undefined
        ? this.query("select * from sessions order by updated_at desc")
        : projectId === null
          ? this.query("select * from sessions where project_id is null order by updated_at desc")
          : this.query(
              "select * from sessions where project_id = ? order by updated_at desc",
              [projectId]
            );
    return rows.map(mapSession);
  }

  async searchSessions(
    query: string,
    limit = DEFAULT_SESSION_SEARCH_LIMIT
  ): Promise<SessionSearchResult[]> {
    const needle = query.trim();
    if (!needle) {
      console.debug("[sqlite-state-store] 跳过空会话搜索");
      return [];
    }
    const rawLimit = Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_SESSION_SEARCH_LIMIT;
    const safeLimit = Math.max(1, Math.min(MAX_SESSION_SEARCH_LIMIT, rawLimit));
    console.debug("[sqlite-state-store] 开始搜索会话", {
      query: needle,
      limit: safeLimit
    });
    const rows = this.query(
      `
      with title_matches as (
        select
          s.*,
          0 as match_rank,
          'title' as match_type,
          null as message_id,
          null as message_role,
          null as message_content
        from sessions s
        where instr(lower(s.title), lower(?)) > 0
      ),
      first_content_matches as (
        select
          s.*,
          1 as match_rank,
          'content' as match_type,
          m.id as message_id,
          m.role as message_role,
          m.content as message_content
        from sessions s
        join messages m on m.session_id = s.id
        where m.role in ('user', 'assistant')
          and instr(lower(m.content), lower(?)) > 0
          and instr(lower(s.title), lower(?)) = 0
          and not exists (
            select 1
            from messages earlier
            where earlier.session_id = m.session_id
              and earlier.role in ('user', 'assistant')
              and instr(lower(earlier.content), lower(?)) > 0
              and (
                earlier.created_at < m.created_at
                or (earlier.created_at = m.created_at and earlier.id < m.id)
              )
          )
      )
      select *
      from (
        select * from title_matches
        union all
        select * from first_content_matches
      )
      order by match_rank asc, updated_at desc
      limit ?
      `,
      [needle, needle, needle, needle, safeLimit]
    );
    const results = rows.map((row) => mapSessionSearchResult(row, needle));
    console.info("[sqlite-state-store] 会话搜索完成", {
      query: needle,
      resultCount: results.length
    });
    return results;
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.query("select * from sessions where id = ?", [id]).map(mapSession)[0];
  }

  async findSessionByFeishuChatId(chatId: string): Promise<Session | undefined> {
    return this.query(
      "select * from sessions where feishu_chat_id = ? order by updated_at desc limit 1",
      [chatId]
    ).map(mapSession)[0];
  }

  async findSessionByWechatChatId(chatId: string): Promise<Session | undefined> {
    return this.query(
      "select * from sessions where wechat_chat_id = ? order by updated_at desc limit 1",
      [chatId]
    ).map(mapSession)[0];
  }

  async getSetting(key: string): Promise<string | undefined> {
    const row = this.query("select value from settings where key = ?", [key])[0];
    return row === undefined ? undefined : String(row.value);
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.run(
      `insert into settings (key, value, updated_at) values (?, ?, ?)
       on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, nowIso()]
    );
    await this.flush();
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    await this.assertProjectExists(input.projectId);
    await this.assertProviderExists(input.providerId);
    const timestamp = nowIso();
    const session: Session = {
      id: createId("session"),
      projectId: input.projectId,
      title: input.title,
      providerId: input.providerId,
      accessMode: input.accessMode,
      ...(input.model ? { model: input.model } : {}),
      ...(input.reasoningMode ? { reasoningMode: input.reasoningMode } : {}),
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.forkMessageId ? { forkMessageId: input.forkMessageId } : {}),
      ...(input.feishuChatId ? { feishuChatId: input.feishuChatId } : {}),
      ...(input.wechatChatId ? { wechatChatId: input.wechatChatId } : {}),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.run(
      `insert into sessions
       (id, project_id, title, provider_id, access_mode, model, reasoning_mode, parent_session_id,
        fork_message_id, feishu_chat_id, wechat_chat_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.projectId,
        session.title,
        session.providerId ?? null,
        session.accessMode,
        session.model ?? null,
        session.reasoningMode ?? null,
        session.parentSessionId ?? null,
        session.forkMessageId ?? null,
        session.feishuChatId ?? null,
        session.wechatChatId ?? null,
        session.createdAt,
        session.updatedAt
      ]
    );
    await this.flush();
    return session;
  }

  async forkSession(sessionId: string, messageId: string): Promise<Session> {
    const source = await this.getSession(sessionId);
    if (!source) {
      throw new Error("会话不存在");
    }
    const messages = await this.listMessages(sessionId);
    const index = messages.findIndex((message) => message.id === messageId);
    if (index === -1) {
      throw new Error("消息不存在");
    }
    const fork = await this.createSession({
      projectId: source.projectId,
      title: `${source.title}（分支）`,
      providerId: source.providerId,
      accessMode: source.accessMode,
      model: source.model,
      reasoningMode: source.reasoningMode,
      parentSessionId: source.id,
      forkMessageId: messageId
    });
    // 分支消息使用新 id，但保留原 created_at，确保时间线顺序和压缩指针仍然有意义。
    const idMap = new Map<string, string>();
    for (const message of messages.slice(0, index + 1)) {
      const newId = createId("msg");
      idMap.set(message.id, newId);
      this.run(
        `insert into messages
         (id, session_id, role, kind, content, attachments, reasoning, reasoning_ms, duration_ms, payload, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          fork.id,
          message.role,
          message.kind ?? null,
          message.content,
          JSON.stringify(message.attachments ?? []),
          message.reasoning ?? null,
          message.reasoningMs ?? null,
          message.durationMs ?? null,
          message.payload ?? null,
          message.createdAt
        ]
      );
    }
    await this.flush();
    const remappedPointer = source.compactedUpToMessageId
      ? idMap.get(source.compactedUpToMessageId)
      : undefined;
    if (remappedPointer) {
      return this.updateSession(fork.id, { compactedUpToMessageId: remappedPointer });
    }
    return fork;
  }

  async updateSession(id: string, input: UpdateSessionInput): Promise<Session> {
    const current = await this.getSession(id);
    if (!current) {
      throw new Error("会话不存在");
    }
    await this.assertProviderExists(input.providerId ?? undefined);
    const next: Session = {
      ...current,
      title: input.title ?? current.title,
      providerId:
        input.providerId === null ? undefined : input.providerId ?? current.providerId,
      accessMode: input.accessMode ?? current.accessMode,
      // undefined 保留会话模型记忆（run 起始的 providerId/accessMode 更新不得清掉它）；
      // null 显式清空（§6.2）。
      model: input.model === null ? undefined : input.model ?? current.model,
      reasoningMode:
        input.reasoningMode === null
          ? undefined
          : input.reasoningMode ?? current.reasoningMode,
      // undefined 必须保留指针；否则 run 起始时只更新 providerId/accessMode
      // 也会在每次运行时误清空它。
      compactedUpToMessageId:
        input.compactedUpToMessageId === null
          ? undefined
          : input.compactedUpToMessageId ?? current.compactedUpToMessageId,
      updatedAt: nowIso()
    };
    this.run(
      `update sessions
       set title = ?, provider_id = ?, access_mode = ?, model = ?, reasoning_mode = ?,
           compacted_up_to_message_id = ?, updated_at = ?
       where id = ?`,
      [
        next.title,
        next.providerId ?? null,
        next.accessMode,
        next.model ?? null,
        next.reasoningMode ?? null,
        next.compactedUpToMessageId ?? null,
        next.updatedAt,
        id
      ]
    );
    await this.flush();
    return next;
  }

  async setSessionPinned(id: string, pinned: boolean): Promise<Session> {
    const current = await this.getSession(id);
    if (!current) {
      console.warn("[sqlite-state-store] 置顶会话失败：会话不存在", id);
      throw new Error("会话不存在");
    }
    // 刻意不写 updated_at：置顶不应把会话顶到普通列表最前。
    this.run("update sessions set pinned_at = ? where id = ?", [pinned ? nowIso() : null, id]);
    await this.flush();
    console.log("[sqlite-state-store] 已更新会话置顶:", id, "->", pinned);
    // 重读返回：取消置顶时 {...current} 会残留旧 pinnedAt。
    return (await this.getSession(id))!;
  }

  async deleteProject(id: string): Promise<boolean> {
    const exists = await this.getProject(id);
    if (!exists) {
      return false;
    }
    // 级联删除：先移除项目下的会话，以及这些会话的运行和消息。
    const sessions = this.query("select id from sessions where project_id = ?", [id]);
    for (const session of sessions) {
      await this.deleteSession(String(session.id));
    }
    this.run("delete from projects where id = ?", [id]);
    await this.flush();
    console.log("[sqlite-state-store] 已删除项目及其会话:", id, `(${sessions.length} 个会话)`);
    return true;
  }

  async deleteSession(id: string): Promise<boolean> {
    const exists = await this.getSession(id);
    if (!exists) {
      return false;
    }
    const runs = this.query("select id from runs where session_id = ?", [id]);
    for (const run of runs) {
      this.run("delete from tool_calls where run_id = ?", [String(run.id)]);
    }
    this.run("delete from runs where session_id = ?", [id]);
    this.run("delete from messages where session_id = ?", [id]);
    this.run("delete from scheduled_tasks where session_id = ?", [id]);
    this.run("delete from sessions where id = ?", [id]);
    await this.flush();
    return true;
  }

  async touchSession(id: string, title?: string): Promise<void> {
    await this.assertSessionExists(id);
    const timestamp = nowIso();
    if (title) {
      this.run("update sessions set title = ?, updated_at = ? where id = ?", [
        title,
        timestamp,
        id
      ]);
    } else {
      this.run("update sessions set updated_at = ? where id = ?", [timestamp, id]);
    }
    await this.flush();
  }

  async addMessage(input: CreateMessageInput): Promise<StoredMessage> {
    await this.assertSessionExists(input.sessionId);
    const message: StoredMessage = {
      id: createId("msg"),
      sessionId: input.sessionId,
      role: input.role,
      ...(input.kind ? { kind: input.kind } : {}),
      content: input.content,
      attachments: input.attachments ?? [],
      ...(input.reasoning ? { reasoning: input.reasoning } : {}),
      ...(input.reasoningMs !== undefined ? { reasoningMs: input.reasoningMs } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      createdAt: nowIso()
    };
    this.run(
      `insert into messages
       (id, session_id, role, kind, content, attachments, reasoning, reasoning_ms, duration_ms, payload, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.sessionId,
        message.role,
        message.kind ?? null,
        message.content,
        JSON.stringify(message.attachments),
        message.reasoning ?? null,
        message.reasoningMs ?? null,
        message.durationMs ?? null,
        message.payload ?? null,
        message.createdAt
      ]
    );
    await this.touchSession(message.sessionId);
    await this.flush();
    return message;
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    await this.assertSessionExists(sessionId);
    return this.query("select * from messages where session_id = ? order by created_at asc", [
      sessionId
    ]).map(mapMessage);
  }

  async deleteMessagesFrom(sessionId: string, messageId: string): Promise<number> {
    // 使用和 listMessages 相同的顺序定位后缀，避免 created_at 并列时删错消息。
    const messages = await this.listMessages(sessionId);
    const index = messages.findIndex((message) => message.id === messageId);
    if (index === -1) {
      return 0;
    }
    const doomed = messages.slice(index);
    for (const message of doomed) {
      this.run("delete from messages where id = ?", [message.id]);
    }
    // run 会先于用户消息创建；重试时要同时清掉创建较晚或在该消息后仍被更新的 run。
    const cutoff = doomed[0].createdAt;
    const runs = this.query(
      `select id from runs
       where session_id = ?
         and (created_at >= ? or updated_at >= ?)`,
      [sessionId, cutoff, cutoff]
    );
    const runIds = runs.map((run) => String(run.id));
    for (const run of runs) {
      this.run("delete from tool_calls where run_id = ?", [String(run.id)]);
    }
    this.run(
      `delete from runs
       where session_id = ?
         and (created_at >= ? or updated_at >= ?)`,
      [sessionId, cutoff, cutoff]
    );
    console.info("[state-store] 已回退会话消息并清理相关运行", {
      sessionId,
      messageId,
      deletedMessageCount: doomed.length,
      deletedRunIds: runIds,
      cutoff
    });
    await this.touchSession(sessionId);
    await this.flush();
    return doomed.length;
  }

  async createRun(input: CreateRunInput): Promise<void> {
    await this.assertSessionExists(input.sessionId);
    const timestamp = nowIso();
    this.run(
      `insert into runs
       (id, session_id, status, provider_id, provider_kind, model, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.sessionId,
        input.status,
        input.providerId ?? null,
        input.providerKind ?? null,
        input.model ?? null,
        timestamp,
        timestamp
      ]
    );
    await this.flush();
  }

  async updateRunStatus(
    id: string,
    status: CreateRunInput["status"],
    usage?: TokenUsage,
    error?: string
  ): Promise<void> {
    const runRows = this.query("select session_id from runs where id = ?", [id]);
    if (runRows.length === 0) {
      throw new Error("运行记录不存在");
    }
    const sessionId = String(runRows[0].session_id);
    const errorText = status === "failed" && error ? error : undefined;
    if (usage) {
      this.run("update runs set status = ?, usage = ?, error = ?, updated_at = ? where id = ?", [
        status,
        JSON.stringify(usage),
        errorText ?? null,
        nowIso(),
        id
      ]);
    } else {
      this.run("update runs set status = ?, error = ?, updated_at = ? where id = ?", [
        status,
        errorText ?? null,
        nowIso(),
        id
      ]);
    }
    if (errorText) {
      console.warn("[state-store] 运行失败原因已持久化", {
        runId: id,
        sessionId,
        error: errorText
      });
    }
    await this.flush();
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    await this.assertSessionExists(sessionId);
    return this.query("select * from runs where session_id = ? order by created_at asc, id asc", [
      sessionId
    ]).map(mapRun);
  }

  async listUsageStatsRuns(): Promise<UsageStatsSourceRun[]> {
    return this.query(
      `select
         runs.*,
         sessions.provider_id as fallback_provider_id,
         sessions.model as session_model
       from runs
       left join sessions on sessions.id = runs.session_id
       order by runs.created_at asc, runs.id asc`
    ).map(mapUsageStatsSourceRun);
  }

  async upsertUsageCostEntry(
    input: UpsertUsageCostEntryInput
  ): Promise<UsageCostEntry> {
    const id = input.id ?? createId("usage_cost");
    const recordedAt = nowIso();
    this.run(
      `insert into usage_cost_entries
       (id, run_id, session_id, attempt_index, provider_id, provider_kind, model,
        status_code, error_code, error_message, prompt_tokens, completion_tokens,
        cached_prompt_tokens, total_tokens, input_estimated_tokens, cost_usd,
        cost_cny, cost_source, token_count_source, billable, entry_created_at, recorded_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(run_id, attempt_index) do update set
         provider_id = excluded.provider_id,
         provider_kind = excluded.provider_kind,
         model = excluded.model,
         status_code = excluded.status_code,
         error_code = excluded.error_code,
         error_message = excluded.error_message,
         prompt_tokens = excluded.prompt_tokens,
         completion_tokens = excluded.completion_tokens,
         cached_prompt_tokens = excluded.cached_prompt_tokens,
         total_tokens = excluded.total_tokens,
         input_estimated_tokens = excluded.input_estimated_tokens,
         cost_usd = excluded.cost_usd,
         cost_cny = excluded.cost_cny,
         cost_source = excluded.cost_source,
         token_count_source = excluded.token_count_source,
         billable = excluded.billable,
         entry_created_at = excluded.entry_created_at,
         recorded_at = excluded.recorded_at`,
      [
        id,
        input.runId,
        input.sessionId,
        input.attemptIndex,
        input.providerId ?? null,
        input.providerKind ?? null,
        input.model ?? null,
        input.statusCode ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.promptTokens,
        input.completionTokens,
        input.cachedPromptTokens,
        input.totalTokens,
        input.inputEstimatedTokens,
        input.costUsd,
        input.costCny,
        input.costSource,
        input.tokenCountSource,
        input.billable ? 1 : 0,
        input.entryCreatedAt,
        recordedAt
      ]
    );
    await this.flush();
    const rows = this.query(
      "select * from usage_cost_entries where run_id = ? and attempt_index = ?",
      [input.runId, input.attemptIndex]
    );
    if (rows.length === 0) {
      throw new Error("费用账本写入失败");
    }
    const entry = mapUsageCostEntry(rows[0]);
    console.debug("[state-store] 费用账本已写入", {
      runId: entry.runId,
      sessionId: entry.sessionId,
      attemptIndex: entry.attemptIndex,
      costSource: entry.costSource,
      billable: entry.billable,
      costCny: entry.costCny
    });
    return entry;
  }

  async listUsageCostEntries(
    filter: UsageCostEntryFilter = {}
  ): Promise<UsageCostEntry[]> {
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (filter.sessionId) {
      where.push("session_id = ?");
      params.push(filter.sessionId);
    }
    if (filter.finalizedOnly) {
      where.push("cost_source <> ?");
      params.push("pending");
    }
    const whereSql = where.length > 0 ? ` where ${where.join(" and ")}` : "";
    return this.query(
      `select * from usage_cost_entries${whereSql}
       order by entry_created_at asc, run_id asc, attempt_index asc`,
      params
    ).map(mapUsageCostEntry);
  }

  async getSessionUsageCostCny(sessionId: string): Promise<number> {
    await this.assertSessionExists(sessionId);
    const rows = this.query(
      `select coalesce(sum(cost_cny), 0) as cost_cny
       from usage_cost_entries
       where session_id = ? and cost_source <> ?`,
      [sessionId, "pending"]
    );
    return roundCurrency(Number(rows[0]?.cost_cny ?? 0));
  }

  async listToolCallsForSession(sessionId: string): Promise<ToolCall[]> {
    await this.assertSessionExists(sessionId);
    return this.query(
      `select tool_calls.*
       from tool_calls
       inner join runs on runs.id = tool_calls.run_id
       where runs.session_id = ?
       order by tool_calls.created_at asc`,
      [sessionId]
    ).map(mapToolCall);
  }

  async listProviders(): Promise<ProviderConfig[]> {
    return this.query("select * from providers order by created_at asc").map(mapProvider);
  }

  async getProvider(id: string): Promise<ProviderConfig | undefined> {
    return this.query("select * from providers where id = ?", [id]).map(mapProvider)[0];
  }

  async upsertProvider(provider: ProviderConfig): Promise<ProviderConfig> {
    this.run(
      `insert into providers
       (id, kind, name, base_url, model, models, model_overrides, reasoning_mode, api_key_ref, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         kind = excluded.kind,
         name = excluded.name,
         base_url = excluded.base_url,
         model = excluded.model,
         models = excluded.models,
         model_overrides = excluded.model_overrides,
         reasoning_mode = excluded.reasoning_mode,
         api_key_ref = excluded.api_key_ref,
         updated_at = excluded.updated_at`,
      [
        provider.id,
        provider.kind,
        provider.name,
        provider.baseURL,
        provider.model,
        provider.models && provider.models.length > 0 ? JSON.stringify(provider.models) : null,
        provider.modelOverrides && Object.keys(provider.modelOverrides).length > 0
          ? JSON.stringify(provider.modelOverrides)
          : null,
        provider.reasoningMode ?? null,
        provider.apiKeyRef ?? null,
        provider.createdAt,
        provider.updatedAt
      ]
    );
    await this.flush();
    return provider;
  }

  async deleteProvider(id: string): Promise<boolean> {
    const existing = await this.getProvider(id);
    if (!existing) {
      return false;
    }
    // sql.js 默认不强制执行 ON DELETE SET NULL，删除 provider 前显式解绑会话。
    this.run("update sessions set provider_id = null where provider_id = ?", [id]);
    this.run("delete from providers where id = ?", [id]);
    await this.flush();
    return true;
  }

  async insertToolCall(toolCall: ToolCall): Promise<ToolCall> {
    await this.assertRunExists(toolCall.runId);
    this.run(
      `insert into tool_calls
       (id, run_id, name, args_json, status, result, approval_json, started_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        toolCall.id,
        toolCall.runId,
        toolCall.name,
        JSON.stringify(toolCall.args),
        toolCall.status,
        toolCall.result ?? null,
        toolCall.approval ? JSON.stringify(toolCall.approval) : null,
        toolCall.startedAt ?? null,
        toolCall.createdAt,
        toolCall.updatedAt
      ]
    );
    await this.flush();
    return toolCall;
  }

  async updateToolCall(toolCall: ToolCall): Promise<ToolCall> {
    await this.assertToolCallExists(toolCall.id);
    // args 一并更新：ExitPlanMode 的确认后参数会写回，跨 run 展示依赖最终参数。
    this.run(
      `update tool_calls
       set args_json = ?, status = ?, result = ?, approval_json = ?, started_at = ?, updated_at = ?
       where id = ?`,
      [
        JSON.stringify(toolCall.args),
        toolCall.status,
        toolCall.result ?? null,
        toolCall.approval ? JSON.stringify(toolCall.approval) : null,
        toolCall.startedAt ?? null,
        toolCall.updatedAt,
        toolCall.id
      ]
    );
    await this.flush();
    return toolCall;
  }

  async listScheduledTasks(): Promise<ScheduledTask[]> {
    return this.query("select * from scheduled_tasks order by created_at asc").map(
      mapScheduledTask
    );
  }

  async getScheduledTask(id: string): Promise<ScheduledTask | undefined> {
    return this.query("select * from scheduled_tasks where id = ?", [id]).map(
      mapScheduledTask
    )[0];
  }

  async createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
    await this.assertSessionExists(input.sessionId);
    const timestamp = nowIso();
    const task: ScheduledTask = {
      id: createId("task"),
      sessionId: input.sessionId,
      name: input.name,
      prompt: input.prompt,
      kind: input.kind,
      ...(input.cron ? { cron: input.cron } : {}),
      ...(input.runAt ? { runAt: input.runAt } : {}),
      fullAccess: input.fullAccess,
      enabled: true,
      nextRunAt: input.nextRunAt,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.run(
      `insert into scheduled_tasks
       (id, session_id, name, prompt, kind, cron, run_at, full_access, enabled, next_run_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.sessionId,
        task.name,
        task.prompt,
        task.kind,
        task.cron ?? "",
        task.runAt ?? null,
        task.fullAccess ? 1 : 0,
        1,
        task.nextRunAt ?? null,
        task.createdAt,
        task.updatedAt
      ]
    );
    await this.flush();
    console.log(
      `[sqlite-state-store] 已创建定时任务 id=${task.id} sessionId=${task.sessionId} kind=${task.kind}` +
        (task.cron ? ` cron=${task.cron}` : "") +
        (task.runAt ? ` runAt=${task.runAt}` : "")
    );
    return task;
  }

  async updateScheduledTask(
    id: string,
    input: UpdateScheduledTaskInput
  ): Promise<ScheduledTask | undefined> {
    const current = await this.getScheduledTask(id);
    if (!current) {
      // 任务可能在执行途中被删除：no-op 而非抛错，调度器收尾写状态时容忍。
      console.warn("[sqlite-state-store] 更新定时任务跳过：任务不存在", id);
      return undefined;
    }
    const next: ScheduledTask = {
      ...current,
      name: input.name ?? current.name,
      cron: input.cron ?? current.cron,
      runAt: input.runAt ?? current.runAt,
      prompt: input.prompt ?? current.prompt,
      enabled: input.enabled ?? current.enabled,
      fullAccess: input.fullAccess ?? current.fullAccess,
      nextRunAt: input.nextRunAt === null ? undefined : input.nextRunAt ?? current.nextRunAt,
      lastRunAt: input.lastRunAt ?? current.lastRunAt,
      lastStatus: input.lastStatus ?? current.lastStatus,
      lastError: input.lastError === null ? undefined : input.lastError ?? current.lastError,
      updatedAt: nowIso()
    };
    this.run(
      `update scheduled_tasks
       set name = ?, cron = ?, run_at = ?, prompt = ?, enabled = ?, full_access = ?, next_run_at = ?,
           last_run_at = ?, last_status = ?, last_error = ?, updated_at = ?
       where id = ?`,
      [
        next.name,
        next.cron ?? "",
        next.runAt ?? null,
        next.prompt,
        next.enabled ? 1 : 0,
        next.fullAccess ? 1 : 0,
        next.nextRunAt ?? null,
        next.lastRunAt ?? null,
        next.lastStatus ?? null,
        next.lastError ?? null,
        next.updatedAt,
        id
      ]
    );
    await this.flush();
    return next;
  }

  async deleteScheduledTask(id: string): Promise<boolean> {
    const exists = await this.getScheduledTask(id);
    if (!exists) {
      return false;
    }
    this.run("delete from scheduled_tasks where id = ?", [id]);
    await this.flush();
    console.log("[sqlite-state-store] 已删除定时任务:", id);
    return true;
  }

  private async assertProjectExists(projectId: string | null | undefined): Promise<void> {
    if (!projectId) {
      return;
    }
    if (!(await this.getProject(projectId))) {
      throw new Error("项目不存在");
    }
  }

  private async assertProviderExists(providerId: string | undefined): Promise<void> {
    // provider 已迁移到 ~/.chengxiaobang/config.yaml；SQLite 只保存会话里的 providerId 快照。
    void providerId;
  }

  private async assertSessionExists(sessionId: string): Promise<void> {
    if (!(await this.getSession(sessionId))) {
      throw new Error("会话不存在");
    }
  }

  private async assertRunExists(runId: string): Promise<void> {
    const exists = this.query("select id from runs where id = ?", [runId]).length > 0;
    if (!exists) {
      throw new Error("运行记录不存在");
    }
  }

  private async assertToolCallExists(toolCallId: string): Promise<void> {
    const exists =
      this.query("select id from tool_calls where id = ?", [toolCallId]).length > 0;
    if (!exists) {
      throw new Error("工具调用不存在");
    }
  }

  private exec(sql: string): void {
    this.database.exec(sql);
  }

  private run(sql: string, params: SqlParam[] = []): void {
    const statement = this.database.prepare(sql);
    try {
      statement.run(params);
    } finally {
      statement.free();
    }
  }

  private query(sql: string, params: SqlParam[] = []): Row[] {
    const statement = this.database.prepare(sql);
    const rows: Row[] = [];
    try {
      statement.bind(params);
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  private async flush(): Promise<void> {
    const task = this.flushQueue.then(async () => {
      if (!this.db) {
        return;
      }
      await writeFile(this.dbPath, Buffer.from(this.db.export()));
    });
    this.flushQueue = task.catch((error) => {
      console.error("[sqlite-store] flush 失败，后续写入仍会继续排队", {
        dbPath: this.dbPath,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    await task;
  }

  private get database(): Database {
    if (!this.db) {
      throw new Error("State store is not initialized");
    }
    return this.db;
  }
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
