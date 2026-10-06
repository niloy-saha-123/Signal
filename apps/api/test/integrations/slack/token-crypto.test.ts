import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { decryptSlackToken, encryptSlackToken } from "@/integrations/slack/token-crypto";

const KEY = crypto.randomBytes(32).toString("base64");

afterEach(() => vi.unstubAllEnvs());

describe("slack token crypto", () => {
  it("round-trips and never stores the plaintext", () => {
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptSlackToken("xoxb-secret");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("xoxb-secret");
    expect(decryptSlackToken(stored)).toBe("xoxb-secret");
  });

  it("uses a fresh IV each time", () => {
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", KEY);
    expect(encryptSlackToken("xoxb-a")).not.toBe(encryptSlackToken("xoxb-a"));
  });

  it("reads legacy plaintext tokens unchanged", () => {
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", KEY);
    expect(decryptSlackToken("xoxb-legacy")).toBe("xoxb-legacy");
  });

  it("rejects a tampered ciphertext", () => {
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptSlackToken("xoxb-secret");
    const tampered = stored.slice(0, -2) + (stored.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSlackToken(tampered)).toThrow();
  });

  it("rejects a wrong key", () => {
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptSlackToken("xoxb-secret");
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    expect(() => decryptSlackToken(stored)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", Buffer.alloc(16).toString("base64"));
    expect(() => encryptSlackToken("xoxb-a")).toThrow(/32 bytes/);
  });

  it("without a key: plaintext in dev, refuses in production", () => {
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(encryptSlackToken("xoxb-a")).toBe("xoxb-a");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptSlackToken("xoxb-a")).toThrow(/not set/);
  });

  it("cannot decrypt an encrypted token without the key", () => {
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptSlackToken("xoxb-secret");
    vi.stubEnv("SLACK_TOKEN_ENCRYPTION_KEY", "");
    expect(() => decryptSlackToken(stored)).toThrow(/not set/);
  });
});
