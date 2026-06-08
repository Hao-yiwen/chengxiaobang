# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

程小帮 is a macOS Electron AI assistant desktop app (an agentic coding companion). pnpm + TypeScript monorepo, ESM throughout.

## Engineering guidelines

Bias toward caution over speed. For trivial tasks, use judgment.

### Tests are required
- Every behavioral change ships with unit tests. Frame the task as "write the test that proves it, then make it pass." For a bug, first write a failing test that reproduces it, then fix.
- Tests live in each package's `test/` dir and run via Vitest. Keep `pnpm test` green before calling work done; run one file with `pnpm test <path>`, filter by name with `pnpm test -t "<name>"`.
- Match existing patterns: backend logic is tested directly against its modules; the renderer uses `@testing-library/react` + jsdom with a mocked `ApiClient` (see `apps/desktop/test/app.test.tsx`). Extract pure functions so they're testable without a running app.
- Never weaken or delete a test just to go green. If a test blocks you, understand why first.

### Modular by default
- Respect the three-layer boundary (see Architecture): contracts/types live only in `packages/shared`; backend logic sits behind interfaces (`StateStore`, `ModelClient`, `SecretStore`); the renderer splits into `store/` (state), `components/` (view), `lib/` (IO). Don't reach across layers or re-declare the shared contract.
- One concern per module; keep functions small and single-purpose. Prefer a new file over growing one past its theme. Keep side effects (IO, IPC, network, model calls) at the edges and logic pure in the middle so it can be unit-tested.
- Reuse existing helpers before writing new ones.

### Think before coding
- State assumptions explicitly. If multiple interpretations exist, surface them instead of silently picking one. If something is unclear, ask.
- Prefer the simplest solution that solves the actual request — no speculative features, no abstractions for single-use code, no configurability nobody asked for. If 200 lines could be 50, rewrite.

### Surgical changes
- Every changed line should trace directly to the request. Don't refactor, reformat, or "improve" adjacent code that isn't broken; match the surrounding style.
- Remove only the imports/variables/functions your own change orphaned. Flag unrelated dead code rather than deleting it.

## Commands

Run from the repo root unless noted.

- `pnpm dev` — one-command dev: starts Vite (renderer HMR), `tsup --watch` (main/preload), and Electron. Electron spawns the backend itself via `bun --watch`, so **all three layers hot-reload on save** (renderer = HMR, backend = bun restart on same port, main/preload = recompile + Electron auto-restart). Closing the window or Ctrl+C tears everything down. See `apps/desktop/scripts/dev.mjs`.
- `pnpm build` — builds in order: shared → backend → desktop. Required before packaging because desktop bundles the backend's `dist/` as an extra resource.
- `pnpm package:mac` — `pnpm build` then `electron-builder --mac` (dmg + zip).
- `pnpm typecheck` — builds shared first (other packages import its types), then `tsc --noEmit` across the workspace.
- `pnpm test` — Vitest (config: `vitest.config.ts`). Run a single file: `pnpm test apps/backend/test/agent-runner.test.ts`. Filter by name: `pnpm test -t "approval"`. Tests live in `test/` dirs per package; `@chengxiaobang/*` import aliases are resolved by the Vitest config.

Backend can also run standalone: `pnpm --filter @chengxiaobang/backend dev` → `tsx src/main.ts --port <n> --data-dir <dir> --token <t>`.

## Architecture

Three layers, with `@chengxiaobang/shared` as the contract between them.

**`packages/shared`** — single source of truth for the API/IPC contract. All entities (Provider, Project, Session, Message, ToolCall, RunRequest) are Zod schemas with inferred types; the backend `.parse()`s requests with them and the renderer imports the same types. Also owns the `StreamEvent` union and the SSE codec (`encodeSseEvent`/`parseSseChunk`). Change a contract here and both sides must follow. It must be **built** before backend/desktop typecheck (its `dist/` types are consumed across packages).

**`apps/backend`** — headless local HTTP server, **not** an Electron-aware process. It's a plain `fetch`-style handler (`api/app.ts`) served by either Bun's `Bun.serve` or Node's `http` server, transparently — see `server.ts`. Runtime selection: launched with **Bun** when available (the bundled `bun.exe` in production, `node_modules/.bin/bun` in dev), else falls back to `tsx`/`node`. The agent loop (`agent/agent-runner.ts`) is an async generator that yields `StreamEvent`s streamed to the client as SSE over `POST /api/runs/stream`. State persists to SQLite via `sql.js` (`repository/sqlite-state-store.ts`, behind the `StateStore` interface). Secrets use the macOS Keychain (`security` CLI) on darwin, in-memory elsewhere (`secrets/secret-store.ts`). Model calls go through an OpenAI-compatible streaming client (`model/openai-compatible.ts`); built-in providers are DeepSeek and Kimi (`defaultProviders` in shared).

**`apps/desktop`** — Electron app. The **main process spawns and supervises the backend** (`main/backend-process.ts`): it picks a random port + random token, waits on `/api/health`, and exposes `{baseURL, token}` to the renderer over the `backend-info` IPC channel. Each app launch = a fresh backend on a new port. The renderer (React + Vite + Tailwind) is sandboxed; `preload/index.ts` exposes a minimal `window.chengxiaobang` bridge (backend info, native file/dir pickers, file read). `renderer/lib/api.ts` builds a typed `ApiClient` from the bridged baseURL/token and consumes the SSE stream. The main process loads the renderer from `VITE_DEV_SERVER_URL` in dev, or `dist/renderer/index.html` when packaged.

### Agent run flow (the core loop)
`POST /api/runs/stream` → `AgentRunner.stream()`:
1. Resolve/create the session, persist the user message, emit `run_started`.
2. **Slash-command tools**: prompts beginning with `/ls`, `/read`, `/write`, `/shell`, `/git status`, `/git diff` are parsed by `tools/tool-executor.ts` into a `ToolCall`. Mutating tools (`write_file`, `edit_file`, `shell`) require approval when the session's `accessMode` is `approval` — the run blocks on `ApprovalQueue.wait()` until the client calls `POST /api/approvals/:toolCallId`. Tools run relative to the session's project path.
3. Stream the model completion, emitting `thinking_delta`/`assistant_delta`, persist the assistant message, emit `assistant_done`.
4. `POST /api/runs/:runId/abort` cancels via an `AbortController` keyed by runId.

Every step is a `StreamEvent` (see the union in shared); the renderer drives its UI entirely off these events.

## Conventions & gotchas

- **ESM only.** When configuring `tsup`/bundlers, mark `electron` as `--external` — bundling it produces a `Dynamic require of "fs" is not supported` crash at Electron startup.
- The backend `main.js` is bundled into the desktop app under `extraResources/backend`; `pi-ai`, `pi-agent-core`, and `sql.js` are force-bundled (`noExternal` in `apps/backend/tsup.config.ts`).
- `bun`, `electron`, `esbuild`, `sharp`, `@google/genai`, `protobufjs` are in `onlyBuiltDependencies` / `allowBuilds` — native/postinstall builds are gated.
- `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` (`model/pi-runtime.ts`) are loaded but not yet wired into the agent loop.
- UI strings and many error messages are in Chinese; keep that consistent.
