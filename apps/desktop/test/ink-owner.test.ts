import { describe, expect, it } from "vitest";
import { resolveInkOwner } from "../src/renderer/lib/ink-owner";

describe("resolveInkOwner（UI-SPEC §2.3 墨点唯一性）", () => {
  it("流式正文非空时归 stream，且压过计划与思考", () => {
    expect(
      resolveInkOwner({ streamText: "正在", planStatus: "executing", thinkingActive: true })
    ).toBe("stream");
    expect(resolveInkOwner({ streamText: "x" })).toBe("stream");
  });

  it("无流式正文时，执行中的计划压过思考行", () => {
    expect(
      resolveInkOwner({ streamText: "", planStatus: "executing", thinkingActive: true })
    ).toBe("plan");
  });

  it("非 executing 的计划状态不参与竞争", () => {
    for (const status of ["draft", "awaiting", "completed", "rejected"]) {
      expect(
        resolveInkOwner({ streamText: "", planStatus: status, thinkingActive: true })
      ).toBe("thinking");
    }
  });

  it("仅思考活跃时归 thinking", () => {
    expect(resolveInkOwner({ streamText: "", thinkingActive: true })).toBe("thinking");
    expect(resolveInkOwner({ streamText: null, planStatus: null, thinkingActive: true })).toBe(
      "thinking"
    );
  });

  it("全部空闲时归 null", () => {
    expect(resolveInkOwner({ streamText: "" })).toBeNull();
    expect(resolveInkOwner({ streamText: undefined, planStatus: undefined })).toBeNull();
    expect(
      resolveInkOwner({ streamText: null, planStatus: "completed", thinkingActive: false })
    ).toBeNull();
  });
});
