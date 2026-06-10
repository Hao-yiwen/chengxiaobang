import type { Session } from "@chengxiaobang/shared";

/** Case-insensitive substring filter on session titles; empty query returns all. */
export function filterSessionsByTitle(sessions: Session[], query: string): Session[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return sessions;
  }
  return sessions.filter((session) => session.title.toLowerCase().includes(needle));
}
