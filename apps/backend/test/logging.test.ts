import { describe, expect, it } from "vitest";
import {
  bindLogContext,
  getLogger,
  resetLogContextForTest,
  withLogContext
} from "../src/logging/logger";
import { captureBackendLogs } from "./helpers/logging";

describe("backend logger", () => {
  it("inherits and overrides nested log context", async () => {
    const { entries, restore } = captureBackendLogs();
    try {
      await withLogContext({ requestId: "req_outer", sessionId: "session_1" }, async () => {
        getLogger({ module: "logging-test" }).info("外层日志", { action: "outer" });

        await withLogContext({ requestId: "req_inner", runId: "run_1" }, async () => {
          await Promise.resolve();
          getLogger({ module: "logging-test" }).warn("内层日志", { action: "inner" });
        });
      });

      expect(entries).toEqual([
        {
          level: "info",
          message: "外层日志",
          fields: {
            requestId: "req_outer",
            sessionId: "session_1",
            module: "logging-test",
            action: "outer"
          }
        },
        {
          level: "warn",
          message: "内层日志",
          fields: {
            requestId: "req_inner",
            sessionId: "session_1",
            runId: "run_1",
            module: "logging-test",
            action: "inner"
          }
        }
      ]);
    } finally {
      restore();
    }
  });

  it("keeps bound fields across async continuations", async () => {
    const { entries, restore } = captureBackendLogs();
    try {
      await withLogContext({ requestId: "req_1" }, async () => {
        bindLogContext({ sessionId: "session_1" });
        await new Promise((resolve) => setTimeout(resolve, 0));
        getLogger({ module: "logging-test" }).info("异步日志", { action: "async" });
      });

      expect(entries[0]).toMatchObject({
        level: "info",
        message: "异步日志",
        fields: {
          requestId: "req_1",
          sessionId: "session_1",
          module: "logging-test",
          action: "async"
        }
      });
    } finally {
      restore();
      resetLogContextForTest();
    }
  });
});
