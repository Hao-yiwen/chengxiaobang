import { constants as fsConstants, type CopyOptions } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Session } from "@chengxiaobang/shared";

export const FORK_WORKSPACE_COPY_LIMIT_BYTES = 100 * 1024 * 1024;

interface SessionWorkspaceResolution {
  workspacePath: string;
  projectBound: boolean;
}

export interface ForkWorkspaceResolver {
  resolveSessionWorkspace(session: Session): Promise<SessionWorkspaceResolution>;
}

export type ForkWorkspaceCopyResult =
  | {
      status: "copied";
      method: "clone" | "copy";
      sourcePath: string;
      targetPath: string;
      scannedBytes?: number;
      scannedEntries?: number;
    }
  | {
      status: "skipped";
      reason: "project-bound" | "source-missing";
      sourcePath: string;
      targetPath: string;
    };

export interface ForkWorkspaceCopyOptions {
  copyLimitBytes?: number;
  supportsClone?: (probeRoot: string) => Promise<boolean>;
  copyDirectory?: (source: string, target: string, options: CopyOptions) => Promise<void>;
}

export class ForkWorkspaceCopyError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ForkWorkspaceCopyError";
  }
}

export async function copyForkedSessionWorkspace(input: {
  resolver: ForkWorkspaceResolver;
  sourceSession: Session;
  forkSession: Session;
  options?: ForkWorkspaceCopyOptions;
}): Promise<ForkWorkspaceCopyResult> {
  const copyLimitBytes = input.options?.copyLimitBytes ?? FORK_WORKSPACE_COPY_LIMIT_BYTES;
  const supportsClone = input.options?.supportsClone ?? supportsCloneForDirectory;
  const copyDirectory = input.options?.copyDirectory ?? cp;
  const [sourceWorkspace, forkWorkspace] = await Promise.all([
    input.resolver.resolveSessionWorkspace(input.sourceSession),
    input.resolver.resolveSessionWorkspace(input.forkSession)
  ]);
  const sourcePath = sourceWorkspace.workspacePath;
  const targetPath = forkWorkspace.workspacePath;

  if (sourceWorkspace.projectBound || forkWorkspace.projectBound) {
    return {
      status: "skipped",
      reason: "project-bound",
      sourcePath,
      targetPath
    };
  }

  const sourceStats = await lstat(sourcePath).catch((error: unknown) => {
    if (isNoEntryError(error)) {
      return undefined;
    }
    throw new ForkWorkspaceCopyError("派生工作区源目录读取失败，已取消派生", {
      sourcePath,
      targetPath,
      error: errorMessage(error)
    });
  });
  if (!sourceStats) {
    return {
      status: "skipped",
      reason: "source-missing",
      sourcePath,
      targetPath
    };
  }
  if (!sourceStats.isDirectory()) {
    throw new ForkWorkspaceCopyError("派生工作区源路径不是目录，已取消派生", {
      sourcePath,
      targetPath
    });
  }

  const targetStats = await lstat(targetPath).catch((error: unknown) => {
    if (isNoEntryError(error)) {
      return undefined;
    }
    throw new ForkWorkspaceCopyError("派生工作区目标目录读取失败，已取消派生", {
      sourcePath,
      targetPath,
      error: errorMessage(error)
    });
  });
  if (targetStats) {
    throw new ForkWorkspaceCopyError("派生工作区目标目录已存在，已取消派生", {
      sourcePath,
      targetPath
    });
  }

  await mkdir(dirname(targetPath), { recursive: true });
  const cloneSupported = await supportsClone(dirname(targetPath));
  if (cloneSupported) {
    try {
      await copyDirectory(sourcePath, targetPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
        mode: fsConstants.COPYFILE_FICLONE_FORCE
      });
    } catch (error) {
      throw new ForkWorkspaceCopyError("派生工作区快速克隆失败，已取消派生", {
        sourcePath,
        targetPath,
        error: errorMessage(error)
      });
    }
    return { status: "copied", method: "clone", sourcePath, targetPath };
  }

  const summary = await summarizeDirectory(sourcePath, copyLimitBytes).catch((error: unknown) => {
    if (error instanceof ForkWorkspaceCopyError) {
      throw error;
    }
    throw new ForkWorkspaceCopyError("派生工作区扫描失败，已取消派生", {
      sourcePath,
      targetPath,
      error: errorMessage(error)
    });
  });
  if (summary.bytes > copyLimitBytes) {
    throw new ForkWorkspaceCopyError(
      `派生工作区超过 ${formatByteLimit(copyLimitBytes)}，当前文件系统不支持快速克隆，已取消派生`,
      {
        sourcePath,
        targetPath,
        scannedBytes: summary.bytes,
        scannedEntries: summary.entries,
        copyLimitBytes
      }
    );
  }

  try {
    await copyDirectory(sourcePath, targetPath, {
      recursive: true,
      force: false,
      errorOnExist: true
    });
  } catch (error) {
    throw new ForkWorkspaceCopyError("派生工作区复制失败，已取消派生", {
      sourcePath,
      targetPath,
      error: errorMessage(error)
    });
  }
  return {
    status: "copied",
    method: "copy",
    sourcePath,
    targetPath,
    scannedBytes: summary.bytes,
    scannedEntries: summary.entries
  };
}

async function supportsCloneForDirectory(probeRoot: string): Promise<boolean> {
  let probeDir: string | undefined;
  try {
    await mkdir(probeRoot, { recursive: true });
    probeDir = await mkdtemp(join(probeRoot, ".fork-clone-probe-"));
    const source = join(probeDir, "source");
    const target = join(probeDir, "target");
    await writeFile(source, "probe");
    await copyFile(source, target, fsConstants.COPYFILE_FICLONE_FORCE);
    return true;
  } catch {
    return false;
  } finally {
    if (probeDir) {
      await rm(probeDir, { recursive: true, force: true });
    }
  }
}

async function summarizeDirectory(
  root: string,
  stopAfterBytes: number
): Promise<{ bytes: number; entries: number }> {
  let bytes = 0;
  let entries = 0;

  async function visit(directory: string): Promise<void> {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const childPath = join(directory, entry.name);
      const stats = await lstat(childPath);
      bytes += stats.size;
      entries += 1;
      if (bytes > stopAfterBytes) {
        return;
      }
      if (stats.isDirectory()) {
        await visit(childPath);
        if (bytes > stopAfterBytes) {
          return;
        }
      }
    }
  }

  await visit(root);
  return { bytes, entries };
}

function isNoEntryError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatByteLimit(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)}MB`;
  }
  if (bytes % 1024 === 0) {
    return `${bytes / 1024}KB`;
  }
  return `${bytes}B`;
}
