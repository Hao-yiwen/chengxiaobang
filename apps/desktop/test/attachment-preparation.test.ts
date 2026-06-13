import { describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@chengxiaobang/shared";
import {
  prepareAttachmentsForRun,
  saveDisplayAttachmentSnapshots
} from "../src/renderer/lib/attachment-preparation";

const timestamp = "2026-06-13T00:00:00.000Z";

const deepseek: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "test:deepseek",
  createdAt: timestamp,
  updatedAt: timestamp
};

const kimi: ProviderConfig = {
  id: "kimi",
  kind: "kimi",
  name: "Kimi",
  baseURL: "https://api.moonshot.ai/v1",
  model: "kimi-k2.6",
  apiKeyRef: "test:kimi",
  createdAt: timestamp,
  updatedAt: timestamp
};

describe("prepareAttachmentsForRun", () => {
  it("uses OCR for image attachments when the selected model is text-only", async () => {
    const ocrRecognize = vi.fn(async () => ({
      ok: true,
      path: "/tmp/photo.png",
      name: "photo.png",
      text: "图片里的文字",
      size: 100,
      pageCount: 1,
      processedPages: 1,
      warnings: [],
      elapsedMs: 12
    }));
    const prepareNativeImages = vi.fn();

    const prepared = await prepareAttachmentsForRun({
      attachments: [{ path: "/tmp/photo.png", name: "photo.png", size: 100, kind: "image" }],
      provider: deepseek,
      bridge: bridge({ ocrRecognize, prepareNativeImages }),
      formatTextBlock: (attachment, text) => `[${attachment.name}]\n${text}`
    });

    expect(ocrRecognize).toHaveBeenCalledWith("/tmp/photo.png");
    expect(prepareNativeImages).not.toHaveBeenCalled();
    expect(prepared.nativeAttachments).toEqual([]);
    expect(prepared.textContext).toContain("图片里的文字");
  });

  it("passes image attachments through for multimodal models without OCR", async () => {
    const ocrRecognize = vi.fn();
    const prepareNativeImages = vi.fn(async () => ({
      ok: true,
      path: "/tmp/photo.png",
      name: "photo.png",
      size: 100,
      images: [
        {
          name: "photo.png",
          mimeType: "image/jpeg",
          dataBase64: "abc123",
          size: 42
        }
      ],
      pageCount: 1,
      processedPages: 1,
      warnings: [],
      elapsedMs: 8
    }));

    const prepared = await prepareAttachmentsForRun({
      attachments: [{ path: "/tmp/photo.png", name: "photo.png", size: 100, kind: "image" }],
      provider: kimi,
      bridge: bridge({ ocrRecognize, prepareNativeImages })
    });

    expect(prepareNativeImages).toHaveBeenCalledWith("/tmp/photo.png");
    expect(ocrRecognize).not.toHaveBeenCalled();
    expect(prepared.textContext).toBe("");
    expect(prepared.nativeAttachments[0]).toMatchObject({
      name: "photo.png",
      mimeType: "image/jpeg",
      dataBase64: "abc123",
      size: 42
    });
  });

  it("routes PDF attachments to OCR for text models and page images for multimodal models", async () => {
    const textBridge = bridge({
      ocrRecognize: vi.fn(async () => ({
        ok: true,
        path: "/tmp/doc.pdf",
        name: "doc.pdf",
        text: "第一页文字",
        size: 512,
        pageCount: 2,
        processedPages: 2,
        warnings: ["PDF 共 12 页，本次只处理前 10 页"],
        elapsedMs: 20
      }))
    });
    const multimodalBridge = bridge({
      prepareNativeImages: vi.fn(async () => ({
        ok: true,
        path: "/tmp/doc.pdf",
        name: "doc.pdf",
        size: 512,
        images: [
          { name: "doc.pdf 第 1 页", mimeType: "image/jpeg", dataBase64: "page1", size: 10 },
          { name: "doc.pdf 第 2 页", mimeType: "image/jpeg", dataBase64: "page2", size: 10 }
        ],
        pageCount: 2,
        processedPages: 2,
        warnings: [],
        elapsedMs: 18
      }))
    });

    const textPrepared = await prepareAttachmentsForRun({
      attachments: [{ path: "/tmp/doc.pdf", name: "doc.pdf", size: 512, kind: "pdf" }],
      provider: deepseek,
      bridge: textBridge,
      formatTextBlock: (attachment, text) => `[${attachment.name}]\n${text}`
    });
    const multimodalPrepared = await prepareAttachmentsForRun({
      attachments: [{ path: "/tmp/doc.pdf", name: "doc.pdf", size: 512, kind: "pdf" }],
      provider: kimi,
      bridge: multimodalBridge
    });

    expect(textBridge.ocrRecognize).toHaveBeenCalledWith("/tmp/doc.pdf");
    expect(textPrepared.textContext).toContain("第一页文字");
    expect(textPrepared.warnings).toEqual(["PDF 共 12 页，本次只处理前 10 页"]);
    expect(multimodalBridge.prepareNativeImages).toHaveBeenCalledWith("/tmp/doc.pdf");
    expect(multimodalPrepared.nativeAttachments).toHaveLength(2);
  });

  it("saves visible attachment snapshots separately from OCR/native preparation", async () => {
    const saveAttachmentSnapshots = vi.fn(async () => ({
      ok: true,
      attachments: [
        {
          id: "attachment_snapshot_1",
          name: "photo.png",
          kind: "image",
          mimeType: "image/png",
          size: 100,
          path: "/tmp/cxb/photo.png"
        }
      ],
      totalBytes: 100,
      elapsedMs: 3
    }));

    const snapshots = await saveDisplayAttachmentSnapshots(
      [{ path: "/tmp/photo.png", name: "photo.png", size: 100, kind: "image" }],
      bridge({ saveAttachmentSnapshots })
    );

    expect(saveAttachmentSnapshots).toHaveBeenCalledWith(["/tmp/photo.png"]);
    expect(snapshots).toEqual([
      {
        id: "attachment_snapshot_1",
        name: "photo.png",
        kind: "image",
        mimeType: "image/png",
        size: 100,
        path: "/tmp/cxb/photo.png"
      }
    ]);
  });
});

function bridge(
  partial: Partial<NonNullable<Window["chengxiaobang"]>>
): NonNullable<Window["chengxiaobang"]> {
  return partial as NonNullable<Window["chengxiaobang"]>;
}
