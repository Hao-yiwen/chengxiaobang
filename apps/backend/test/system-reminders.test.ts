import { describe, expect, it } from "vitest";
import {
  TODO_IDLE_REMINDER,
  buildContextReminderMessage,
  buildReminderMessage,
  buildRepeatedToolReminder,
  buildToolOverloadReminder,
  wrapSystemReminder
} from "../src/agent/system-reminders";

describe("system-reminders", () => {
  it("wrapSystemReminder 包裹标签", () => {
    expect(wrapSystemReminder("hi")).toBe("<system-reminder>\nhi\n</system-reminder>");
  });

  it("buildContextReminderMessage 注入技能清单；无技能返回 undefined", () => {
    expect(buildContextReminderMessage({ skills: [] })).toBeUndefined();
    expect(buildContextReminderMessage({})).toBeUndefined();

    const msg = buildContextReminderMessage({ skills: [{ name: "docx", description: "做 Word" }] });
    expect(msg?.role).toBe("user");
    const text = typeof msg?.content === "string" ? msg.content : "";
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("## 可用技能");
    expect(text).toContain("docx");
    expect(text).toContain("做 Word");
    expect(text).toContain("未必与当前任务相关");
  });

  it("buildContextReminderMessage 注入 when_to_use 并按预算裁剪", () => {
    const skills = Array.from({ length: 8 }, (_, i) => ({
      name: `skill-${i}`,
      description: `描述 ${i} ${"x".repeat(30)}`,
      whenToUse: `场景 ${i}`
    }));
    const text =
      (buildContextReminderMessage({ skills, skillListCharBudget: 180 })?.content as string) ?? "";

    expect(text).toContain("适用场景: 场景 0");
    expect(text).toContain("另有");
    expect(text).not.toContain("skill-7: 描述 7");
  });

  it("重复/过载提醒文案带数量", () => {
    expect(buildRepeatedToolReminder("Read", 3)).toContain("连续调用了 3 次 Read");
    expect(buildToolOverloadReminder(20)).toContain("已经发起了 20 次工具调用");
  });

  it("buildReminderMessage 合并多条；空数组返回 undefined", () => {
    expect(buildReminderMessage([])).toBeUndefined();

    const msg = buildReminderMessage(["A", TODO_IDLE_REMINDER]);
    const text = typeof msg?.content === "string" ? msg.content : "";
    expect(text).toContain("<system-reminder>\nA\n</system-reminder>");
    expect(text).toContain(TODO_IDLE_REMINDER);
    expect((text.match(/<system-reminder>/g) ?? []).length).toBe(2);
  });
});
