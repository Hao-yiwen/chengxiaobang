import { describe, expect, it, vi } from "vitest";
import {
  parseKeychainSecretRef,
  parseWindowsCredentialSecretRef,
  WindowsCredentialSecretStore
} from "../src/secrets/secret-store";
import { captureBackendLogs } from "./helpers/logging";

describe("parseKeychainSecretRef", () => {
  it("keeps colons inside the Keychain account name", () => {
    expect(parseKeychainSecretRef("keychain:程小帮:web-search:tavily")).toEqual({
      service: "程小帮",
      account: "web-search:tavily"
    });
  });

  it("rejects malformed Keychain refs", () => {
    expect(parseKeychainSecretRef("memory:web-search:tavily")).toBeUndefined();
    expect(parseKeychainSecretRef("keychain:程小帮")).toBeUndefined();
    expect(parseKeychainSecretRef("keychain::web-search:tavily")).toBeUndefined();
  });
});

describe("parseWindowsCredentialSecretRef", () => {
  it("keeps colons inside the Windows credential account name", () => {
    expect(parseWindowsCredentialSecretRef("windows-credential:程小帮:web-search:tavily")).toEqual({
      service: "程小帮",
      account: "web-search:tavily"
    });
  });

  it("rejects malformed Windows credential refs", () => {
    expect(parseWindowsCredentialSecretRef("memory:web-search:tavily")).toBeUndefined();
    expect(parseWindowsCredentialSecretRef("windows-credential:程小帮")).toBeUndefined();
    expect(parseWindowsCredentialSecretRef("windows-credential::web-search:tavily")).toBeUndefined();
  });
});

describe("WindowsCredentialSecretStore", () => {
  it("passes secrets through environment variables instead of command arguments", async () => {
    const execFileImpl = vi.fn(async (..._args: unknown[]) => ({ stdout: "", stderr: "" }));
    const store = new WindowsCredentialSecretStore("程小帮", execFileImpl as never);

    await expect(store.setSecret("provider:deepseek", "secret-value")).resolves.toBe(
      "windows-credential:程小帮:provider:deepseek"
    );

    expect(execFileImpl).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-Command", expect.stringContaining("CxbCredential")]),
      expect.objectContaining({
        env: expect.objectContaining({
          CXB_CREDENTIAL_TARGET: "程小帮:provider:deepseek",
          CXB_CREDENTIAL_ACCOUNT: "provider:deepseek",
          CXB_CREDENTIAL_SECRET: "secret-value"
        }),
        windowsHide: true
      })
    );
    const args = execFileImpl.mock.calls[0]?.[1] ?? [];
    expect(JSON.stringify(args)).not.toContain("secret-value");
  });

  it("reads a stored Windows credential value", async () => {
    const execFileImpl = vi.fn(async (..._args: unknown[]) => ({
      stdout: "secret-value",
      stderr: ""
    }));
    const store = new WindowsCredentialSecretStore("程小帮", execFileImpl as never);

    await expect(store.getSecret("windows-credential:程小帮:web-search:tavily")).resolves.toBe(
      "secret-value"
    );
  });

  it("logs and rethrows when writing a Windows credential fails", async () => {
    const execFileImpl = vi.fn(async (..._args: unknown[]) => {
      throw new Error("credential write failed");
    });
    const { entries, restore } = captureBackendLogs();
    const store = new WindowsCredentialSecretStore("程小帮", execFileImpl as never);

    try {
      await expect(store.setSecret("provider:deepseek", "secret-value")).rejects.toThrow(
        "credential write failed"
      );

      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: "warn",
            message: "[secret-store] 保存 Windows Credential Manager 密钥失败",
            fields: expect.objectContaining({
              service: "程小帮",
              account: "provider:deepseek",
              errorMessage: "credential write failed"
            })
          })
        ])
      );
      expect(JSON.stringify(entries)).not.toContain("secret-value");
    } finally {
      restore();
    }
  });

  it("returns undefined when reading a Windows credential fails", async () => {
    const execFileImpl = vi.fn(async (..._args: unknown[]) => {
      throw new Error("credential unavailable");
    });
    const store = new WindowsCredentialSecretStore("程小帮", execFileImpl as never);

    await expect(store.getSecret("windows-credential:程小帮:web-search:tavily")).resolves.toBeUndefined();
  });
});
