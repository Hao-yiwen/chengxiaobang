import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@chengxiaobang/shared";
import {
  copyForkedSessionWorkspace,
  type ForkWorkspaceResolver
} from "../src/api/session-workspace-copy";

describe("copyForkedSessionWorkspace", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cxb-fork-workspace-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects an oversized ordinary copy when clone is unavailable", async () => {
    const sourcePath = join(dir, "source");
    const targetPath = join(dir, "target");
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, "large.txt"), "too large");

    await expect(
      copyForkedSessionWorkspace({
        resolver: resolverFor(sourcePath, targetPath),
        sourceSession: session("source"),
        forkSession: session("target"),
        options: {
          copyLimitBytes: 1,
          supportsClone: async () => false
        }
      })
    ).rejects.toMatchObject({
      message: "派生工作区超过 1B，当前文件系统不支持快速克隆，已取消派生"
    });
    await expect(lstat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses forced clone without applying the ordinary copy limit", async () => {
    const sourcePath = join(dir, "source");
    const targetPath = join(dir, "target");
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, "large.txt"), "too large");
    const copyDirectory = vi.fn(async () => {});

    await expect(
      copyForkedSessionWorkspace({
        resolver: resolverFor(sourcePath, targetPath),
        sourceSession: session("source"),
        forkSession: session("target"),
        options: {
          copyLimitBytes: 1,
          supportsClone: async () => true,
          copyDirectory
        }
      })
    ).resolves.toMatchObject({
      status: "copied",
      method: "clone",
      sourcePath,
      targetPath
    });
    expect(copyDirectory).toHaveBeenCalledWith(
      sourcePath,
      targetPath,
      expect.objectContaining({ mode: fsConstants.COPYFILE_FICLONE_FORCE })
    );
  });
});

function resolverFor(sourcePath: string, targetPath: string): ForkWorkspaceResolver {
  return {
    async resolveSessionWorkspace(session) {
      return {
        workspacePath: session.id === "source" ? sourcePath : targetPath,
        projectBound: false
      };
    }
  };
}

function session(id: string): Session {
  return {
    id,
    projectId: null,
    title: id,
    accessMode: "approval",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
