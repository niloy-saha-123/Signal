import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dockerfile = resolve(process.cwd(), "Dockerfile");

describe("production Docker image", () => {
  it("uses a Playwright-supported glibc runtime with pinned Chromium and a non-root user", async () => {
    const source = await readFile(dockerfile, "utf8");
    expect(source).toMatch(/FROM node:22-bookworm-slim AS builder/);
    expect(source).toMatch(/FROM node:22-bookworm-slim AS runtime/);
    expect(source).toContain("npx --no-install playwright install --with-deps chromium");
    expect(source).toContain("USER node");
    expect(source).not.toContain("node:20");
  });

  it("aligns the declared and CI Node runtime with installed dependency engines", async () => {
    const rootPackage = JSON.parse(
      await readFile(resolve(process.cwd(), "../../package.json"), "utf8")
    ) as { engines?: { node?: string } };
    const workflow = await readFile(resolve(process.cwd(), "../../.github/workflows/ci.yml"), "utf8");

    expect(rootPackage.engines?.node).toBe(">=22.12.0");
    expect(workflow.match(/node-version: "22"/g)).toHaveLength(2);
    expect(workflow).not.toContain('node-version: "20"');
  });

  it("keeps distinct API and worker process commands", async () => {
    const source = await readFile(dockerfile, "utf8");
    expect(source).toContain('CMD ["node", "dist/api/index.js"]');
    expect(source).toContain("FROM runtime AS worker");
    expect(source).toContain('CMD ["node", "dist/worker.js"]');
  });

  it("does not run the root postinstall before shared sources or build tooling exist", async () => {
    const source = await readFile(dockerfile, "utf8");
    const installs = source.match(/^RUN npm ci.*$/gm) ?? [];

    expect(installs).toHaveLength(2);
    expect(installs.every((line) => line.includes("--ignore-scripts"))).toBe(true);
    expect(source).toContain("RUN npm run build -w @signal/shared");
  });
});
