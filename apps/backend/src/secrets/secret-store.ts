import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SecretStore {
  setSecret(account: string, secret: string): Promise<string>;
  getSecret(ref: string): Promise<string | undefined>;
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
    return `keychain:${this.service}:${account}`;
  }

  async getSecret(ref: string): Promise<string | undefined> {
    const [, service, account] = ref.split(":");
    if (!service || !account) {
      return undefined;
    }
    try {
      const { stdout } = await execFileAsync("/usr/bin/security", [
        "find-generic-password",
        "-a",
        account,
        "-s",
        service,
        "-w"
      ]);
      return stdout.trim();
    } catch {
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
