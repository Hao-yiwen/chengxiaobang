import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(desktopDir, "native", "system-speech", "macos", "SystemSpeechHelper.swift");
const infoPlist = join(
  desktopDir,
  "native",
  "system-speech",
  "macos",
  "SystemSpeechHelper-Info.plist"
);
const entitlements = join(
  desktopDir,
  "native",
  "system-speech",
  "macos",
  "SystemSpeechHelper.entitlements"
);
const outputDir = join(desktopDir, "build", "system-speech", "darwin");
const bundle = join(outputDir, "SystemSpeechHelper.app");
const contentsDir = join(bundle, "Contents");
const macosDir = join(contentsDir, "MacOS");
const output = join(macosDir, "system-speech-helper");
const bundleInfoPlist = join(contentsDir, "Info.plist");
const resourceRoot = join(desktopDir, "build", "system-speech");

await mkdir(resourceRoot, { recursive: true });

if (process.platform !== "darwin") {
  console.info("[system-speech:build] 当前平台不是 macOS，跳过 Swift helper 编译");
  process.exit(0);
}

if (!existsSync(source) || !existsSync(infoPlist) || !existsSync(entitlements)) {
  throw new Error("[system-speech:build] 缺少系统语音 helper 源文件、Info.plist 或 entitlements");
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(macosDir, { recursive: true });
await copyFile(infoPlist, bundleInfoPlist);

console.info("[system-speech:build] 开始编译 macOS 系统语音 helper", { source, output, bundle });
await execFileAsync(
  "xcrun",
  [
    "swiftc",
    source,
    "-O",
    "-framework",
    "Speech",
    "-framework",
    "AVFoundation",
    "-Xlinker",
    "-sectcreate",
    "-Xlinker",
    "__TEXT",
    "-Xlinker",
    "__info_plist",
    "-Xlinker",
    infoPlist,
    "-o",
    output
  ],
  {
    cwd: desktopDir,
    maxBuffer: 1024 * 1024
  }
);
await signBundle(bundle);
await registerBundle(bundle);
console.info("[system-speech:build] macOS 系统语音 helper 编译完成", { output, bundle });

async function signBundle(bundlePath) {
  const identity = await findSigningIdentity();
  const signArgs = identity
    ? ["--force", "--deep", "--options", "runtime", "--sign", identity, bundlePath]
    : ["--force", "--deep", "--sign", "-", bundlePath];
  signArgs.splice(signArgs.length - 1, 0, "--entitlements", entitlements);
  try {
    await execFileAsync("codesign", signArgs, {
      cwd: desktopDir,
      maxBuffer: 1024 * 1024
    });
    console.info("[system-speech:build] macOS 系统语音 helper 签名完成", {
      bundle: bundlePath,
      identity: identity ?? "ad-hoc"
    });
  } catch (error) {
    if (!identity) {
      throw error;
    }
    console.warn("[system-speech:build] 证书签名失败，回退到 ad-hoc 签名", {
      bundle: bundlePath,
      identity,
      error: error instanceof Error ? error.message : String(error)
    });
    await execFileAsync(
      "codesign",
      ["--force", "--deep", "--sign", "-", "--entitlements", entitlements, bundlePath],
      {
        cwd: desktopDir,
        maxBuffer: 1024 * 1024
      }
    );
  }
}

async function findSigningIdentity() {
  const explicit = process.env.CXB_SYSTEM_SPEECH_CODESIGN_IDENTITY ?? process.env.CSC_NAME;
  if (explicit?.trim()) {
    return explicit.trim();
  }
  try {
    const { stdout } = await execFileAsync("security", ["find-identity", "-v", "-p", "codesigning"], {
      maxBuffer: 1024 * 1024
    });
    const identities = stdout
      .split(/\r?\n/)
      .map((line) => line.match(/"([^"]+)"/)?.[1])
      .filter(Boolean);
    return (
      identities.find((identity) => identity.startsWith("Developer ID Application:")) ??
      identities.find((identity) => identity.startsWith("Apple Development:")) ??
      undefined
    );
  } catch {
    return undefined;
  }
}

async function registerBundle(bundlePath) {
  const lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  if (!existsSync(lsregister)) {
    return;
  }
  try {
    await execFileAsync(lsregister, ["-f", bundlePath], {
      cwd: desktopDir,
      maxBuffer: 1024 * 1024
    });
    console.info("[system-speech:build] macOS 系统语音 helper 已注册到 LaunchServices", {
      bundle: bundlePath
    });
  } catch (error) {
    console.warn("[system-speech:build] 注册 macOS 系统语音 helper 失败", {
      bundle: bundlePath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
