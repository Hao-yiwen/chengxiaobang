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
  it("passes image attachments as paths for text-only models without eager OCR", async () => {
    const ocrRecognize = vi.fn();
    const prepareNativeImages = vi.fn();

    const prepared = await prepareAttachmentsForRun({
      attachments: [{ path: "/tmp/photo.png", name: "photo.png", size: 100, kind: "image" }],
      provider: deepseek,
      bridge: bridge({ ocrRecognize, prepareNativeImages })
    });

    expect(ocrRecognize).not.toHaveBeenCalled();
    expect(prepareNativeImages).not.toHaveBeenCalled();
    expect(prepared.nativeAttachments).toEqual([]);
    expect(prepared.textContext).toContain("附件清单");
    expect(prepared.textContext).toContain("/tmp/photo.png");
    expect(prepared.textContext).toContain("OCR 工具");
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
    expect(prepared.textContext).toContain("/tmp/photo.png");
    expect(prepared.nativeAttachments[0]).toMatchObject({
      name: "photo.png",
      mimeType: "image/jpeg",
      dataBase64: "abc123",
      size: 42
    });
  });

  it("keeps PDF attachments as paths for all models without eager OCR or page rendering", async () => {
    const textBridge = bridge({
      ocrRecognize: vi.fn(),
      prepareNativeImages: vi.fn()
    });
    const multimodalBridge = bridge({
      ocrRecognize: vi.fn(),
      prepareNativeImages: vi.fn()
    });

    const textPrepared = await prepareAttachmentsForRun({
      attachments: [{ path: "/tmp/doc.pdf", name: "doc.pdf", size: 512, kind: "pdf" }],
      provider: deepseek,
      bridge: textBridge
    });
    const multimodalPrepared = await prepareAttachmentsForRun({
      attachments: [{ path: "/tmp/doc.pdf", name: "doc.pdf", size: 512, kind: "pdf" }],
      provider: kimi,
      bridge: multimodalBridge
    });

    expect(textBridge.ocrRecognize).not.toHaveBeenCalled();
    expect(textBridge.prepareNativeImages).not.toHaveBeenCalled();
    expect(textPrepared.textContext).toContain("/tmp/doc.pdf");
    expect(textPrepared.textContext).toContain("OCR 工具");
    expect(textPrepared.nativeAttachments).toEqual([]);
    expect(textPrepared.warnings).toEqual([]);
    expect(multimodalBridge.ocrRecognize).not.toHaveBeenCalled();
    expect(multimodalBridge.prepareNativeImages).not.toHaveBeenCalled();
    expect(multimodalPrepared.textContext).toContain("/tmp/doc.pdf");
    expect(multimodalPrepared.nativeAttachments).toEqual([]);
  });

  it("keeps video attachments as paths even when the catalog advertises video input", async () => {
    const prepareNativeImages = vi.fn();

    const prepared = await prepareAttachmentsForRun({
      attachments: [{ path: "/tmp/clip.mp4", name: "clip.mp4", size: 1024, kind: "video" }],
      provider: kimi,
      bridge: bridge({ prepareNativeImages })
    });

    expect(prepareNativeImages).not.toHaveBeenCalled();
    expect(prepared.nativeAttachments).toEqual([]);
    expect(prepared.textContext).toContain("/tmp/clip.mp4");
    expect(prepared.textContext).toContain("当前不会作为原生视频输入发送给模型");
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
