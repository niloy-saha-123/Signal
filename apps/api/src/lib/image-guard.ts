// Raster-image admission for chat vision. Magic-byte sniff (not extension),
// SVG reject, size + dimension caps, EXIF/XMP/text-chunk strip. No decoder
// execution — we parse just enough of the container to measure and copy.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8_192;
export const MAX_IMAGES_PER_TURN = 4;

export type RasterMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type SniffedImageType = RasterMime | "image/svg+xml";

export type ImageGuardCode = "svg" | "type" | "size" | "dimension";

export class ImageGuardError extends Error {
  constructor(
    message: string,
    readonly code: ImageGuardCode
  ) {
    super(message);
    this.name = "ImageGuardError";
  }
}

function startsWith(buf: Buffer, bytes: number[] | string): boolean {
  if (typeof bytes === "string") {
    return buf.subarray(0, bytes.length).toString("latin1") === bytes;
  }
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 1024)).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<SVG")) return true;
  return head.startsWith("<?xml") && /<svg[\s>]/i.test(head);
}

export function sniffImageType(buf: Buffer): SniffedImageType | null {
  if (looksLikeSvg(buf)) return "image/svg+xml";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, "GIF87a") || startsWith(buf, "GIF89a")) return "image/gif";
  if (startsWith(buf, "RIFF") && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const size = buf.readUInt16BE(i + 2);
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (size < 2) return null;
    i += 2 + size;
  }
  return null;
}

function gifDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function webpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const chunk = buf.subarray(12, 16).toString("latin1");
  if (chunk === "VP8X") {
    return {
      width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
      height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
    };
  }
  if (chunk === "VP8 " && buf.length >= 30) {
    // Lossy VP8 frame: 16-bit width/height at offset 26, 14 bits used.
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function dimensionsOf(buf: Buffer, mime: RasterMime): { width: number; height: number } | null {
  if (mime === "image/png") return pngDimensions(buf);
  if (mime === "image/jpeg") return jpegDimensions(buf);
  if (mime === "image/gif") return gifDimensions(buf);
  return webpDimensions(buf);
}

function stripJpegMetadata(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) {
      out.push(buf.subarray(i));
      break;
    }
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) {
      out.push(buf.subarray(i));
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) {
      out.push(buf.subarray(i));
      break;
    }
    const size = buf.readUInt16BE(i + 2);
    const skip = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!skip) out.push(buf.subarray(i, i + 2 + size));
    i += 2 + size;
  }
  return Buffer.concat(out);
}

function stripPngMetadata(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  const drop = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + length;
    if (end > buf.length) break;
    if (!drop.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

function stripWebpMetadata(buf: Buffer): Buffer {
  if (buf.length < 12) return buf;
  const drop = new Set(["EXIF", "XMP ", "ICCP"]);
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString("latin1");
    const size = buf.readUInt32LE(i + 4);
    const dataEnd = i + 8 + size;
    const padded = dataEnd + (size % 2);
    if (padded > buf.length) break;
    if (!drop.has(type)) chunks.push(buf.subarray(i, padded));
    i = padded;
  }
  const payload = Buffer.concat(chunks);
  const riffSize = payload.length + 4;
  const header = Buffer.from("RIFF....WEBP");
  header.write("RIFF", 0);
  header.writeUInt32LE(riffSize, 4);
  header.write("WEBP", 8);
  return Buffer.concat([header, payload]);
}

export function stripImageMetadata(buf: Buffer, mime: RasterMime): Buffer {
  if (mime === "image/jpeg") return stripJpegMetadata(buf);
  if (mime === "image/png") return stripPngMetadata(buf);
  if (mime === "image/webp") return stripWebpMetadata(buf);
  return buf;
}

export function validateRasterImage(buf: Buffer): { mime: RasterMime; buffer: Buffer } {
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new ImageGuardError(`image is larger than the ${MAX_IMAGE_BYTES} byte limit`, "size");
  }
  const sniffed = sniffImageType(buf);
  if (sniffed === "image/svg+xml") {
    throw new ImageGuardError("SVG images are not allowed", "svg");
  }
  if (!sniffed) {
    throw new ImageGuardError("file is not a PNG, JPEG, GIF, or WebP image", "type");
  }
  const dims = dimensionsOf(buf, sniffed);
  if (!dims || dims.width < 1 || dims.height < 1) {
    throw new ImageGuardError("could not read image dimensions", "dimension");
  }
  if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION) {
    throw new ImageGuardError(
      `image dimensions ${dims.width}x${dims.height} exceed ${MAX_IMAGE_DIMENSION}`,
      "dimension"
    );
  }
  return { mime: sniffed, buffer: stripImageMetadata(buf, sniffed) };
}
