import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = require.resolve("sql.js/dist/sql-wasm.wasm");
const target = join(process.cwd(), "dist/sql-wasm.wasm");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
