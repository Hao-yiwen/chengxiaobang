import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";
import {
  createId,
  nowIso,
  type Message,
  type Project,
  type ProviderConfig,
  type RunRecord,
  type Session,
  type ToolCall
} from "@chengxiaobang/shared";
import type {
  CreateMessageInput,
  CreateProjectInput,
  CreateRunInput,
  CreateSessionInput,
  StateStore,
  UpdateSessionInput
} from "./state-store";

type Row = Record<string, unknown>;
type SqlParam = string | number | null | Uint8Array;

export class SqliteStateStore implements StateStore {
  private db?: Database;

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
        reasoning text,
        reasoning_ms integer,
        created_at text not null,
        foreign key (session_id) references sessions(id) on delete cascade
      );
      create table if not exists runs (
        id text primary key,
        session_id text not null,
        status text not null,
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
        started_at text,
        created_at text not null,
        updated_at text not null,
        foreign key (run_id) references runs(id) on delete cascade
      );
      create table if not exists providers (
        id text primary key,
        kind text not null,
        name text not null,
        base_url text not null,
        model text not null,
        api_key_ref text,
        created_at text not null,
        updated_at text not null
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
    `);
    // Older databases predate the reasoning/duration columns — add them in place.
    this.ensureColumn("messages", "reasoning", "text");
    this.ensureColumn("messages", "reasoning_ms", "integer");
    this.ensureColumn("messages", "duration_ms", "integer");
    this.ensureColumn("messages", "kind", "text");
    this.ensureColumn("tool_calls", "started_at", "text");
    this.ensureColumn("sessions", "compacted_up_to_message_id", "text");
    this.ensureColumn("sessions", "parent_session_id", "text");
    this.ensureColumn("sessions", "fork_message_id", "text");
    await this.migrateProviderPresets();
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

  async getSession(id: string): Promise<Session | undefined> {
    return this.query("select * from sessions where id = ?", [id]).map(mapSession)[0];
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
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.forkMessageId ? { forkMessageId: input.forkMessageId } : {}),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.run(
      `insert into sessions
       (id, project_id, title, provider_id, access_mode, parent_session_id, fork_message_id,
        created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.projectId,
        session.title,
        session.providerId ?? null,
        session.accessMode,
        session.parentSessionId ?? null,
        session.forkMessageId ?? null,
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
         (id, session_id, role, kind, content, reasoning, reasoning_ms, duration_ms, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          fork.id,
          message.role,
          message.kind ?? null,
          message.content,
          message.reasoning ?? null,
          message.reasoningMs ?? null,
          message.durationMs ?? null,
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
       set title = ?, provider_id = ?, access_mode = ?, compacted_up_to_message_id = ?, updated_at = ?
       where id = ?`,
      [
        next.title,
        next.providerId ?? null,
        next.accessMode,
        next.compactedUpToMessageId ?? null,
        next.updatedAt,
        id
      ]
    );
    await this.flush();
    return next;
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

  async addMessage(input: CreateMessageInput): Promise<Message> {
    await this.assertSessionExists(input.sessionId);
    const message: Message = {
      id: createId("msg"),
      sessionId: input.sessionId,
      role: input.role,
      ...(input.kind ? { kind: input.kind } : {}),
      content: input.content,
      ...(input.reasoning ? { reasoning: input.reasoning } : {}),
      ...(input.reasoningMs !== undefined ? { reasoningMs: input.reasoningMs } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      createdAt: nowIso()
    };
    this.run(
      `insert into messages
       (id, session_id, role, kind, content, reasoning, reasoning_ms, duration_ms, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.sessionId,
        message.role,
        message.kind ?? null,
        message.content,
        message.reasoning ?? null,
        message.reasoningMs ?? null,
        message.durationMs ?? null,
        message.createdAt
      ]
    );
    await this.touchSession(message.sessionId);
    await this.flush();
    return message;
  }

  async listMessages(sessionId: string): Promise<Message[]> {
    await this.assertSessionExists(sessionId);
    return this.query("select * from messages where session_id = ? order by created_at asc", [
      sessionId
    ]).map(mapMessage);
  }

  async deleteMessagesFrom(sessionId: string, messageId: string): Promise<number> {
    // Index into the same ordering listMessages uses, so created_at ties
    // cannot drop a different suffix than the one callers see.
    const messages = await this.listMessages(sessionId);
    const index = messages.findIndex((message) => message.id === messageId);
    if (index === -1) {
      return 0;
    }
    const doomed = messages.slice(index);
    for (const message of doomed) {
      this.run("delete from messages where id = ?", [message.id]);
    }
    // Drop runs (and their tool calls) from the deleted span, or orphaned
    // tool rows would interleave into the regenerated timeline.
    const cutoff = doomed[0].createdAt;
    const runs = this.query("select id from runs where session_id = ? and created_at >= ?", [
      sessionId,
      cutoff
    ]);
    for (const run of runs) {
      this.run("delete from tool_calls where run_id = ?", [String(run.id)]);
    }
    this.run("delete from runs where session_id = ? and created_at >= ?", [sessionId, cutoff]);
    await this.touchSession(sessionId);
    await this.flush();
    return doomed.length;
  }

  async createRun(input: CreateRunInput): Promise<void> {
    await this.assertSessionExists(input.sessionId);
    const timestamp = nowIso();
    this.run(
      "insert into runs (id, session_id, status, created_at, updated_at) values (?, ?, ?, ?, ?)",
      [input.id, input.sessionId, input.status, timestamp, timestamp]
    );
    await this.flush();
  }

  async updateRunStatus(id: string, status: CreateRunInput["status"]): Promise<void> {
    await this.assertRunExists(id);
    this.run("update runs set status = ?, updated_at = ? where id = ?", [
      status,
      nowIso(),
      id
    ]);
    await this.flush();
  }

  async listRuns(sessionId: string): Promise<RunRecord[]> {
    await this.assertSessionExists(sessionId);
    return this.query("select * from runs where session_id = ? order by created_at asc", [
      sessionId
    ]).map(mapRun);
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
       (id, kind, name, base_url, model, api_key_ref, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         kind = excluded.kind,
         name = excluded.name,
         base_url = excluded.base_url,
         model = excluded.model,
         api_key_ref = excluded.api_key_ref,
         updated_at = excluded.updated_at`,
      [
        provider.id,
        provider.kind,
        provider.name,
        provider.baseURL,
        provider.model,
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

  async insertToolCall(toolCall: ToolCall): Promise<ToolCall> {
    await this.assertRunExists(toolCall.runId);
    this.run(
      `insert into tool_calls
       (id, run_id, name, args_json, status, result, started_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        toolCall.id,
        toolCall.runId,
        toolCall.name,
        JSON.stringify(toolCall.args),
        toolCall.status,
        toolCall.result ?? null,
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
    this.run(
      `update tool_calls
       set status = ?, result = ?, started_at = ?, updated_at = ?
       where id = ?`,
      [
        toolCall.status,
        toolCall.result ?? null,
        toolCall.startedAt ?? null,
        toolCall.updatedAt,
        toolCall.id
      ]
    );
    await this.flush();
    return toolCall;
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
    if (!this.db) {
      return;
    }
    await writeFile(this.dbPath, Buffer.from(this.db.export()));
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
    accessMode: row.access_mode === "full_access" ? "full_access" : "approval",
    ...(row.compacted_up_to_message_id === null || row.compacted_up_to_message_id === undefined
      ? {}
      : { compactedUpToMessageId: String(row.compacted_up_to_message_id) }),
    ...(row.parent_session_id === null || row.parent_session_id === undefined
      ? {}
      : { parentSessionId: String(row.parent_session_id) }),
    ...(row.fork_message_id === null || row.fork_message_id === undefined
      ? {}
      : { forkMessageId: String(row.fork_message_id) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMessage(row: Row): Message {
  const kind = row.kind === "compaction_summary" ? ("compaction_summary" as const) : undefined;
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
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role as Message["role"],
    ...(kind ? { kind } : {}),
    content: String(row.content),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(reasoningMs !== undefined ? { reasoningMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    createdAt: String(row.created_at)
  };
}

function mapRun(row: Row): RunRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    status: row.status as RunRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapToolCall(row: Row): ToolCall {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    name: row.name as ToolCall["name"],
    args: JSON.parse(String(row.args_json)) as Record<string, unknown>,
    status: row.status as ToolCall["status"],
    result: row.result === null ? undefined : String(row.result),
    ...(row.started_at === null || row.started_at === undefined
      ? {}
      : { startedAt: String(row.started_at) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapProvider(row: Row): ProviderConfig {
  return {
    id: String(row.id),
    kind: row.kind as ProviderConfig["kind"],
    name: String(row.name),
    baseURL: String(row.base_url),
    model: String(row.model),
    apiKeyRef: row.api_key_ref === null ? undefined : String(row.api_key_ref),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
