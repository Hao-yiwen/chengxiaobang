import { describe, expect, it } from "vitest";
import type { Session } from "@chengxiaobang/shared";
import { filterSessionsByTitle } from "../src/renderer/lib/session-filter";

function session(id: string, title: string): Session {
  return {
    id,
    projectId: null,
    title,
    accessMode: "approval",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z"
  };
}

const sessions = [
  session("s1", "重构登录模块"),
  session("s2", "Fix Login Bug"),
  session("s3", "周报草稿")
];

describe("filterSessionsByTitle", () => {
  it("returns all sessions for empty or whitespace-only queries", () => {
    expect(filterSessionsByTitle(sessions, "")).toBe(sessions);
    expect(filterSessionsByTitle(sessions, "   ")).toBe(sessions);
  });

  it("matches Chinese substrings", () => {
    expect(filterSessionsByTitle(sessions, "登录")).toMatchObject([
      { id: "s1" }
    ]);
  });

  it("matches case-insensitively", () => {
    expect(filterSessionsByTitle(sessions, "fix login")).toMatchObject([{ id: "s2" }]);
    expect(filterSessionsByTitle(sessions, "BUG")).toMatchObject([{ id: "s2" }]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterSessionsByTitle(sessions, "不存在的标题")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const copy = [...sessions];
    filterSessionsByTitle(sessions, "登录");
    expect(sessions).toEqual(copy);
  });
});
