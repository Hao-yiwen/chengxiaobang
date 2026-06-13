import type { MessageAttachment, ProviderConfig, RunImageAttachment } from "@chengxiaobang/shared";
import { previewKindForPath } from "../../../common/file-preview";
import {
  prepareAttachmentsForRun,
  type AttachmentDescriptor
} from "../../lib/attachment-preparation";
import i18n from "../../i18n";
import type { Attachment } from "../types";

export type AddContextSource = "file_picker" | "file_drop";

export interface ResolveContextAttachmentsOptions {
  paths: string[];
  source: AddContextSource;
  bridge: NonNullable<Window["chengxiaobang"]>;
  existingPaths: Set<string>;
  projectPath?: string;
  sessionId?: string;
}

export interface ResolveContextAttachmentsResult {
  attachments: Attachment[];
  added: number;
  skipped: number;
  failed: number;
  notices: string[];
}

export async function resolveContextAttachments(
  options: ResolveContextAttachmentsOptions
): Promise<ResolveContextAttachmentsResult> {
  const seenPaths = new Set(options.existingPaths);
  const attachments: Attachment[] = [];
  const notices: string[] = [];
  let skipped = 0;
  let failed = 0;

  console.info("[store] 开始解析上下文附件", {
    source: options.source,
    pathCount: options.paths.length,
    projectPath: options.projectPath,
    sessionId: options.sessionId
  });

  for (const path of options.paths) {
    if (!path) {
      skipped += 1;
      notices.push(i18n.t("notice.dropFilePathUnavailable"));
      console.warn("[store] 跳过无本地路径的拖拽附件", { source: options.source });
      continue;
    }
    if (seenPaths.has(path)) {
      skipped += 1;
      console.info("[store] 跳过重复附件", { source: options.source, path });
      continue;
    }
    seenPaths.add(path);

    const fallbackName = path.split(/[\\/]/u).pop() ?? path;
    try {
      const previewInfo = await options.bridge.getFilePreviewInfo?.(path, {
        projectPath: options.projectPath,
        sessionId: options.sessionId
      });
      if (previewInfo?.ok) {
        if (options.source === "file_drop" && previewInfo.kind === "unsupported") {
          failed += 1;
          const notice = i18n.t("notice.skipDroppedUnsupported", { name: previewInfo.name });
          notices.push(notice);
          console.warn("[store] 拖拽附件类型不可作为上下文，已跳过", {
            source: options.source,
            path: previewInfo.path,
            kind: previewInfo.kind,
            size: previewInfo.size
          });
          continue;
        }
        console.info("[store] 已添加附件元信息", {
          source: options.source,
          path: previewInfo.path,
          kind: previewInfo.kind,
          size: previewInfo.size
        });
        attachments.push({
          path: previewInfo.path,
          name: previewInfo.name,
          size: previewInfo.size,
          kind: previewInfo.kind
        });
        continue;
      }
      if (previewInfo && !previewInfo.ok) {
        console.warn("[store] 附件预览信息读取失败，尝试旧文本读取", {
          source: options.source,
          path,
          error: previewInfo.error
        });
      }

      const result = await options.bridge.readFileText?.(path);
      if (result?.ok) {
        console.info("[store] 已按旧文本读取添加附件", {
          source: options.source,
          path,
          size: result.size
        });
        attachments.push({
          path,
          name: result.name,
          size: result.size,
          kind: previewKindForPath(path),
          text: result.text
        });
      } else if (result) {
        failed += 1;
        const notice = i18n.t("notice.skipFile", { name: result.name, error: result.error });
        notices.push(notice);
        console.warn("[store] 附件读取失败，已跳过", {
          source: options.source,
          path,
          error: result.error
        });
      } else {
        failed += 1;
        const notice = i18n.t("notice.skipFile", {
          name: fallbackName,
          error: i18n.t("notice.fileReadUnavailable")
        });
        notices.push(notice);
        console.warn("[store] 附件读取能力不可用，已跳过", {
          source: options.source,
          path
        });
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      notices.push(i18n.t("notice.skipFile", { name: fallbackName, error: message }));
      console.warn("[store] 附件解析异常，已跳过", {
        source: options.source,
        path,
        error: message
      });
    }
  }

  console.info("[store] 上下文附件解析完成", {
    source: options.source,
    pathCount: options.paths.length,
    added: attachments.length,
    skipped,
    failed
  });

  return {
    attachments,
    added: attachments.length,
    skipped,
    failed,
    notices
  };
}

export function messageAttachmentsToDescriptors(attachments: MessageAttachment[]): AttachmentDescriptor[] {
  return attachments.map((attachment) => ({
    path: attachment.path,
    name: attachment.name,
    size: attachment.size,
    kind: previewKindForPath(attachment.path)
  }));
}

export async function prepareRunInputFromVisibleMessage(options: {
  content: string;
  attachments: AttachmentDescriptor[];
  provider: ProviderConfig;
  model?: string;
  bridge?: Window["chengxiaobang"];
}): Promise<{
  prompt: string;
  nativeAttachments: RunImageAttachment[];
  warnings: string[];
  inputModalities: string[];
}> {
  const preparedAttachments = await prepareAttachmentsForRun({
    attachments: options.attachments,
    provider: options.provider,
    model: options.model,
    bridge: options.bridge,
    formatTextBlock: (attachment, text) =>
      i18n.t("notice.attachmentBlock", {
        name: attachment.name,
        text
      })
  });
  const prompt =
    `${preparedAttachments.textContext}${options.content}`.trim().length > 0
      ? `${preparedAttachments.textContext}${options.content}`
      : preparedAttachments.nativeAttachments.length > 0
        ? "请分析这些图片。"
        : "";
  return {
    prompt,
    nativeAttachments: preparedAttachments.nativeAttachments,
    warnings: preparedAttachments.warnings,
    inputModalities: preparedAttachments.inputModalities
  };
}
