import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveSqlWasmPath(): string {
  const localDistWasm = join(dirname(fileURLToPath(import.meta.url)), "sql-wasm.wasm");
  if (existsSync(localDistWasm)) {
    return localDistWasm;
  }
  return createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm");
}
