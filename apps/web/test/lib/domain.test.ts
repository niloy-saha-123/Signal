import { describe, expect, it } from "vitest";
import { normalizeDomain } from "../../lib/domain";

describe("normalizeDomain", () => {
  it.each([
    ["kestrel.dev", "kestrel.dev"],
    ["  KESTREL.DEV/  ", "kestrel.dev"],
    ["https://www.kestrel.dev/pricing?plan=team#faq", "kestrel.dev"],
    ["http://docs.kestrel.co.uk", "docs.kestrel.co.uk"],
    ["kestrel.dev.", "kestrel.dev"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each([
    "",
    "kestrel",
    "localhost",
    "app.localhost",
    "printer.local",
    "127.0.0.1",
    "kestrel.dev:8080",
    "user:pass@kestrel.dev",
    "-kestrel.dev",
    "kes trel.dev",
    "kestrel.d",
    "javascript:alert(1)",
    `${"a".repeat(64)}.dev`,
  ])("rejects %j", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});
