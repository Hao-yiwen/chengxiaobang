import { describe, expect, it } from "vitest";
import { substituteServerSpec, substituteVars } from "../src/mcp/variable-substitution";
import type { McpServerSpec } from "../src/mcp/types";

const ctx = {
  pluginRoot: "/plugins/android",
  projectDir: "/workspace/proj",
  pluginDataDir: "/data/mcp/android",
  userConfig: { sdk_path: "/opt/android", default_avd: "" }
};

describe("substituteVars", () => {
  it("replaces CLAUDE_* placeholders", () => {
    expect(substituteVars("${CLAUDE_PLUGIN_ROOT}/dist/server.js", ctx).value).toBe(
      "/plugins/android/dist/server.js"
    );
    expect(substituteVars("${CLAUDE_PROJECT_DIR}", ctx).value).toBe("/workspace/proj");
    expect(substituteVars("${CLAUDE_PLUGIN_DATA}", ctx).value).toBe("/data/mcp/android");
  });

  it("replaces user_config values and reports missing/empty keys", () => {
    expect(substituteVars("${user_config.sdk_path}", ctx).value).toBe("/opt/android");
    const empty = substituteVars("${user_config.default_avd}", ctx);
    expect(empty.value).toBe("");
    expect(empty.missing).toEqual(["default_avd"]);
    expect(substituteVars("${user_config.unknown}", ctx).missing).toEqual(["unknown"]);
  });

  it("leaves unknown shell-like tokens intact (no shell expansion)", () => {
    expect(substituteVars("plain $HOME ~/x", ctx).value).toBe("plain $HOME ~/x");
  });
});

describe("substituteServerSpec", () => {
  const spec: McpServerSpec = {
    pluginName: "android-emulator",
    pluginRoot: "/plugins/android",
    serverName: "android-emulator",
    key: "android-emulator.android-emulator",
    command: "node",
    args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"],
    env: {
      DATA: "${CLAUDE_PLUGIN_DATA}",
      SDK: "${user_config.sdk_path}",
      AVD: "${user_config.default_avd}"
    },
    cwd: "${CLAUDE_PROJECT_DIR}",
    transport: "stdio"
  };

  it("substitutes the whole spec and aggregates missing keys", () => {
    const { resolved, missing } = substituteServerSpec(spec, ctx);
    expect(resolved.args).toEqual(["/plugins/android/dist/mcp/server.js"]);
    expect(resolved.env.DATA).toBe("/data/mcp/android");
    expect(resolved.env.SDK).toBe("/opt/android");
    expect(resolved.cwd).toBe("/workspace/proj");
    expect(resolved.projectScoped).toBe(true);
    expect(missing).toEqual(["default_avd"]);
  });

  it("marks non-project-scoped servers and resolves relative cwd against pluginRoot", () => {
    const local: McpServerSpec = { ...spec, cwd: "sub/dir", env: {}, args: [] };
    const { resolved } = substituteServerSpec(local, ctx);
    expect(resolved.projectScoped).toBe(false);
    expect(resolved.cwd).toBe("/plugins/android/sub/dir");
  });
});
