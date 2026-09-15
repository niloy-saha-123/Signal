import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";

describe("globals.css", () => {
  it("compiles through the Tailwind v4 PostCSS pipeline and emits a preflight reset", async () => {
    const cssPath = path.resolve(__dirname, "../../app/globals.css");
    const css = readFileSync(cssPath, "utf-8");
    const result = await postcss([tailwindcss()]).process(css, { from: cssPath });
    expect(result.css.length).toBeGreaterThan(0);
    expect(result.css).toContain("::before");
    // Proves Tailwind's content detection reaches components/, not just app/ —
    // this class only exists because SiteNav.tsx uses hover:bg-indigo-50.
    expect(result.css).toContain("hover\\:bg-indigo-50");
  });

  it("emits the Part 4 semantic color tokens as CSS custom properties", async () => {
    const cssPath = path.resolve(__dirname, "../../app/globals.css");
    const css = readFileSync(cssPath, "utf-8");
    const result = await postcss([tailwindcss()]).process(css, { from: cssPath });
    expect(result.css).toContain("--color-source-reddit");
    expect(result.css).toContain("--color-status-critical");
    expect(result.css).toContain("--color-diverging-positive");
    expect(result.css).toContain("--color-sequential");
  });
});
