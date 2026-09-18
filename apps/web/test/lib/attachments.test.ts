import { describe, expect, it } from "vitest";
import {
  validateChatAttachment,
  validateDocument,
  MAX_IMAGE_BYTES,
} from "../../lib/attachments";

function fakeFile(name: string, size: number, type = "application/octet-stream"): File {
  const buf = new Uint8Array(Math.min(size, 16));
  const file = new File([buf], name, { type });
  if (size !== file.size) {
    Object.defineProperty(file, "size", { value: size });
  }
  return file;
}

describe("lib/attachments — chat vs company-document validation", () => {
  it("validateDocument still rejects images (company knowledge path)", () => {
    expect(validateDocument(fakeFile("shot.png", 100, "image/png"))).toMatch(/supported type/i);
  });

  it("validateChatAttachment accepts raster images and docs", () => {
    expect(validateChatAttachment(fakeFile("notes.txt", 100, "text/plain"))).toBeNull();
    expect(validateChatAttachment(fakeFile("shot.png", 100, "image/png"))).toBeNull();
  });

  it("validateChatAttachment rejects SVG", () => {
    expect(validateChatAttachment(fakeFile("evil.svg", 100, "image/svg+xml"))).toMatch(/SVG/i);
  });

  it("validateChatAttachment rejects oversized images", () => {
    expect(
      validateChatAttachment(fakeFile("big.png", MAX_IMAGE_BYTES + 1, "image/png"))
    ).toMatch(/5 MB/i);
  });
});
