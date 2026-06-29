import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import { isAbsolutePathLike } from "../common/file-preview";

export interface FilePreviewResolveContext {
  projectPath?: string;
  sessionId?: string;
  chengxiaobangHome?: string;
  cwd?: string;
  allowCwdFallback?: boolean;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function defaultPreviewHome(): string {
  return process.env.CHENGXIAOBANG_HOME ?? join(homedir(), ".chengxiaobang");
}

export function safeResolveWithin(basePath: string, targetPath: string): string | undefined {
  const tools = pathToolsForBase(basePath);
  const base = tools.resolve(basePath);
  const target = tools.resolve(base, targetPath);
  if (target !== base && !target.startsWith(`${base}${tools.sep}`)) {
    return undefined;
  }
  return target;
}

export function sessionWorkspacePath(
  sessionId: string | undefined,
  chengxiaobangHome = defaultPreviewHome()
): string | undefined {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    return undefined;
  }
  return joinLikeBase(chengxiaobangHome, sessionId);
}

export function previewPathCandidates(
  rawPath: string,
  context: FilePreviewResolveContext = {}
): string[] {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return [];
  }
  if (isAbsolutePathLike(trimmed)) {
    return [trimmed];
  }

  const candidates: string[] = [];
  if (context.projectPath) {
    const projectCandidate = safeResolveWithin(context.projectPath, trimmed);
    if (projectCandidate) {
      candidates.push(projectCandidate);
    }
  }

  const sessionRoot = sessionWorkspacePath(context.sessionId, context.chengxiaobangHome);
  if (sessionRoot) {
    const sessionCandidate = safeResolveWithin(sessionRoot, trimmed);
    if (sessionCandidate) {
      candidates.push(sessionCandidate);
    }
  }

  if (context.allowCwdFallback !== false) {
    const cwdCandidate = safeResolveWithin(context.cwd ?? process.cwd(), trimmed);
    if (cwdCandidate) {
      candidates.push(cwdCandidate);
    }
  }

  return [...new Set(candidates)];
}

function pathToolsForBase(basePath: string): Pick<typeof posix, "resolve" | "sep"> {
  if (/^[A-Za-z]:[\\/]/.test(basePath) || basePath.startsWith("\\")) {
    return win32;
  }
  return posix;
}

function joinLikeBase(basePath: string, childPath: string): string {
  return /^[A-Za-z]:[\\/]/.test(basePath) || basePath.startsWith("\\")
    ? win32.join(basePath, childPath)
    : posix.join(basePath, childPath);
}
