import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectApprovalTrustService } from "../src/agent/project-approval-trust";
import { SqliteStateStore } from "../src/repository/sqlite-state-store";

describe("ProjectApprovalTrustService", () => {
  let dir: string;
  let store: SqliteStateStore;
  let service: ProjectApprovalTrustService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-approval-trust-"));
    store = new SqliteStateStore(join(dir, "state.sqlite"));
    await store.initialize();
    service = new ProjectApprovalTrustService(store);
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("命中同项目、同工具、同规范化参数", async () => {
    await service.trust({
      projectId: "project_1",
      toolName: "Bash",
      args: { command: "git   status   --short" }
    });

    await expect(
      service.isTrusted({
        projectId: "project_1",
        toolName: "Bash",
        args: { command: "git status --short" }
      })
    ).resolves.toBe(true);
  });

  it("不同项目或参数变化不会命中", async () => {
    await service.trust({
      projectId: "project_1",
      toolName: "Bash",
      args: { command: "npm publish" }
    });

    await expect(
      service.isTrusted({
        projectId: "project_2",
        toolName: "Bash",
        args: { command: "npm publish" }
      })
    ).resolves.toBe(false);
    await expect(
      service.isTrusted({
        projectId: "project_1",
        toolName: "Bash",
        args: { command: "npm publish --tag beta" }
      })
    ).resolves.toBe(false);
  });

  it("settings 只保存 hash，不保存命令或文件内容明文", async () => {
    await service.trust({
      projectId: "project_1",
      toolName: "Write",
      args: { file_path: "secret.txt", content: "do-not-store-this" }
    });

    const raw = await service.rawSettingsForTest();
    expect(raw).toBeDefined();
    expect(raw).not.toContain("do-not-store-this");
    expect(raw).not.toContain("secret.txt");
  });
});
