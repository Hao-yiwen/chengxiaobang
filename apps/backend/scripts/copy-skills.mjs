import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Copy the bundled builtin skills/ folder next to the compiled main.js so the
// packaged backend can discover them at runtime.
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const source = join(packageRoot, "skills");
const target = join(packageRoot, "dist", "skills");

if (existsSync(source)) {
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  console.log(`[chengxiaobang] copied builtin skills -> ${target}`);
}
