import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";
import {
  createId,
  messageAttachmentSchema,
  nowIso,
  toolCallApprovalSchema,
  tokenUsageSchema,
  type Message,
  type MessageAttachment,
  type Project,
  type ProviderConfig,
  type RunRecord,
  type ScheduledTask,
  type Session,
  type SessionSearchResult,
  type TokenUsage,
  type ToolCall
} from "@chengxiaobang/shared";
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
  UsageStatsSourceRun
} from "./state-store";

type Row = Record<string, unknown>;
type SqlParam = string | number | null | Uint8Array;
const DEFAULT_SESSION_SEARCH_LIMIT = 30;
const MAX_SESSION_SEARCH_LIMIT = 100;
const INTERRUPTED_RUN_ERROR =
  "运行进程已重启，无法继续等待审批或工具结果。请重新发起本次请求。";

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
    this.exec(`
      create table if not exists projects (
        id text primary key,
        name text not null,
        path text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists sessions (
        id text primary key,
        project_id text,
        title text not null,
        provider_id text,
        access_mode text not null,
        model text,
        reasoning_mode text,
        created_at text not null,
        updated_at text not null,
        foreign key (project_id) references projects(id) on delete set null,
        foreign key (provider_id) references providers(id) on delete set null
      );
      create table if not exists messages (
        id text primary key,
        session_id text not null,
        role text not null,
        content text not null,
        attachments text,
        reasoning text,
        reasoning_ms integer,
        created_at text not null,
        foreign key (session_id) references sessions(id) on delete cascade
      );
      create table if not exists runs (
        id text primary key,
        session_id text not null,
        status text not null,
        provider_id text,
        provider_kind text,
        model text,
        usage text,
        error text,
        created_at text not null,
        updated_at text not null,
        foreign key (session_id) references sessions(id) on delete cascade
      );
      create table if not exists tool_calls (
        id text primary key,
        run_id text not null,
        name text not null,
        args_json text not null,
        status text not null,
        result text,
        approval_json text,
        started_at text,
        created_at text not null,
        updated_at text not null,
        foreign key (run_id) references runs(id) on delete cascade
      );
      create table if not exists settings (
        key text primary key,
        value text not null,
        updated_at text not null
      );
      create table if not exists providers (
        id text primary key,
        kind text not null,
        name text not null,
        base_url text not null,
        model text not null,
        reasoning_mode text,
        api_key_ref text,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists scheduled_tasks (
        id text primary key,
        session_id text not null,
        name text not null,
        prompt text not null,
        cron text not null,
        full_access integer not null default 0,
        enabled integer not null default 1,
        next_run_at text,
        last_run_at text,
        last_status text,
        last_error text,
        created_at text not null,
        updated_at text not null,
        foreign key (session_id) references sessions(id) on delete cascade
      );
      create index if not exists idx_projects_path on projects(path);
      create index if not exists idx_sessions_project_updated
        on sessions(project_id, updated_at desc);
      create index if not exists idx_messages_session_created
        on messages(session_id, created_at asc);
      create index if not exists idx_runs_session_updated
        on runs(session_id, updated_at desc);
      create index if not exists idx_tool_calls_run_updated
        on tool_calls(run_id, updated_at desc);
      create index if not exists idx_scheduled_tasks_enabled_next
        on scheduled_tasks(enabled, next_run_at);
      create index if not exists idx_scheduled_tasks_session
        on scheduled_tasks(session_id);
    `);
    // Older databases predate the reasoning/duration columns — add them in place.
    this.ensureColumn("messages", "reasoning", "text");
    this.ensureColumn("messages", "reasoning_ms", "integer");
    this.ensureColumn("messages", "duration_ms", "integer");
    this.ensureColumn("messages", "kind", "text");
    this.ensureColumn("messages", "payload", "text");
    this.ensureColumn("messages", "attachments", "text");
    this.ensureColumn("tool_calls", "approval_json", "text");
    this.ensureColumn("tool_calls", "started_at", "text");
    this.ensureColumn("runs", "provider_id", "text");
    this.ensureColumn("runs", "provider_kind", "text");
    this.ensureColumn("runs", "model", "text");
    this.ensureColumn("runs", "usage", "text");
    this.ensureColumn("runs", "error", "text");
    this.ensureColumn("sessions", "compacted_up_to_message_id", "text");
    this.ensureColumn("sessions", "parent_session_id", "text");
    this.ensureColumn("sessions", "fork_message_id", "text");
    this.ensureColumn("sessions", "feishu_chat_id", "text");
    // 会话级模型记忆（§6.2）：解析优先级 run > session > provider 默认。
    this.ensureColumn("sessions", "model", "text");
    this.ensureColumn("sessions", "reasoning_mode", "text");
    this.ensureColumn("providers", "reasoning_mode", "text");
    // 一个供应商可启用多个模型（JSON 数组），共用同一个 API Key。
    this.ensureColumn("providers", "models", "text");
    // 侧边栏置顶：存在 pinned_at 即视为置顶，置顶区按其降序排列。
    this.ensureColumn("projects", "pinned_at", "text");
    this.ensureColumn("sessions", "pinned_at", "text");
    await this.migrateProviderPresets();
    this.markInterruptedRunsFromPreviousProcess();
    await this.flush();
  }

  /** Add a column to an existing table when a prior schema version lacked it. */
  private ensureColumn(table: string, column: string, typeDdl: string): void {
    const columns = this.query(`pragma table_info(${table})`);
    if (!columns.some((row) => String(row.name) === column)) {
      this.exec(`alter table ${table} add column ${column} ${typeDdl};`);
    }
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
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.run(
      `insert into sessions
       (id, project_id, title, provider_id, access_mode, model, reasoning_mode, parent_session_id,
        fork_message_id, feishu_chat_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      parentSessionId: source.id,
      forkMessageId: messageId
    });
    // Clone with fresh ids but original created_at so the timeline order and
    // any compaction pointer stay meaningful in the branch.
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
      // undefined must preserve the pointer — the run-start updateSession call
      // (providerId/accessMode only) would otherwise clobber it on every run.
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
    // Cascade: remove the project's sessions (with their runs/messages) first.
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
         sessions.model as session_model,
         providers.kind as fallback_provider_kind,
         providers.model as provider_model
       from runs
       left join sessions on sessions.id = runs.session_id
       left join providers on providers.id = coalesce(runs.provider_id, sessions.provider_id)
       order by runs.created_at asc, runs.id asc`
    ).map(mapUsageStatsSourceRun);
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
       (id, kind, name, base_url, model, models, reasoning_mode, api_key_ref, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         kind = excluded.kind,
         name = excluded.name,
         base_url = excluded.base_url,
         model = excluded.model,
         models = excluded.models,
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
    // sql.js does not enforce ON DELETE SET NULL by default, so detach
    // referencing sessions explicitly before removing the provider.
    this.run("update sessions set provider_id = null where provider_id = ?", [id]);
    this.run("delete from providers where id = ?", [id]);
    await this.flush();
    return true;
  }

  private async migrateProviderPresets(): Promise<void> {
    const timestamp = nowIso();
    this.run(
      `update providers
       set model = ?, updated_at = ?
       where id = ?
         and kind = ?
         and base_url = ?
         and model = ?`,
      [
        "deepseek-v4-flash",
        timestamp,
        "deepseek",
        "deepseek",
        "https://api.deepseek.com",
        "deepseek-chat"
      ]
    );
    this.run(
      `update providers
       set base_url = ?, model = ?, updated_at = ?
       where id = ?
         and kind = ?
         and base_url = ?
         and model = ?`,
      [
        "https://api.moonshot.ai/v1",
        "kimi-k2.6",
        timestamp,
        "kimi",
        "kimi",
        "https://api.moonshot.cn/v1",
        "moonshot-v1-8k"
      ]
    );
  }

  private markInterruptedRunsFromPreviousProcess(): void {
    const runningRows = this.query(
      "select id, session_id from runs where status = ? order by updated_at asc",
      ["running"]
    );
    if (runningRows.length === 0) {
      return;
    }

    const timestamp = nowIso();
    const runIds = runningRows.map((row) => String(row.id));
    const sessionIds = [...new Set(runningRows.map((row) => String(row.session_id)))];
    const placeholders = runIds.map(() => "?").join(", ");
    const toolRows = this.query(
      `select id from tool_calls
       where run_id in (${placeholders})
         and status in (?, ?, ?)`,
      [...runIds, "pending_smart_approval", "pending_approval", "running"]
    );

    this.run(
      `update runs
       set status = ?, error = ?, updated_at = ?
       where id in (${placeholders})`,
      ["failed", INTERRUPTED_RUN_ERROR, timestamp, ...runIds]
    );
    this.run(
      `update tool_calls
       set status = ?, result = ?, updated_at = ?
       where run_id in (${placeholders})
         and status in (?, ?, ?)`,
      [
        "failed",
        INTERRUPTED_RUN_ERROR,
        timestamp,
        ...runIds,
        "pending_smart_approval",
        "pending_approval",
        "running"
      ]
    );

    console.warn("[state-store] 已收敛上个进程遗留的活跃运行", {
      runIds,
      sessionIds,
      interruptedToolCallCount: toolRows.length,
      reason: INTERRUPTED_RUN_ERROR
    });
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
    // args 一并更新：旧版 propose_plan 的 editedSteps 仍可写回，跨 run 展示依赖最终参数。
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
      cron: input.cron,
      fullAccess: input.fullAccess,
      enabled: true,
      nextRunAt: input.nextRunAt,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.run(
      `insert into scheduled_tasks
       (id, session_id, name, prompt, cron, full_access, enabled, next_run_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.sessionId,
        task.name,
        task.prompt,
        task.cron,
        task.fullAccess ? 1 : 0,
        1,
        task.nextRunAt ?? null,
        task.createdAt,
        task.updatedAt
      ]
    );
    await this.flush();
    console.log(
      `[sqlite-state-store] 已创建定时任务 id=${task.id} sessionId=${task.sessionId} cron=${task.cron}`
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
      prompt: input.prompt ?? current.prompt,
      enabled: input.enabled ?? current.enabled,
      fullAccess: input.fullAccess ?? current.fullAccess,
      nextRunAt: input.nextRunAt ?? current.nextRunAt,
      lastRunAt: input.lastRunAt ?? current.lastRunAt,
      lastStatus: input.lastStatus ?? current.lastStatus,
      lastError: input.lastError === null ? undefined : input.lastError ?? current.lastError,
      updatedAt: nowIso()
    };
    this.run(
      `update scheduled_tasks
       set name = ?, cron = ?, prompt = ?, enabled = ?, full_access = ?, next_run_at = ?,
           last_run_at = ?, last_status = ?, last_error = ?, updated_at = ?
       where id = ?`,
      [
        next.name,
        next.cron,
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
    if (!providerId) {
      return;
    }
    if (!(await this.getProvider(providerId))) {
      throw new Error("模型配置不存在");
    }
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

function resolveSqlWasmPath(): string {
  const localDistWasm = join(dirname(fileURLToPath(import.meta.url)), "sql-wasm.wasm");
  if (existsSync(localDistWasm)) {
    return localDistWasm;
  }
  return createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm");
}

function mapProject(row: Row): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    ...(row.pinned_at === null || row.pinned_at === undefined
      ? {}
      : { pinnedAt: String(row.pinned_at) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSession(row: Row): Session {
  return {
    id: String(row.id),
    projectId: row.project_id === null ? null : String(row.project_id),
    title: String(row.title),
    providerId: row.provider_id === null ? undefined : String(row.provider_id),
    accessMode:
      row.access_mode === "full_access"
        ? "full_access"
        : row.access_mode === "smart_approval"
          ? "smart_approval"
          : "approval",
    ...(row.model === null || row.model === undefined ? {} : { model: String(row.model) }),
    ...(row.reasoning_mode === null || row.reasoning_mode === undefined
      ? {}
      : { reasoningMode: row.reasoning_mode as Session["reasoningMode"] }),
    ...(row.compacted_up_to_message_id === null || row.compacted_up_to_message_id === undefined
      ? {}
      : { compactedUpToMessageId: String(row.compacted_up_to_message_id) }),
    ...(row.parent_session_id === null || row.parent_session_id === undefined
      ? {}
      : { parentSessionId: String(row.parent_session_id) }),
    ...(row.fork_message_id === null || row.fork_message_id === undefined
      ? {}
      : { forkMessageId: String(row.fork_message_id) }),
    ...(row.feishu_chat_id === null || row.feishu_chat_id === undefined
      ? {}
      : { feishuChatId: String(row.feishu_chat_id) }),
    ...(row.pinned_at === null || row.pinned_at === undefined
      ? {}
      : { pinnedAt: String(row.pinned_at) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSessionSearchResult(row: Row, query: string): SessionSearchResult {
  const session = mapSession(row);
  if (row.match_type !== "content") {
    return { session, matchType: "title" };
  }
  const role = row.message_role === "assistant" ? "assistant" : "user";
  return {
    session,
    matchType: "content",
    messageId: String(row.message_id),
    role,
    snippet: buildSearchSnippet(String(row.message_content ?? ""), query)
  };
}

function buildSearchSnippet(content: string, query: string): string {
  const maxLength = 96;
  const lowerContent = content.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const index = lowerContent.indexOf(lowerQuery);
  const start = Math.max(0, index === -1 ? 0 : index - 32);
  const end = Math.min(content.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

function mapScheduledTask(row: Row): ScheduledTask {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    name: String(row.name),
    prompt: String(row.prompt),
    cron: String(row.cron),
    fullAccess: Number(row.full_access) === 1,
    enabled: Number(row.enabled) === 1,
    ...(row.next_run_at === null || row.next_run_at === undefined
      ? {}
      : { nextRunAt: String(row.next_run_at) }),
    ...(row.last_run_at === null || row.last_run_at === undefined
      ? {}
      : { lastRunAt: String(row.last_run_at) }),
    ...(row.last_status === null || row.last_status === undefined
      ? {}
      : { lastStatus: row.last_status as ScheduledTask["lastStatus"] }),
    ...(row.last_error === null || row.last_error === undefined
      ? {}
      : { lastError: String(row.last_error) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMessage(row: Row): StoredMessage {
  const kind = row.kind === "compaction_summary" ? ("compaction_summary" as const) : undefined;
  const attachments = parseMessageAttachments(row.attachments);
  const reasoning =
    row.reasoning === null || row.reasoning === undefined ? undefined : String(row.reasoning);
  const reasoningMs =
    row.reasoning_ms === null || row.reasoning_ms === undefined
      ? undefined
      : Number(row.reasoning_ms);
  const durationMs =
    row.duration_ms === null || row.duration_ms === undefined
      ? undefined
      : Number(row.duration_ms);
  const payload =
    row.payload === null || row.payload === undefined ? undefined : String(row.payload);
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role as Message["role"],
    ...(kind ? { kind } : {}),
    content: String(row.content),
    attachments,
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(reasoningMs !== undefined ? { reasoningMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(payload !== undefined ? { payload } : {}),
    createdAt: String(row.created_at)
  };
}

function parseMessageAttachments(value: unknown): MessageAttachment[] {
  if (value === null || value === undefined) {
    return [];
  }
  try {
    const parsed = JSON.parse(String(value));
    return zodMessageAttachments(parsed);
  } catch (error) {
    console.warn("[sqlite-state-store] 消息附件 JSON 解析失败，已按空附件处理", {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

function zodMessageAttachments(value: unknown): MessageAttachment[] {
  return messageAttachmentSchema.array().parse(value);
}

function mapRun(row: Row): RunRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    status: row.status as RunRecord["status"],
    ...(row.provider_id === null || row.provider_id === undefined
      ? {}
      : { providerId: String(row.provider_id) }),
    ...(row.provider_kind === null || row.provider_kind === undefined
      ? {}
      : { providerKind: row.provider_kind as RunRecord["providerKind"] }),
    ...(row.model === null || row.model === undefined ? {} : { model: String(row.model) }),
    ...(row.usage ? { usage: parseRunUsage(row.usage) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapUsageStatsSourceRun(row: Row): UsageStatsSourceRun {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    status: row.status as UsageStatsSourceRun["status"],
    ...(row.usage ? { usage: parseRunUsage(row.usage) } : {}),
    createdAt: String(row.created_at),
    ...(row.provider_id === null || row.provider_id === undefined
      ? {}
      : { providerId: String(row.provider_id) }),
    ...(row.provider_kind === null || row.provider_kind === undefined
      ? {}
      : { providerKind: row.provider_kind as UsageStatsSourceRun["providerKind"] }),
    ...(row.model === null || row.model === undefined ? {} : { model: String(row.model) }),
    ...(row.fallback_provider_id === null || row.fallback_provider_id === undefined
      ? {}
      : { fallbackProviderId: String(row.fallback_provider_id) }),
    ...(row.fallback_provider_kind === null || row.fallback_provider_kind === undefined
      ? {}
      : {
          fallbackProviderKind:
            row.fallback_provider_kind as UsageStatsSourceRun["fallbackProviderKind"]
        }),
    ...(row.session_model === null ||
    row.session_model === undefined ||
    String(row.session_model).length === 0
      ? row.provider_model === null || row.provider_model === undefined
        ? {}
        : { fallbackModel: String(row.provider_model) }
      : { fallbackModel: String(row.session_model) })
  };
}

function parseRunUsage(value: unknown): TokenUsage | undefined {
  try {
    return tokenUsageSchema.parse(JSON.parse(String(value)));
  } catch (error) {
    console.warn("[state-store] 解析 run usage 失败", { error });
    return undefined;
  }
}

function mapToolCall(row: Row): ToolCall {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    name: row.name as ToolCall["name"],
    args: JSON.parse(String(row.args_json)) as Record<string, unknown>,
    status: row.status as ToolCall["status"],
    result: row.result === null ? undefined : String(row.result),
    ...(row.approval_json === null || row.approval_json === undefined
      ? {}
      : { approval: parseToolCallApproval(row.approval_json) }),
    ...(row.started_at === null || row.started_at === undefined
      ? {}
      : { startedAt: String(row.started_at) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function parseToolCallApproval(value: unknown): ToolCall["approval"] {
  try {
    return toolCallApprovalSchema.parse(JSON.parse(String(value)));
  } catch (error) {
    console.warn("[state-store] 解析 tool_call approval 失败", { error });
    return undefined;
  }
}

function mapProvider(row: Row): ProviderConfig {
  return {
    id: String(row.id),
    kind: row.kind as ProviderConfig["kind"],
    name: String(row.name),
    baseURL: String(row.base_url),
    model: String(row.model),
    ...(row.models === null || row.models === undefined
      ? {}
      : { models: parseProviderModels(String(row.models), String(row.id)) }),
    ...(row.reasoning_mode === null || row.reasoning_mode === undefined
      ? {}
      : { reasoningMode: row.reasoning_mode as ProviderConfig["reasoningMode"] }),
    apiKeyRef: row.api_key_ref === null ? undefined : String(row.api_key_ref),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function parseProviderModels(raw: string, providerId: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
    console.warn(`[sqlite-state-store] providers.models 不是字符串数组 providerId=${providerId}`);
    return undefined;
  } catch (error) {
    console.warn(
      `[sqlite-state-store] 解析 providers.models 失败 providerId=${providerId} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}
