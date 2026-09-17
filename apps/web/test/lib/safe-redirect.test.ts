import { afterEach, describe, expect, it, vi } from "vitest";

import { getSafeNextPath } from "../../lib/safe-redirect";

describe("getSafeNextPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([null, ""])("uses /briefing for an absent destination (%s)", (candidate) => {
    expect(getSafeNextPath(candidate)).toBe("/briefing");
  });

  it("preserves an internal path with query and hash", () => {
    expect(getSafeNextPath("/alerts?source=pricing#latest")).toBe(
      "/alerts?source=pricing#latest",
    );
  });

  it("rejects an absolute URL", () => {
    expect(getSafeNextPath("https://attacker.example/collect")).toBe("/briefing");
  });

  it("rejects a protocol-relative URL", () => {
    expect(getSafeNextPath("//attacker.example/collect")).toBe("/briefing");
  });

  it("rejects a path containing a backslash", () => {
    expect(getSafeNextPath("/briefing\\attacker.example")).toBe("/briefing");
  });

  it.each(["/briefing\u0000next", "/briefing\nnext", "/briefing\u007fnext"])(
    "rejects a path containing a control character",
    (candidate) => {
      expect(getSafeNextPath(candidate)).toBe("/briefing");
    },
  );

  it("uses the requested fallback when URL parsing fails", () => {
    vi.stubGlobal(
      "URL",
      class UnparseableURL {
        constructor() {
          throw new TypeError("cannot parse");
        }
      },
    );

    expect(getSafeNextPath("/briefing", "/login")).toBe("/login");
  });
});
