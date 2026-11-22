import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1_048_576;
const MAX_DIM = 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

interface ImageInfo {
  kind: "png" | "jpeg";
  width: number;
  height: number;
}

function inspectPng(buf: Buffer): ImageInfo {
  if (buf.length < 33 || buf.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("Invalid PNG: missing IHDR header");
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!buf.subarray(buf.length - 8).equals(PNG_IEND)) {
    throw new Error("Invalid PNG: missing IEND trailer");
  }
  return { kind: "png", width, height };
}

function inspectJpeg(buf: Buffer): ImageInfo {
  if (buf.length < 4 || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) {
    throw new Error("Invalid JPEG: missing EOI marker");
  }
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      throw new Error(`Invalid JPEG marker at byte ${offset}`);
    }
    const marker = buf[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segLen = buf.readUInt16BE(offset + 2);
    if ((marker === 0xc0 || marker === 0xc2) && offset + 9 <= buf.length) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { kind: "jpeg", width, height };
    }
    offset += 2 + segLen;
  }
  throw new Error("Invalid JPEG: SOF frame dimensions not found");
}

function validateImage(buf: Buffer): ImageInfo {
  let info: ImageInfo;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) {
    info = inspectPng(buf);
  } else if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    info = inspectJpeg(buf);
  } else {
    throw new Error("entry.png must begin with valid PNG or JPEG magic bytes");
  }
  if (info.width <= 0 || info.height <= 0 || info.width > MAX_DIM || info.height > MAX_DIM) {
    throw new Error(`Image dimensions ${info.width}x${info.height} exceed ${MAX_DIM}x${MAX_DIM}`);
  }
  return info;
}

function main(): void {
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const botDir = process.env.MAKEFUN_BOT_DIR || selfDir;
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const srcPath = join(botDir, "entry.png");

  if (!existsSync(srcPath)) {
    throw new Error(`Missing source image at ${srcPath}`);
  }

  const stat = statSync(srcPath);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) {
    throw new Error(`Invalid image size: ${stat.size} bytes (limit ${MAX_BYTES})`);
  }

  const payload = readFileSync(srcPath);
  const info = validateImage(payload);
  const sha256 = createHash("sha256").update(payload).digest("hex");

  mkdirSync(outputDir, { recursive: true });
  const dstPath = join(outputDir, "entry.png");
  writeFileSync(dstPath, payload);
  console.log(
    `Wrote ${info.kind.toUpperCase()} ${info.width}x${info.height} (${payload.length} bytes, sha256:${sha256}) to ${dstPath}`,
  );
}

main();
