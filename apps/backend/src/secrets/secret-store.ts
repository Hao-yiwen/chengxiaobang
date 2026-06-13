import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SecretStore {
  setSecret(account: string, secret: string): Promise<string>;
  getSecret(ref: string): Promise<string | undefined>;
}

export function parseKeychainSecretRef(
  ref: string
): { service: string; account: string } | undefined {
  const prefix = "keychain:";
  if (!ref.startsWith(prefix)) {
    return undefined;
  }
  const payload = ref.slice(prefix.length);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === payload.length - 1) {
    return undefined;
  }
  return {
    service: payload.slice(0, separatorIndex),
    account: payload.slice(separatorIndex + 1)
  };
}

export class MemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  async setSecret(account: string, secret: string): Promise<string> {
    const ref = `memory:${account}`;
    this.secrets.set(ref, secret);
    return ref;
  }

  async getSecret(ref: string): Promise<string | undefined> {
    return this.secrets.get(ref);
  }
}

export class MacOSKeychainSecretStore implements SecretStore {
  constructor(private readonly service = "程小帮") {}

  async setSecret(account: string, secret: string): Promise<string> {
    await execFileAsync("/usr/bin/security", [
      "add-generic-password",
      "-a",
      account,
      "-s",
      this.service,
      "-w",
      secret,
      "-U"
    ]);
    console.info("[secret-store] 已保存 macOS Keychain 密钥", {
      service: this.service,
      account
    });
    return `keychain:${this.service}:${account}`;
  }

  async getSecret(ref: string): Promise<string | undefined> {
    const parsed = parseKeychainSecretRef(ref);
    if (!parsed) {
      console.warn("[secret-store] macOS Keychain 密钥引用格式无效", { ref });
      return undefined;
    }
    try {
      const { stdout } = await execFileAsync("/usr/bin/security", [
        "find-generic-password",
        "-a",
        parsed.account,
        "-s",
        parsed.service,
        "-w"
      ]);
      return stdout.trim();
    } catch (error) {
      console.warn("[secret-store] 读取 macOS Keychain 密钥失败", {
        service: parsed.service,
        account: parsed.account,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }
}

export function createSecretStore(): SecretStore {
  if (process.platform === "darwin") {
    return new MacOSKeychainSecretStore();
  }
  return new MemorySecretStore();
}
