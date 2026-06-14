import { nowIso } from "@chengxiaobang/shared";
import type { Row, SqliteConnection } from "./sqlite-types";

export const INTERRUPTED_RUN_ERROR =
  "运行进程已重启，无法继续等待审批或工具结果。请重新发起本次请求。";

export function initializeSqliteSchema(connection: SqliteConnection): void {
  connection.exec(`
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
      foreign key (project_id) references projects(id) on delete set null
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
    create table if not exists usage_cost_entries (
      id text primary key,
      run_id text not null,
      session_id text not null,
      attempt_index integer not null,
      provider_id text,
      provider_kind text,
      model text,
      status_code integer,
      error_code text,
      error_message text,
      prompt_tokens integer not null default 0,
      completion_tokens integer not null default 0,
      cached_prompt_tokens integer not null default 0,
      total_tokens integer not null default 0,
      input_estimated_tokens integer not null default 0,
      cost_usd real not null default 0,
      cost_cny real not null default 0,
      cost_source text not null,
      token_count_source text not null,
      billable integer not null default 0,
      entry_created_at text not null,
      recorded_at text not null,
      unique(run_id, attempt_index),
      foreign key (run_id) references runs(id) on delete cascade,
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
      model_overrides text,
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
      kind text not null default 'recurring',
      cron text not null,
      run_at text,
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
    create index if not exists idx_usage_cost_session_entry
      on usage_cost_entries(session_id, entry_created_at asc);
    create index if not exists idx_usage_cost_entry_created
      on usage_cost_entries(entry_created_at asc);
    create index if not exists idx_usage_cost_provider_model
      on usage_cost_entries(provider_kind, model);
    create index if not exists idx_usage_cost_billable
      on usage_cost_entries(billable);
    create index if not exists idx_tool_calls_run_updated
      on tool_calls(run_id, updated_at desc);
    create index if not exists idx_scheduled_tasks_enabled_next
      on scheduled_tasks(enabled, next_run_at);
    create index if not exists idx_scheduled_tasks_session
      on scheduled_tasks(session_id);
  `);
  ensureColumn(connection, "messages", "reasoning", "text");
  ensureColumn(connection, "messages", "reasoning_ms", "integer");
  ensureColumn(connection, "messages", "duration_ms", "integer");
  ensureColumn(connection, "messages", "kind", "text");
  ensureColumn(connection, "messages", "payload", "text");
  ensureColumn(connection, "messages", "attachments", "text");
  ensureColumn(connection, "tool_calls", "approval_json", "text");
  ensureColumn(connection, "tool_calls", "started_at", "text");
  ensureColumn(connection, "runs", "provider_id", "text");
  ensureColumn(connection, "runs", "provider_kind", "text");
  ensureColumn(connection, "runs", "model", "text");
  ensureColumn(connection, "runs", "usage", "text");
  ensureColumn(connection, "runs", "error", "text");
  ensureColumn(connection, "usage_cost_entries", "status_code", "integer");
  ensureColumn(connection, "usage_cost_entries", "error_code", "text");
  ensureColumn(connection, "usage_cost_entries", "error_message", "text");
  ensureColumn(connection, "sessions", "compacted_up_to_message_id", "text");
  ensureColumn(connection, "sessions", "parent_session_id", "text");
  ensureColumn(connection, "sessions", "fork_message_id", "text");
  ensureColumn(connection, "sessions", "feishu_chat_id", "text");
  ensureColumn(connection, "sessions", "model", "text");
  ensureColumn(connection, "sessions", "reasoning_mode", "text");
  ensureColumn(connection, "providers", "reasoning_mode", "text");
  ensureColumn(connection, "providers", "models", "text");
  ensureColumn(connection, "providers", "model_overrides", "text");
  ensureColumn(connection, "projects", "pinned_at", "text");
  ensureColumn(connection, "sessions", "pinned_at", "text");
  ensureColumn(connection, "scheduled_tasks", "kind", "text not null default 'recurring'");
  ensureColumn(connection, "scheduled_tasks", "run_at", "text");
  markInterruptedRunsFromPreviousProcess(connection);
}

function ensureColumn(
  connection: SqliteConnection,
  table: string,
  column: string,
  typeDdl: string
): void {
  const columns = connection.query(`pragma table_info(${table})`);
  if (!columns.some((row) => String(row.name) === column)) {
    connection.exec(`alter table ${table} add column ${column} ${typeDdl};`);
  }
}

function markInterruptedRunsFromPreviousProcess(connection: SqliteConnection): void {
  const runningRows = connection.query(
    "select id, session_id from runs where status = ? order by updated_at asc",
    ["running"]
  );
  if (runningRows.length === 0) {
    return;
  }

  const timestamp = nowIso();
  const runIds = runningRows.map((row) => String(row.id));
  const sessionIds = uniqueSessionIds(runningRows);
  const placeholders = runIds.map(() => "?").join(", ");
  const toolRows = connection.query(
    `select id from tool_calls
     where run_id in (${placeholders})
       and status in (?, ?, ?)`,
    [...runIds, "pending_smart_approval", "pending_approval", "running"]
  );

  connection.run(
    `update runs
     set status = ?, error = ?, updated_at = ?
     where id in (${placeholders})`,
    ["failed", INTERRUPTED_RUN_ERROR, timestamp, ...runIds]
  );
  connection.run(
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

function uniqueSessionIds(rows: Row[]): string[] {
  return [...new Set(rows.map((row) => String(row.session_id)))];
}
