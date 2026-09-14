import { describe, expect, it } from "vitest";
import { parseNumericSetting } from "@/lib/numeric-config";

describe("parseNumericSetting", () => {
  it("uses the default only when the setting is absent", () => {
    expect(
      parseNumericSetting("LIMIT", undefined, { defaultValue: 4, min: 0, max: 10 })
    ).toBe(4);
  });

  it("preserves an explicitly configured zero when it is within bounds", () => {
    expect(parseNumericSetting("LIMIT", "0", { defaultValue: 4, min: 0, max: 10 })).toBe(0);
  });

  it.each(["", "  ", "NaN", "Infinity", "-1", "11"])(
    "rejects invalid bounded values without echoing them: %j",
    (raw) => {
      expect(() =>
        parseNumericSetting("LIMIT", raw, { defaultValue: 4, min: 0, max: 10 })
      ).toThrow("Invalid numeric configuration: LIMIT");
    }
  );

  it("enforces integer settings", () => {
    expect(() =>
      parseNumericSetting("COUNT", "1.5", {
        defaultValue: 1,
        min: 1,
        max: 100,
        integer: true,
      })
    ).toThrow("Invalid numeric configuration: COUNT");
  });
});
