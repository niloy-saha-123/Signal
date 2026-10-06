import { createHash, randomBytes } from "node:crypto";

export const API_TOKEN_PREFIX = "sig_";
const DISPLAY_PREFIX_LENGTH = 12;

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashApiToken(token), prefix: token.slice(0, DISPLAY_PREFIX_LENGTH) };
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
