/**
 * Formatting for the reasoning ("深度思考") timer. Kept as a pure function so the
 * rounding/clamping is unit-testable without a running app. The reasoning text
 * and its duration are persisted on the assistant message itself
 * (`message.reasoning` / `message.reasoningMs`).
 */

/**
 * Whole-second reading of a reasoning duration. While streaming we floor (a
 * ticking counter), once settled we round and clamp to ≥1 so a fast turn still
 * reads "用时 1 秒" rather than "0 秒".
 */
export function thinkingSeconds(ms: number, live = false): number {
  const seconds = ms / 1000;
  return live ? Math.max(0, Math.floor(seconds)) : Math.max(1, Math.round(seconds));
}
