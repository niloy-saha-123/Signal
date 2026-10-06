// Slack bot tokens at rest: AES-256-GCM under SLACK_TOKEN_ENCRYPTION_KEY
// (32 bytes, base64). Stored as `enc:v1:<iv>.<tag>.<ciphertext>` (base64url).
// Values without the prefix are legacy plaintext and read back unchanged, so
// rows written before encryption keep working.
import crypto from "node:crypto";
import { logger } from "../../lib/logger";

const PREFIX = "enc:v1:";
let warnedNoKey = false;

function encryptionKey(): Buffer | null {
  const raw = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error(
      "SLACK_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded",
    );
  return key;
}

export function encryptSlackToken(token: string): string {
  const key = encryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SLACK_TOKEN_ENCRYPTION_KEY is not set; refusing to store a Slack token in plaintext",
      );
    }
    if (!warnedNoKey) {
      warnedNoKey = true;
      logger.warn(
        "slack: SLACK_TOKEN_ENCRYPTION_KEY unset — storing bot tokens in plaintext (dev only)",
      );
    }
    return token;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSlackToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = encryptionKey();
  if (!key)
    throw new Error(
      "SLACK_TOKEN_ENCRYPTION_KEY is not set; cannot decrypt a stored Slack token",
    );
  const [iv, tag, ciphertext] = stored.slice(PREFIX.length).split(".");
  if (!iv || !tag || !ciphertext)
    throw new Error("malformed encrypted Slack token");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
