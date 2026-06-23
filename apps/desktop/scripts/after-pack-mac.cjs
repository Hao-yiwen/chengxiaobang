const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

module.exports = async function afterPackMac(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  if (!existsSync(appPath)) {
    throw new Error(`[after-pack-mac] 找不到 macOS app bundle: ${appPath}`);
  }

  const configuredIdentity = context.packager.config.mac?.identity ?? process.env.CSC_NAME;
  if (hasValidIdentity(configuredIdentity)) {
    console.info("[after-pack-mac] 检测到有效签名身份，交给 electron-builder 正式签名", {
      identity: configuredIdentity
    });
    return;
  }

  console.warn("[after-pack-mac] 未检测到有效 Developer ID，使用 ad-hoc 签名本地 macOS 包", {
    appPath,
    configuredIdentity: configuredIdentity ?? null
  });
  run("xattr", ["-cr", appPath]);
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
};

function hasValidIdentity(identity) {
  const trimmed = identity?.trim();
  if (!trimmed || trimmed === "-") {
    return false;
  }

  try {
    const output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.match(/"([^"]+)"/)?.[1])
      .filter(Boolean)
      .some((candidate) => candidate === trimmed || candidate.includes(trimmed) || trimmed.includes(candidate));
  } catch {
    return false;
  }
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}
