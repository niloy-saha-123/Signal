// PDF/DOCX use LangChain's community document loaders directly. XLSX and
// PPTX have no maintained LangChain JS loader (unlike Python's `unstructured`
// package) — XLSX uses the `xlsx` library's own text serialization; PPTX is
// a zip of XML slide parts, so this extracts <a:t> text runs directly via
// jszip rather than depending on an unmaintained/unverified npm package.
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import * as XLSX from "xlsx";
import JSZip from "jszip";

export class UnsupportedDocumentTypeError extends Error {
  constructor(mimeType: string) {
    super(`unsupported document type: ${mimeType}`);
    this.name = "UnsupportedDocumentTypeError";
  }
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const loader = new PDFLoader(new Blob([buffer]));
  const docs = await loader.load();
  return docs.map((d) => d.pageContent).join("\n\n");
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const loader = new DocxLoader(new Blob([buffer]));
  const docs = await loader.load();
  return docs.map((d) => d.pageContent).join("\n\n");
}

function parseXlsx(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`;
  }).join("\n\n");
}

async function parsePptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();
  const texts: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("text");
    const matches = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    if (matches.length > 0) texts.push(matches.join(" "));
  }
  return texts.join("\n\n");
}

export async function parseDocument(buffer: Buffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "application/pdf":
      return parsePdf(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return parseDocx(buffer);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return parseXlsx(buffer);
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return parsePptx(buffer);
    default:
      throw new UnsupportedDocumentTypeError(mimeType);
  }
}
