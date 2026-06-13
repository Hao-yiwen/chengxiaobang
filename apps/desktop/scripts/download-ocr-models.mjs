import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = join(scriptDir, "..", "assets", "ocr", "pp-ocrv6-small");

const sources = {
  detOnnx: {
    file: "det.onnx",
    url: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.onnx"
  },
  detYml: {
    file: "det.inference.yml",
    url: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.yml"
  },
  recOnnx: {
    file: "rec.onnx",
    url: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.onnx"
  },
  recYml: {
    file: "rec.inference.yml",
    url: "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.yml"
  }
};

await mkdir(outputDir, { recursive: true });

const manifest = {
  name: "pp-ocrv6-small",
  source: "PaddlePaddle Hugging Face ONNX repositories",
  generatedAt: new Date().toISOString(),
  files: {}
};

for (const [key, source] of Object.entries(sources)) {
  console.info(`[ocr:download] 下载 ${key} ${source.url}`);
  const buffer = await download(source.url);
  const target = join(outputDir, source.file);
  await writeFile(target, buffer);
  manifest.files[source.file] = {
    url: source.url,
    bytes: buffer.byteLength,
    sha256: sha256(buffer)
  };
  if (key === "recYml") {
    const dict = extractCharacterDictionary(buffer.toString("utf8"));
    const dictBuffer = Buffer.from(dict, "utf8");
    await writeFile(join(outputDir, "dict.txt"), dictBuffer);
    manifest.files["dict.txt"] = {
      source: source.url,
      bytes: dictBuffer.byteLength,
      sha256: sha256(dictBuffer),
      characterCount: dict.trimEnd().split("\n").length
    };
  }
}

await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.info(`[ocr:download] PP-OCRv6 small 资源已写入 ${outputDir}`);

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败 ${response.status} ${response.statusText}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function extractCharacterDictionary(yml) {
  const lines = yml.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\s*character_dict:\s*$/u.test(line));
  if (start === -1) {
    throw new Error("rec inference.yml 中没有找到 character_dict");
  }
  const chars = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s*-\s*(.*)$/u);
    if (!match) {
      if (chars.length > 0 && line.trim() && !line.startsWith(" ")) {
        break;
      }
      continue;
    }
    chars.push(unquoteYamlScalar(match[1]));
  }
  if (chars.length === 0) {
    throw new Error("rec inference.yml 中的 character_dict 为空");
  }
  return `${chars.join("\n")}\n`;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}
