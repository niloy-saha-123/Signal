import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every analysis node reads text a competitor controls (its homepage, its
// forum, its job posts). A raw ["human", ...] message would hand that text to
// the model with no boundary, so each call must go through guardedMessages.
describe("analysis nodes", () => {
  it("never send collected text to the model outside the untrusted-evidence wrapper", () => {
    const dir = path.resolve(__dirname, "../../../src/agents/analysis");
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => readFileSync(path.join(dir, file), "utf-8").includes('["human",'));
    expect(offenders).toEqual([]);
  });
});
