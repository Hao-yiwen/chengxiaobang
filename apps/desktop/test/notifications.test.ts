// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { showSystemNotification } from "../src/renderer/lib/notifications";

const originalNotification = window.Notification;

afterEach(() => {
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: originalNotification
  });
});

function installNotificationMock(permission: NotificationPermission, requested?: NotificationPermission) {
  const instances: Array<{ title: string; options?: NotificationOptions }> = [];
  class MockNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => {
      MockNotification.permission = requested ?? permission;
      return MockNotification.permission;
    });

    constructor(title: string, options?: NotificationOptions) {
      instances.push({ title, options });
    }
  }

  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: MockNotification
  });

  return { MockNotification, instances };
}

describe("showSystemNotification", () => {
  it("requests permission the first time a system notification is needed", async () => {
    const { MockNotification, instances } = installNotificationMock("default", "granted");

    await expect(showSystemNotification({ title: "任务完成", body: "结果已写入原会话。" }))
      .resolves.toBe(true);

    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(instances).toEqual([
      { title: "任务完成", options: { body: "结果已写入原会话。" } }
    ]);
  });

  it("does not request again when permission is denied", async () => {
    const { MockNotification, instances } = installNotificationMock("denied");

    await expect(showSystemNotification({ title: "任务失败" })).resolves.toBe(false);

    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    expect(instances).toHaveLength(0);
  });

  it("falls back cleanly when the runtime does not support notifications", async () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: undefined
    });

    await expect(showSystemNotification({ title: "任务完成" })).resolves.toBe(false);
  });
});
