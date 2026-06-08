import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

export interface BackendInfo {
  baseURL: string;
  token: string;
}

export interface BackendProcess {
  info: BackendInfo;
  child: ChildProcess;
  stop(): void;
}

export interface BackendCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function resolveBackendCommand(options: {
  port: number;
  dataDir: string;
  token: string;
  resourcesPath: string;
  isPackaged: boolean;
}): BackendCommand {
  const backendEntry = options.isPackaged
    ? join(options.resourcesPath, "backend", "main.js")
    : resolve(projectRoot(), "apps/backend/src/main.ts");
  const commonArgs = [
    backendEntry,
    "--port",
    String(options.port),
    "--data-dir",
    options.dataDir,
    "--token",
    options.token
  ];
  const env = { ...process.env };
  const bunBinary =
    process.env.BUN_BINARY ??
    firstExisting([
      join(options.resourcesPath, "bun"),
      resolve(projectRoot(), "node_modules/.bin/bun")
    ]);

  // In dev (not packaged) restart the backend automatically when its source
  // changes so backend edits take effect without relaunching the app.
  const dev = !options.isPackaged;

  if (bunBinary) {
    const args = dev ? ["--watch", ...commonArgs] : commonArgs;
    return { command: bunBinary, args, env };
  }
  if (options.isPackaged) {
    return { command: "bun", args: commonArgs, env };
  }
  return {
    command: resolve(projectRoot(), "node_modules/.bin/tsx"),
    args: ["watch", ...commonArgs],
    env
  };
}

export async function startBackendProcess(options: {
  dataDir: string;
  resourcesPath: string;
  isPackaged: boolean;
}): Promise<BackendProcess> {
  const port = 30_000 + Math.floor(Math.random() * 20_000);
  const token = randomBytes(24).toString("hex");
  const command = resolveBackendCommand({
    port,
    dataDir: options.dataDir,
    token,
    resourcesPath: options.resourcesPath,
    isPackaged: options.isPackaged
  });
  const child = spawn(command.command, command.args, {
    env: command.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stderr.on("data", (chunk) => {
    console.warn(`[chengxiaobang-backend] ${String(chunk).trim()}`);
  });

  await waitForBackend(child, port, token);
  return {
    info: { baseURL: `http://127.0.0.1:${port}`, token },
    child,
    stop: () => child.kill("SIGTERM")
  };
}

async function waitForBackend(
  child: ChildProcess,
  port: number,
  token: string
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`后端启动失败，退出码 ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { "x-chengxiaobang-token": token }
      });
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
    }
  }
  child.kill("SIGTERM");
  await once(child, "exit").catch(() => undefined);
  throw new Error("后端启动超时");
}

function projectRoot(): string {
  // Walk up from this file (works both from src/main in dev and dist/main when
  // bundled) until we find the workspace root marker.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}
