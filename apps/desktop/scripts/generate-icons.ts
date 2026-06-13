import { mkdir, rm, writeFile } from "node:fs/promises";
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

async function renderIcon(size: number, outPath: string): Promise<Buffer> {
  console.info(`正在生成 ${size}x${size} 图标：${outPath}`);
  const buffer = await renderIconBuffer(size);
  await writeFile(outPath, buffer);
  return buffer;
}

async function renderIconBuffer(size: number): Promise<Buffer> {
  return sharp(sourceIcon)
    .resize(size, size, { fit: "cover", position: "center" })
    .ensureAlpha()
    .composite([{ input: roundedMask(size), blend: "dest-in" }])
    .png()
    .toBuffer();
}

const sizes = [16, 32, 64, 128, 256, 512, 1024];
const iconBuffers = new Map<number, Buffer>();
for (const size of sizes) {
  iconBuffers.set(size, await renderIcon(size, join(iconset, `icon_${size}x${size}.png`)));
}
iconBuffers.set(48, await renderIconBuffer(48));
await renderIcon(1024, join(build, "icon.png"));
await writeFile(join(build, "icon.ico"), createIco([16, 32, 48, 64, 128, 256], iconBuffers));
console.info("已生成 Windows ico 图标");

if (process.platform === "darwin") {
  console.info("正在生成 macOS icns 图标");
  await execFileAsync("iconutil", ["-c", "icns", iconset, "-o", join(build, "icon.icns")]);
} else {
  console.info("当前平台不支持 iconutil，已跳过 macOS icns 图标生成");
}

function createIco(requestedSizes: number[], buffers: Map<number, Buffer>): Buffer {
  const entries = requestedSizes.map((size) => {
    const buffer = buffers.get(size) ?? buffers.get(nearestAvailableSize(size, buffers));
    if (!buffer) {
      throw new Error(`缺少 ico 图标尺寸 ${size}`);
    }
    return { size, buffer };
  });
  const headerSize = 6;
  const directorySize = 16 * entries.length;
  const totalSize = headerSize + directorySize + entries.reduce((sum, entry) => sum + entry.buffer.length, 0);
  const ico = Buffer.alloc(totalSize);
  let offset = 0;
  ico.writeUInt16LE(0, offset);
  offset += 2;
  ico.writeUInt16LE(1, offset);
  offset += 2;
  ico.writeUInt16LE(entries.length, offset);
  offset += 2;

  let imageOffset = headerSize + directorySize;
  for (const entry of entries) {
    ico.writeUInt8(entry.size >= 256 ? 0 : entry.size, offset);
    ico.writeUInt8(entry.size >= 256 ? 0 : entry.size, offset + 1);
    ico.writeUInt8(0, offset + 2);
    ico.writeUInt8(0, offset + 3);
    ico.writeUInt16LE(1, offset + 4);
    ico.writeUInt16LE(32, offset + 6);
    ico.writeUInt32LE(entry.buffer.length, offset + 8);
    ico.writeUInt32LE(imageOffset, offset + 12);
    entry.buffer.copy(ico, imageOffset);
    offset += 16;
    imageOffset += entry.buffer.length;
  }
  return ico;
}

function nearestAvailableSize(target: number, buffers: Map<number, Buffer>): number {
  const sizes = [...buffers.keys()].sort((left, right) => Math.abs(left - target) - Math.abs(right - target));
  return sizes[0] ?? target;
}
