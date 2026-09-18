// Shared upload validation for company-documents and per-turn chat attachments.
export const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB — matches the API's multer limit
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — matches API image-guard
export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_DOCS = 4;

export const ACCEPTED_DOC_EXTENSIONS = [
  ".pdf",
  ".txt",
  ".md",
  ".doc",
  ".docx",
  ".csv",
  ".json",
  ".rtf",
] as const;

export const ACCEPTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;

export const ACCEPTED_CHAT_EXTENSIONS = [
  ...ACCEPTED_DOC_EXTENSIONS,
  ...ACCEPTED_IMAGE_EXTENSIONS,
] as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function isImageName(name: string): boolean {
  return (ACCEPTED_IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

// Returns a user-facing error string, or null when the file is acceptable for
// the persistent company-documents path (docs only — no SVG/images).
export function validateDocument(file: File): string | null {
  if (file.size > MAX_DOC_BYTES) {
    return `"${file.name}" is ${formatBytes(file.size)} — larger than the 10 MB limit.`;
  }
  const name = file.name.toLowerCase();
  const ok = ACCEPTED_DOC_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!ok) {
    return `"${file.name}" isn't a supported type. Use ${ACCEPTED_DOC_EXTENSIONS.join(", ")}.`;
  }
  return null;
}

// Per-turn chat attachments: docs + raster images. SVG is always rejected.
export function validateChatAttachment(file: File): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".svg") || file.type === "image/svg+xml") {
    return `"${file.name}" is an SVG — chat only accepts PNG, JPEG, WebP, or GIF images.`;
  }
  if (isImageName(name) || file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE_BYTES) {
      return `"${file.name}" is ${formatBytes(file.size)} — larger than the 5 MB image limit.`;
    }
    if (!(ACCEPTED_IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(name))) {
      return `"${file.name}" isn't a supported image. Use ${ACCEPTED_IMAGE_EXTENSIONS.join(", ")}.`;
    }
    return null;
  }
  return validateDocument(file);
}
