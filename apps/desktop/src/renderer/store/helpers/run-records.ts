import type { ActiveRunSnapshot, RunRecord, StreamEvent } from "@chengxiaobang/shared";

export function runRecordFromEndEvent(
  event: Extract<StreamEvent, { type: "run_end" }>,
  sessionId: string,
  existing?: RunRecord
): RunRecord {
  const timestamp = new Date().toISOString();
  return {
    id: event.runId,
    sessionId,
    status: event.status,
    ...(event.usage ? { usage: event.usage } : {}),
    ...(event.status === "failed" && event.error ? { error: event.error } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

export function upsertRunHistory(runs: RunRecord[], run: RunRecord): RunRecord[] {
  const next = runs.some((item) => item.id === run.id)
    ? runs.map((item) => (item.id === run.id ? run : item))
    : [...runs, run];
  return next.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function latestActiveRunSnapshot(
  snapshots: ActiveRunSnapshot[]
): ActiveRunSnapshot | undefined {
  return [...snapshots].sort((left, right) =>
    left.run.createdAt.localeCompare(right.run.createdAt)
  ).at(-1);
}
