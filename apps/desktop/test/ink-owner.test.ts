import { describe, expect, it } from "vitest";
import { resolveInkOwner } from "../src/renderer/lib/ink-owner";

describe("resolveInkOwner（UI-SPEC §2.3 墨点唯一性）", () => {
  it("流式正文非空时归 stream，且压过思考", () => {
    expect(resolveInkOwner({ streamText: "正在", thinkingActive: true })).toBe("stream");
    expect(resolveInkOwner({ streamText: "x" })).toBe("stream");
  });

  it("仅思考活跃时归 thinking", () => {
    expect(resolveInkOwner({ streamText: "", thinkingActive: true })).toBe("thinking");
    expect(resolveInkOwner({ streamText: null, thinkingActive: true })).toBe("thinking");
  });

  it("全部空闲时归 null", () => {
    expect(resolveInkOwner({ streamText: "" })).toBeNull();
    expect(resolveInkOwner({ streamText: undefined })).toBeNull();
    expect(resolveInkOwner({ streamText: null, thinkingActive: false })).toBeNull();
  });
});
