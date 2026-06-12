import { describe, expect, it } from "vitest";
import { previewPathCandidates, safeResolveWithin } from "../src/main/file-preview-path";

describe("file preview path candidates", () => {
  it("keeps absolute paths unchanged", () => {
    expect(previewPathCandidates("/tmp/report.xlsx", { cwd: "/repo" })).toEqual([
      "/tmp/report.xlsx"
    ]);
  });

  it("tries project path before conversation session workspace", () => {
    expect(
      previewPathCandidates("out/report.xlsx", {
        projectPath: "/repo/project",
        sessionId: "session_abc",
        chengxiaobangHome: "/home/.chengxiaobang",
        cwd: "/repo/app"
      })
    ).toEqual([
      "/repo/project/out/report.xlsx",
      "/home/.chengxiaobang/session_abc/out/report.xlsx",
      "/repo/app/out/report.xlsx"
    ]);
  });

  it("uses the independent session workspace for no-project artifacts", () => {
    expect(
      previewPathCandidates("个人财务收支表_2026年6月.xlsx", {
        sessionId: "session_87f0e4ec-201c-4bd6-9a0a-283904c26c46",
        chengxiaobangHome: "/Users/me/.chengxiaobang",
        cwd: "/repo/app"
      })
    ).toContain(
      "/Users/me/.chengxiaobang/session_87f0e4ec-201c-4bd6-9a0a-283904c26c46/个人财务收支表_2026年6月.xlsx"
    );
  });

  it("rejects project and session candidates that escape their roots", () => {
    expect(safeResolveWithin("/repo/project", "../secret.xlsx")).toBeUndefined();
    expect(
      previewPathCandidates("../secret.xlsx", {
        projectPath: "/repo/project",
        sessionId: "session_abc",
        chengxiaobangHome: "/home/.chengxiaobang",
        cwd: "/repo/app"
      })
    ).toEqual([]);
  });
});
