import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  dts: true,
  outDir: "dist",
  noExternal: [
    "@chengxiaobang/shared",
    "zod",
    "croner",
    "sql.js",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "@modelcontextprotocol/sdk",
    "pptxgenjs",
    "docx",
    "exceljs",
    "@larksuiteoapi/node-sdk",
    "@tencent-weixin/openclaw-weixin",
    "hono",
    "adm-zip",
    "js-yaml",
    "js-tiktoken",
    "lru-cache",
    "turndown",
    "pino",
    "@pinojs/redact",
    "atomic-sleep",
    "on-exit-leak-free",
    "pino-abstract-transport",
    "pino-std-serializers",
    "process-warning",
    "quick-format-unescaped",
    "real-require",
    "safe-stable-stringify",
    "sonic-boom",
    "thread-stream"
  ],
  // Optional native peers of ws (pulled in via the lark SDK); ws degrades
  // gracefully at runtime when they're absent, but esbuild must not resolve them.
  external: ["bufferutil", "utf-8-validate"],
  // Bundled CJS deps (ws, axios, protobufjs via the lark SDK) expect CJS
  // globals that an ESM bundle lacks: require() (esbuild's shim otherwise
  // throws "Dynamic require of … is not supported") and __dirname/__filename
  // (the lark SDK reads its own package.json for a UA string; a missing
  // __dirname is a hard ReferenceError at load). Recreate all three from
  // import.meta so the bundle runs under node/bun alike.
  banner: {
    js: [
      "import { createRequire as __cxbCreateRequire } from 'node:module';",
      "import { fileURLToPath as __cxbFileURLToPath } from 'node:url';",
      "import { dirname as __cxbDirname } from 'node:path';",
      "const require = __cxbCreateRequire(import.meta.url);",
      "const __filename = __cxbFileURLToPath(import.meta.url);",
      "const __dirname = __cxbDirname(__filename);"
    ].join("\n")
  }
});
