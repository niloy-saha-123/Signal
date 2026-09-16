import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, UnsupportedDocumentTypeError } from "../../src/lib/document-parser";

const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures", name));

describe("parseDocument", () => {
  it("extracts text from a PDF", async () => {
    const text = await parseDocument(fixture("sample.pdf"), "application/pdf");
    expect(text.length).toBeGreaterThan(0);
  });

  it("extracts text from a DOCX", async () => {
    const text = await parseDocument(
      fixture("sample.docx"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(text.length).toBeGreaterThan(0);
  });

  it("extracts text from an XLSX", async () => {
    const text = await parseDocument(
      fixture("sample.xlsx"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(text.length).toBeGreaterThan(0);
  });

  it("extracts text from a PPTX", async () => {
    const text = await parseDocument(
      fixture("sample.pptx"),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    expect(text.length).toBeGreaterThan(0);
  });

  it("throws UnsupportedDocumentTypeError for an unrecognized mime type", async () => {
    await expect(parseDocument(Buffer.from("x"), "application/zip")).rejects.toThrow(
      UnsupportedDocumentTypeError
    );
  });
});
