import { mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const svg = join(root, "assets/icon.svg");
const build = join(root, "build");
const iconset = join(build, "icon.iconset");

await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });

const sizes = [16, 32, 64, 128, 256, 512, 1024];
for (const size of sizes) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(join(iconset, `icon_${size}x${size}.png`));
}
await sharp(svg).resize(1024, 1024).png().toFile(join(build, "icon.png"));
await execFileAsync("iconutil", ["-c", "icns", iconset, "-o", join(build, "icon.icns")]);
