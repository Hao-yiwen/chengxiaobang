/**
 * Formatting for the per-turn "已工作 X 分 Y 秒" timer. Kept as a pure function so
 * the rounding/clamping is unit-testable without a running app. The turn duration
 * itself is derived in `groupTurns` (timeline.ts): live = Date.now() - run start,
 * settled = last answer createdAt - user createdAt.
 */

/**
 * Split a duration into whole minutes/seconds. While running we floor (a ticking
 * counter that starts at 0); once settled we round and clamp a sub-second turn up
 * to 1s so it reads "已工作 1 秒" rather than "0 秒". Non-finite / negative input
 * collapses to {0, 0}.
 */
export function workedParts(ms: number, live: boolean): { minutes: number; seconds: number } {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  let total: number;
  if (live) {
    total = Math.floor(safeMs / 1000);
  } else {
    total = Math.round(safeMs / 1000);
    if (total === 0 && safeMs > 0) {
      total = 1;
    }
  }
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
