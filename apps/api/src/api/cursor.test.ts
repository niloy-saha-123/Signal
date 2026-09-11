import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor } from "./cursor";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("api/cursor", () => {
  it("round-trips created_at + id", () => {
    const c = { created_at: new Date("2026-02-03T04:05:06.789Z"), id: UUID };
    const back = decodeCursor(encodeCursor(c));
    expect(back).toEqual(c);
  });

  it("produces a url-safe opaque string", () => {
    const s = encodeCursor({ created_at: new Date(), id: UUID });
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["not base64", "@@@not-base64@@@"],
    ["base64 non-JSON", Buffer.from("hello", "utf8").toString("base64url")],
    ["JSON missing id", Buffer.from(JSON.stringify({ created_at: new Date().toISOString() })).toString("base64url")],
    ["JSON bad uuid", Buffer.from(JSON.stringify({ created_at: new Date().toISOString(), id: "x" })).toString("base64url")],
    ["JSON bad date", Buffer.from(JSON.stringify({ created_at: "nope", id: UUID })).toString("base64url")],
  ])("throws on %s", (_label, bad) => {
    expect(() => decodeCursor(bad)).toThrow();
  });
});
