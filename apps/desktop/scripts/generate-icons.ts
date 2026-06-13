import { mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const sourceIcon = join(root, "assets/icon.png");
const build = join(root, "build");
const iconset = join(build, "icon.iconset");

await rm(iconset, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });

function roundedMask(size: number): Buffer {
  const radius = Math.round(size * 0.22);

  return Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="black"/></svg>`
  );
}

async function renderIcon(size: number, outPath: string): Promise<void> {
  console.info(`正在生成 ${size}x${size} 图标：${outPath}`);
  await sharp(sourceIcon)
    .resize(size, size, { fit: "cover", position: "center" })
    .ensureAlpha()
    .composite([{ input: roundedMask(size), blend: "dest-in" }])
    .png()
    .toFile(outPath);
}

const sizes = [16, 32, 64, 128, 256, 512, 1024];
for (const size of sizes) {
  await renderIcon(size, join(iconset, `icon_${size}x${size}.png`));
}
await renderIcon(1024, join(build, "icon.png"));
if (process.platform === "darwin") {
  console.info("正在生成 macOS icns 图标");
  await execFileAsync("iconutil", ["-c", "icns", iconset, "-o", join(build, "icon.icns")]);
} else {
  console.info("当前平台不支持 iconutil，已跳过 macOS icns 图标生成");
}
