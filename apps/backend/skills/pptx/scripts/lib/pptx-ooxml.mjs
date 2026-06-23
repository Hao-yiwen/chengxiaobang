import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import AdmZip from "adm-zip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const XML_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const REL_SLIDE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
export const REL_NOTES =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
export const CONTENT_TYPE_SLIDE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

export function toPosixPath(path) {
  return path.split(sep).join("/");
}

export function normalizeZipPath(path) {
  return toPosixPath(path).replace(/^\/+/, "");
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

export async function removePath(path) {
  await rm(path, { recursive: true, force: true });
}

export async function readText(path) {
  return readFile(path, "utf8");
}

export async function writeText(path, text) {
  await ensureDir(dirname(path));
  await writeFile(path, text, "utf8");
}

export function parseXml(text) {
  return new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: () => undefined,
      fatalError: (message) => {
        throw new Error(message);
      }
    }
  }).parseFromString(text, "application/xml");
}

export function serializeXml(dom) {
  return new XMLSerializer().serializeToString(dom);
}

export async function readXml(path) {
  return parseXml(await readText(path));
}

export async function writeXml(path, dom) {
  await writeText(path, serializeXml(dom));
}

export function elements(dom, tagName) {
  return Array.from(dom.getElementsByTagName(tagName));
}

export function textContentFromXml(xml) {
  const dom = parseXml(xml);
  return elements(dom, "a:t")
    .map((node) => node.textContent ?? "")
    .filter((text) => text.length > 0);
}

export function readPptxZip(path) {
  return new AdmZip(path);
}

export function zipEntryText(zip, path) {
  const entry = zip.getEntry(normalizeZipPath(path));
  return entry ? entry.getData().toString("utf8") : undefined;
}

export function listZipEntries(zip) {
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.entryName);
}

export function slideNumberFromName(name) {
  const match = basename(name).match(/^slide(\d+)\.xml$/u);
  return match ? Number(match[1]) : undefined;
}

export function nextSlideNumber(slideNames) {
  const numbers = slideNames
    .map(slideNumberFromName)
    .filter((value) => Number.isInteger(value));
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export function resolveRelationshipTarget(relsFile, target) {
  if (!target || target.includes("://") || target.startsWith("/")) {
    return normalizeZipPath(target);
  }
  const sourceDir = posix.dirname(posix.dirname(normalizeZipPath(relsFile)));
  return normalizeZipPath(posix.normalize(posix.join(sourceDir, target)));
}

export function relativeRelationshipTarget(relsFile, targetPath) {
  const sourceDir = posix.dirname(posix.dirname(normalizeZipPath(relsFile)));
  const relativePath = posix.relative(sourceDir, normalizeZipPath(targetPath));
  return relativePath || basename(targetPath);
}

export function relationshipElements(dom) {
  return elements(dom, "Relationship");
}

export function slideOrderFromPackage(zip) {
  const presXml = zipEntryText(zip, "ppt/presentation.xml");
  const presRelsXml = zipEntryText(zip, "ppt/_rels/presentation.xml.rels");
  if (!presXml || !presRelsXml) {
    return [];
  }
  const presDom = parseXml(presXml);
  const relsDom = parseXml(presRelsXml);
  const ridToTarget = new Map();
  for (const rel of relationshipElements(relsDom)) {
    if (rel.getAttribute("Type") === REL_SLIDE) {
      ridToTarget.set(rel.getAttribute("Id"), normalizeZipPath(`ppt/${rel.getAttribute("Target")}`));
    }
  }
  return elements(presDom, "p:sldId")
    .map((node, index) => ({
      index: index + 1,
      id: node.getAttribute("id"),
      rid: node.getAttribute("r:id"),
      hidden: node.getAttribute("show") === "0",
      path: ridToTarget.get(node.getAttribute("r:id"))
    }))
    .filter((slide) => slide.path);
}

export async function copyDirectoryIntoZip(root, zip) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryIntoZip(fullPath, zip);
      continue;
    }
    const relPath = normalizeZipPath(relative(root.__base ?? root, fullPath));
    zip.addFile(relPath, await readFile(fullPath));
  }
}

export async function addFolderToZip(zip, root) {
  const base = resolve(root);
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        zip.addFile(normalizeZipPath(relative(base, fullPath)), await readFile(fullPath));
      }
    }
  }
  await walk(base);
}

export async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function ensurePptxExtension(path) {
  return path.toLowerCase().endsWith(".pptx") ? path : `${path}.pptx`;
}

export function placeholderHits(text) {
  const patterns = [/xxxx/iu, /lorem/iu, /ipsum/iu, /placeholder/iu, /单击添加/u, /click to add/iu];
  return patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}
