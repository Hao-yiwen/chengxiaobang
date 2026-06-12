// One-command dev launcher for the 程小帮 desktop app.
//
// Starts everything needed for live development and wires them together so that
// edits take effect immediately:
//   - Vite dev server  -> renderer/前端 HMR (instant)
//   - tsup --watch      -> rebuilds main + preload on change
//   - Electron          -> auto-restarts when main/preload are rebuilt
//   - backend           -> spawned by Electron via `bun --watch` (see
//                          backend-process.ts), so 后端 edits auto-restart too.
import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { cleanupStaleDevBackends } from "./dev-process-cleanup.mjs";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopDir, "../..");
const bin = (name) => resolve(repoRoot, "node_modules/.bin", name);

const VITE_HOST = "127.0.0.1";
const VITE_PORT = 5173;
const VITE_URL = `http://${VITE_HOST}:${VITE_PORT}`;
const distDir = resolve(desktopDir, "dist");
const mainEntry = resolve(distDir, "main/main.js");
const devEnv = {
  ...process.env,
  CHENGXIAOBANG_LOG_LEVEL: process.env.CHENGXIAOBANG_LOG_LEVEL ?? "debug"
};

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let electron = null;
let shuttingDown = false;

function run(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: desktopDir,
    stdio: "inherit",
    ...opts
  });
  children.push(child);
  child.on("exit", (code) => {
    if (!shuttingDown && child !== electron) {
      console.error(`\n[dev] ${command} exited (code ${code}); shutting down.`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function waitFor(predicate, { timeout, label }) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const electronBin = resolve(desktopDir, "node_modules/.bin/electron");

function startElectron() {
  electron = run(electronBin, ["."], {
    env: { ...devEnv, VITE_DEV_SERVER_URL: VITE_URL }
  });
  electron.on("exit", (code) => {
    if (!shuttingDown) shutdown(code ?? 0); // closing the window ends dev
  });
}

function restartElectron() {
  if (!electron || electron.exitCode !== null) return;
  console.log("\n[dev] main/preload changed -> restarting Electron");
  const old = electron;
  electron = null;
  old.removeAllListeners("exit");
  old.once("exit", () => startElectron());
  old.kill("SIGTERM");
}

async function main() {
  await cleanupStaleDevBackends({ repoRoot });

  // 1) Rebuild main + preload on change.
  run(bin("tsup"), ["--config", "tsup.config.ts", "--watch"], { env: devEnv });

  // 2) Vite dev server (renderer HMR).
  run(bin("vite"), ["--host", VITE_HOST, "--port", String(VITE_PORT), "--strictPort"], {
    env: devEnv
  });

  // 3) Wait for the first main build and for Vite to answer.
  await waitFor(() => existsSync(mainEntry), { timeout: 30_000, label: "main build" });
  await waitFor(
    () => fetch(VITE_URL).then((r) => r.ok).catch(() => false),
    { timeout: 30_000, label: "Vite dev server" }
  );

  // 4) Launch Electron; restart it whenever main/preload are rebuilt.
  startElectron();
  let debounce;
  watch(distDir, { recursive: true }, (_event, file) => {
    if (!file || (!file.startsWith("main") && !file.startsWith("preload"))) return;
    clearTimeout(debounce);
    debounce = setTimeout(restartElectron, 400);
  });
}

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
