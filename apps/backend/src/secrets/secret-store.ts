import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
type ExecFileAsync = typeof execFileAsync;

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

export function parseWindowsCredentialSecretRef(
  ref: string
): { service: string; account: string } | undefined {
  const prefix = "windows-credential:";
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

export class WindowsCredentialSecretStore implements SecretStore {
  constructor(
    private readonly service = "程小帮",
    private readonly execFileImpl: ExecFileAsync = execFileAsync
  ) {}

  async setSecret(account: string, secret: string): Promise<string> {
    try {
      await this.runCredentialScript(
        "[CxbCredential]::Write($env:CXB_CREDENTIAL_TARGET, $env:CXB_CREDENTIAL_ACCOUNT, $env:CXB_CREDENTIAL_SECRET)",
        {
          CXB_CREDENTIAL_TARGET: this.targetName(account),
          CXB_CREDENTIAL_ACCOUNT: account,
          CXB_CREDENTIAL_SECRET: secret
        }
      );
    } catch (error) {
      console.warn("[secret-store] 保存 Windows Credential Manager 密钥失败", {
        service: this.service,
        account,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    console.info("[secret-store] 已保存 Windows Credential Manager 密钥", {
      service: this.service,
      account
    });
    return `windows-credential:${this.service}:${account}`;
  }

  async getSecret(ref: string): Promise<string | undefined> {
    const parsed = parseWindowsCredentialSecretRef(ref);
    if (!parsed) {
      console.warn("[secret-store] Windows Credential Manager 密钥引用格式无效", { ref });
      return undefined;
    }
    try {
      const { stdout } = await this.runCredentialScript(
        [
          "$value = [CxbCredential]::Read($env:CXB_CREDENTIAL_TARGET)",
          "if ($null -ne $value) { [Console]::Out.Write($value) }"
        ].join("\n"),
        {
          CXB_CREDENTIAL_TARGET: this.targetName(parsed.account, parsed.service),
          CXB_CREDENTIAL_ACCOUNT: parsed.account
        }
      );
      const secret = typeof stdout === "string" ? stdout : stdout.toString("utf8");
      return secret === "" ? undefined : secret;
    } catch (error) {
      console.warn("[secret-store] 读取 Windows Credential Manager 密钥失败", {
        service: parsed.service,
        account: parsed.account,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private targetName(account: string, service = this.service): string {
    return `${service}:${account}`;
  }

  private runCredentialScript(
    command: string,
    env: Record<string, string | undefined>
  ): ReturnType<ExecFileAsync> {
    return this.execFileImpl(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `${WINDOWS_CREDENTIAL_SCRIPT}\n${command}`
      ],
      {
        env: {
          ...process.env,
          ...env
        },
        windowsHide: true
      }
    );
  }
}

export function createSecretStore(): SecretStore {
  if (process.platform === "darwin") {
    return new MacOSKeychainSecretStore();
  }
  if (process.platform === "win32") {
    return new WindowsCredentialSecretStore();
  }
  return new MemorySecretStore();
}

const WINDOWS_CREDENTIAL_SCRIPT = String.raw`
Add-Type @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class CxbCredential
{
  private const UInt32 CRED_TYPE_GENERIC = 1;
  private const UInt32 CRED_PERSIST_LOCAL_MACHINE = 2;
  private const Int32 ERROR_NOT_FOUND = 1168;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL
  {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string targetName, UInt32 type, UInt32 flags, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
  private static extern void CredFree(IntPtr buffer);

  public static void Write(string targetName, string account, string secret)
  {
    byte[] secretBytes = Encoding.Unicode.GetBytes(secret ?? "");
    IntPtr secretBlob = Marshal.AllocCoTaskMem(secretBytes.Length);
    try
    {
      Marshal.Copy(secretBytes, 0, secretBlob, secretBytes.Length);
      CREDENTIAL credential = new CREDENTIAL();
      credential.Type = CRED_TYPE_GENERIC;
      credential.TargetName = targetName;
      credential.UserName = account;
      credential.CredentialBlob = secretBlob;
      credential.CredentialBlobSize = (UInt32)secretBytes.Length;
      credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
      if (!CredWrite(ref credential, 0))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    }
    finally
    {
      Marshal.FreeCoTaskMem(secretBlob);
    }
  }

  public static string Read(string targetName)
  {
    IntPtr credentialPtr;
    if (!CredRead(targetName, CRED_TYPE_GENERIC, 0, out credentialPtr))
    {
      int error = Marshal.GetLastWin32Error();
      if (error == ERROR_NOT_FOUND)
      {
        return null;
      }
      throw new Win32Exception(error);
    }
    try
    {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(credentialPtr, typeof(CREDENTIAL));
      if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0)
      {
        return "";
      }
      byte[] secretBytes = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, secretBytes, 0, (int)credential.CredentialBlobSize);
      return Encoding.Unicode.GetString(secretBytes);
    }
    finally
    {
      CredFree(credentialPtr);
    }
  }
}
"@
$ErrorActionPreference = "Stop"
`;
