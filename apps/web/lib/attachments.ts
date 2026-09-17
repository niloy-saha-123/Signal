// Shared document-upload validation. The API (company-documents, multer) accepts
// multipart up to 10 MB with no type restriction; we gate type + size on the client
// so the field behaves predictably and users get a clear reason before hitting the server.
export const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB — matches the API's multer limit

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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Returns a user-facing error string, or null when the file is acceptable.
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