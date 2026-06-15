import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolveToolPath } from "./workspace";
import { textResult } from "./tool-result";

export interface OcrToolRuntime {
  serviceUrl: string;
  token: string;
}

type OcrServiceResult =
  | {
      ok: true;
      path: string;
      name: string;
      text: string;
      size: number;
      pageCount: number;
      processedPages: number;
      warnings: string[];
      elapsedMs: number;
    }
  | { ok: false; path: string; name: string; error: string; size: number };

const ocrParams = Type.Object({
  path: Type.String({
    description: "图片或 PDF 的本地路径；可以使用附件清单中的绝对路径"
  })
});

export function createOcrTools(
  workspacePath: string,
  runtime: OcrToolRuntime
): AgentTool<any>[] {
  const ocrExtractText: AgentTool<typeof ocrParams> = {
    name: "OcrExtractText",
    label: "OCR 提取文字",
    description:
      "从图片或 PDF 中提取可见文字。只读工具，不会压缩、修改或转换文件；不支持视频。需要处理附件时优先使用附件清单里的本地路径。",
    parameters: ocrParams,
    execute: async (_id, params) => {
      const target = resolveToolPath(workspacePath, params.path).target;
      const startedAt = Date.now();
      console.info("[ocr-tool] 请求 OCR 服务", {
        requestedPath: params.path,
        target,
        serviceUrl: runtime.serviceUrl
      });
      const result = await requestOcr(runtime, target);
      if (!result.ok) {
        console.warn("[ocr-tool] OCR 服务返回失败", {
          path: target,
          error: result.error,
          elapsedMs: Date.now() - startedAt
        });
        throw new Error(result.error);
      }
      console.info("[ocr-tool] OCR 服务返回成功", {
        path: target,
        pageCount: result.pageCount,
        processedPages: result.processedPages,
        textChars: result.text.length,
        warningCount: result.warnings.length,
        elapsedMs: Date.now() - startedAt
      });
      return textResult(formatOcrResult(result));
    }
  };

  return [ocrExtractText];
}

async function requestOcr(runtime: OcrToolRuntime, path: string): Promise<OcrServiceResult> {
  const response = await fetch(`${runtime.serviceUrl}/ocr/recognize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chengxiaobang-ocr-token": runtime.token
    },
    body: JSON.stringify({ path })
  });
  const payload = (await response.json().catch(() => undefined)) as OcrServiceResult | undefined;
  if (!payload) {
    throw new Error(`OCR 服务返回了不可解析响应，HTTP ${response.status}`);
  }
  if (!response.ok && payload.ok) {
    throw new Error(`OCR 服务状态异常，HTTP ${response.status}`);
  }
  return payload;
}

function formatOcrResult(result: Extract<OcrServiceResult, { ok: true }>): string {
  const header = [
    `文件：${result.name}`,
    `路径：${result.path}`,
    `大小：${formatBytes(result.size)}`,
    `页数：${result.pageCount}`,
    `已处理页数：${result.processedPages}`,
    `耗时：${result.elapsedMs}ms`
  ].join("\n");
  const warnings = result.warnings.length > 0 ? `\n\n警告：\n${result.warnings.join("\n")}` : "";
  const text = result.text.trim() || "（OCR 没有识别到可用文字）";
  return `${header}${warnings}\n\nOCR 文本：\n${text}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
