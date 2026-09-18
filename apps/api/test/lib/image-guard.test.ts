import { describe, expect, it } from "vitest";
import {
  ImageGuardError,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  sniffImageType,
  stripImageMetadata,
  validateRasterImage,
} from "@/lib/image-guard";

// 1×1 PNG (89 50 4E 47 …)
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function jpegWithExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const exifBody = Buffer.from("Exif\0\0SECRET");
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([(exifBody.length + 2) >> 8, (exifBody.length + 2) & 0xff]),
    exifBody,
  ]);
  // Minimal SOF0 1x1 then SOS+EOI so dimension parsing succeeds.
  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9]);
  return Buffer.concat([soi, app1, sof, sos]);
}

describe("lib/image-guard — sniffImageType", () => {
  it("detects PNG/JPEG from magic bytes", () => {
    expect(sniffImageType(PNG_1X1)).toBe("image/png");
    expect(sniffImageType(jpegWithExif())).toBe("image/jpeg");
  });

  it("flags SVG regardless of claimed type", () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      "image/svg+xml"
    );
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBe("image/svg+xml");
  });

  it("returns null for a non-image", () => {
    expect(sniffImageType(Buffer.from("%PDF-1.4"))).toBeNull();
  });
});

describe("lib/image-guard — validateRasterImage", () => {
  it("accepts a small PNG and returns the sniffed mime", () => {
    const result = validateRasterImage(PNG_1X1);
    expect(result.mime).toBe("image/png");
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("rejects SVG", () => {
    expect(() => validateRasterImage(Buffer.from("<svg></svg>"))).toThrow(ImageGuardError);
    try {
      validateRasterImage(Buffer.from("<svg></svg>"));
    } catch (err) {
      expect((err as ImageGuardError).code).toBe("svg");
    }
  });

  it("rejects an oversized payload", () => {
    const huge = Buffer.concat([PNG_1X1.subarray(0, 8), Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(() => validateRasterImage(huge)).toThrow(/larger than/i);
  });

  it("rejects a PNG whose IHDR exceeds the dimension cap", () => {
    const oversized = Buffer.from(PNG_1X1);
    oversized.writeUInt32BE(MAX_IMAGE_DIMENSION + 1, 16);
    expect(() => validateRasterImage(oversized)).toThrow(/dimension/i);
  });

  it("strips JPEG EXIF so SECRET does not survive", () => {
    const stripped = stripImageMetadata(jpegWithExif(), "image/jpeg");
    expect(stripped.includes("SECRET")).toBe(false);
    expect(stripped.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
  });
});
