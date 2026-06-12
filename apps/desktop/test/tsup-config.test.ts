import { describe, expect, it } from "vitest";
import tsupConfig from "../tsup.config";

const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];

describe("desktop tsup config", () => {
  it("keeps pino external for the Electron main ESM bundle", () => {
    const mainConfig = configs.find((config) => config.name === "main");

    expect(mainConfig?.external).toContain("pino");
    expect(mainConfig?.noExternal ?? []).not.toContain("pino");
  });
});
