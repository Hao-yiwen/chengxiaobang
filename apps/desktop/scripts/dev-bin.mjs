import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function resolveWorkspaceBin(
  name,
  { desktopDir, repoRoot, platform = process.platform, existsSyncImpl = existsSync }
) {
  const commandName = platform === "win32" ? `${name}.cmd` : name;
  const candidates = [
    resolve(desktopDir, "node_modules/.bin", commandName),
    resolve(repoRoot, "node_modules/.bin", commandName),
    resolve(desktopDir, "node_modules/.bin", name),
    resolve(repoRoot, "node_modules/.bin", name)
  ];
  return candidates.find((candidate) => existsSyncImpl(candidate)) ?? candidates[0];
}
