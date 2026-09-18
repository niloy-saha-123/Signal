// Per-turn chat attachments. Parsed/validated in-memory and returned to the
// chat graph as evidence — never written to company_profile or Pinecone.
import { parseDocument, UnsupportedDocumentTypeError } from "../../lib/document-parser";
import {
  ImageGuardError,
  MAX_IMAGES_PER_TURN,
  sniffImageType,
  validateRasterImage,
  type RasterMime,
} from "../../lib/image-guard";
import { MAX_DOCS_PER_TURN } from "./input-budget";
import { consumeChatInputBudget } from "./input-budget";

export interface TurnFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface TurnDocument {
  filename: string;
  text: string;
}

export interface TurnImage {
  filename: string;
  mime: RasterMime;
  base64: string;
}

export interface ProcessedTurnAttachments {
  documents: TurnDocument[];
  images: TurnImage[];
}

export class TurnAttachmentError extends Error {
  constructor(
    message: string,
    readonly code: "svg" | "type" | "size" | "dimension" | "cap" | "empty" | "budget"
  ) {
    super(message);
    this.name = "TurnAttachmentError";
  }
}

const TEXT_EXTENSION = /\.(txt|md|markdown|csv|json|rtf)$/i;
const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/rtf",
  "application/json",
  "application/rtf",
]);
const MAX_DOC_CHARS = 100_000;

function isTextDocument(file: TurnFile): boolean {
  const mime = file.mimeType.split(";")[0].trim().toLowerCase();
  return TEXT_MIMES.has(mime) || TEXT_EXTENSION.test(file.filename);
}

function parseTextDocument(buffer: Buffer, filename: string): string {
  if (buffer.includes(0)) {
    throw new TurnAttachmentError(`"${filename}" looks like a binary file`, "type");
  }
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) throw new TurnAttachmentError(`"${filename}" is empty`, "empty");
  return text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) : text;
}

async function parseTurnDocument(file: TurnFile): Promise<string> {
  if (isTextDocument(file)) return parseTextDocument(file.buffer, file.filename);
  try {
    const text = (await parseDocument(file.buffer, file.mimeType.split(";")[0].trim().toLowerCase())).trim();
    if (!text) throw new TurnAttachmentError(`"${file.filename}" is empty`, "empty");
    return text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) : text;
  } catch (err) {
    if (err instanceof TurnAttachmentError) throw err;
    if (err instanceof UnsupportedDocumentTypeError) {
      throw new TurnAttachmentError(`"${file.filename}" isn't a supported document type`, "type");
    }
    throw new TurnAttachmentError(
      `"${file.filename}" could not be read: ${err instanceof Error ? err.message : String(err)}`,
      "type"
    );
  }
}

function asTurnImageError(err: unknown): never {
  if (err instanceof ImageGuardError) {
    throw new TurnAttachmentError(err.message, err.code);
  }
  throw err;
}

export async function processTurnAttachments(
  files: TurnFile[],
  workspaceId: string
): Promise<ProcessedTurnAttachments> {
  const documents: TurnDocument[] = [];
  const images: TurnImage[] = [];

  for (const file of files) {
    const sniffed = sniffImageType(file.buffer);
    const namedSvg =
      file.filename.toLowerCase().endsWith(".svg") || file.mimeType.toLowerCase().includes("svg");
    if (sniffed === "image/svg+xml" || namedSvg) {
      throw new TurnAttachmentError("SVG images are not allowed", "svg");
    }
    if (sniffed) {
      if (images.length >= MAX_IMAGES_PER_TURN) {
        throw new TurnAttachmentError(`at most ${MAX_IMAGES_PER_TURN} images per turn`, "cap");
      }
      let validated;
      try {
        validated = validateRasterImage(file.buffer);
      } catch (err) {
        asTurnImageError(err);
      }
      try {
        await consumeChatInputBudget("read_image", workspaceId);
      } catch {
        throw new TurnAttachmentError("image workspace rate limit exceeded", "budget");
      }
      images.push({
        filename: file.filename,
        mime: validated.mime,
        base64: validated.buffer.toString("base64"),
      });
      continue;
    }

    if (documents.length >= MAX_DOCS_PER_TURN) {
      throw new TurnAttachmentError(`at most ${MAX_DOCS_PER_TURN} documents per turn`, "cap");
    }
    documents.push({ filename: file.filename, text: await parseTurnDocument(file) });
  }

  return { documents, images };
}
