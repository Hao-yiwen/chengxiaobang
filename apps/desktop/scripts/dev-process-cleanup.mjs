import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseProcessList(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4]
    }));
}

export function isDevBackendProcess(processInfo, { repoRoot, currentPid = process.pid }) {
  if (processInfo.pid === currentPid) return false;

  const command = normalizeCommand(processInfo.command);
  const executable = firstCommandToken(command);
  const backendEntry = `${normalizeCommand(repoRoot).replace(/\/+$/, "")}/apps/backend/src/main.ts`;
  return (
    command.includes(backendEntry) &&
    command.includes("--watch") &&
    isBunExecutable(executable)
  );
}

export function parseWindowsProcessList(output) {
  const parsed = JSON.parse(output || "[]");
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
      pgid: 0,
      command: typeof row.CommandLine === "string" ? row.CommandLine : ""
    }))
    .filter((row) => Number.isFinite(row.pid) && row.pid > 0 && row.command.length > 0);
}

export function collectDevBackendCleanupTargets(processes, options) {
  const matchedProcesses = processes.filter((processInfo) => isDevBackendProcess(processInfo, options));
  const processGroups = new Set();
  const pids = new Set();

  for (const processInfo of matchedProcesses) {
    if (processInfo.pgid > 1 && processInfo.pgid === processInfo.pid) {
      processGroups.add(processInfo.pgid);
    } else if (processInfo.pid > 1) {
      pids.add(processInfo.pid);
    }
  }

  return {
    matchedProcesses,
    processGroups: [...processGroups],
    pids: [...pids]
  };
}

export async function cleanupStaleDevBackends({
  repoRoot,
  logger = console,
  waitMs = 800,
  execFileImpl = execFileAsync,
  killImpl = process.kill
}) {
  if (process.platform === "win32") {
    return cleanupStaleWindowsDevBackends({ repoRoot, logger, execFileImpl });
  }

  let stdout;
  try {
    ({ stdout } = await execFileImpl("ps", ["-axo", "pid=,ppid=,pgid=,command="]));
  } catch (error) {
    logger.warn(`[dev] 检查旧后端进程失败，继续启动：${error.message}`);
    return { matchedProcesses: [], processGroups: [], pids: [] };
  }

  const targets = collectDevBackendCleanupTargets(parseProcessList(stdout), { repoRoot });
  if (targets.matchedProcesses.length === 0) {
    logger.log("[dev] 未发现需要清理的旧后端进程。");
    return targets;
  }

  const summary = targets.matchedProcesses
    .map((processInfo) => `${processInfo.pid}:${processInfo.command}`)
    .join("; ");
  logger.warn(`[dev] 启动前清理旧后端进程：${summary}`);
  signalTargets(targets, "SIGTERM", killImpl, logger);
  await delay(waitMs);
  signalTargets(targets, "SIGKILL", killImpl, logger);
  return targets;
}

async function cleanupStaleWindowsDevBackends({ repoRoot, logger, execFileImpl }) {
  let stdout;
  try {
    ({ stdout } = await execFileImpl("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"
    ]));
  } catch (error) {
    logger.warn(`[dev] 检查 Windows 旧后端进程失败，继续启动：${error.message}`);
    return { matchedProcesses: [], processGroups: [], pids: [] };
  }

  const targets = collectDevBackendCleanupTargets(parseWindowsProcessList(stdout), { repoRoot });
  if (targets.matchedProcesses.length === 0) {
    logger.log("[dev] 未发现需要清理的旧后端进程。");
    return targets;
  }

  const summary = targets.matchedProcesses
    .map((processInfo) => `${processInfo.pid}:${processInfo.command}`)
    .join("; ");
  logger.warn(`[dev] 启动前清理 Windows 旧后端进程：${summary}`);
  for (const pid of targets.pids) {
    try {
      await execFileImpl("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } catch (error) {
      logger.warn(`[dev] taskkill 失败 pid=${pid} error=${error.message}`);
    }
  }
  return targets;
}

function signalTargets(targets, signal, killImpl, logger) {
  for (const pgid of targets.processGroups) {
    signalOne(-pgid, signal, killImpl, logger);
  }
  for (const pid of targets.pids) {
    signalOne(pid, signal, killImpl, logger);
  }
}

function signalOne(pid, signal, killImpl, logger) {
  try {
    killImpl(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      logger.warn(`[dev] 发送 ${signal} 失败 pid=${pid} error=${error.message}`);
    }
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function normalizeCommand(value) {
  return value.replaceAll("\\", "/");
}

function firstCommandToken(command) {
  const trimmed = command.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end >= 0 ? trimmed.slice(1, end) : trimmed.slice(1);
  }
  return trimmed.split(/\s+/, 1)[0] ?? "";
}

function isBunExecutable(executable) {
  return /(^|\/)bun(?:\.exe)?$/.test(executable) || /(^|\/)bun-dev-[^/]+$/.test(executable);
}
