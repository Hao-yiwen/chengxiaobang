import { describe, expect, it } from "vitest";

import { normalizeErrorMessage } from "../src/index";

describe("normalizeErrorMessage", () => {
  it("提取 Error 的 message", () => {
    expect(normalizeErrorMessage(new Error("检查更新失败"))).toBe("检查更新失败");
  });

  it("兼容字符串与带 message 字段的对象", () => {
    expect(normalizeErrorMessage("纯字符串错误")).toBe("纯字符串错误");
    expect(normalizeErrorMessage({ message: "对象错误" })).toBe("对象错误");
  });

  it("剥离堆栈帧只保留错误描述", () => {
    const err = new Error("请求失败\n    at foo (file.ts:1:2)\n    at bar (file.ts:3:4)");
    expect(normalizeErrorMessage(err)).toBe("请求失败");
  });

  it("把多行与多余空白折叠成单段", () => {
    expect(normalizeErrorMessage("第一行\n\n  第二行   尾部")).toBe("第一行 第二行 尾部");
  });

  it("超长内容截断并追加省略号且不超过上限", () => {
    const result = normalizeErrorMessage("x".repeat(500), { maxLength: 10 });
    expect(result).toHaveLength(10);
    expect(result.endsWith("…")).toBe(true);
  });

  it("内容只剩堆栈时回退到非空 fallback", () => {
    const onlyStack = new Error("    at foo (file.ts:1:2)");
    expect(normalizeErrorMessage(onlyStack)).toBe("未知错误");
    expect(normalizeErrorMessage(onlyStack, { fallback: "运行失败" })).toBe("运行失败");
  });
});
