import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readUtf8Fixture } from "../../../scripts/lib/fixture-file";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("readUtf8Fixture", () => {
  it("reads a file at or below the byte limit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "signal-fixture-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "fixture.json");
    await writeFile(path, "12345", "utf8");

    await expect(readUtf8Fixture(path, 5)).resolves.toBe("12345");
  });

  it("rejects an oversized file before reading it into memory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "signal-fixture-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "fixture.json");
    await writeFile(path, "123456", "utf8");

    await expect(readUtf8Fixture(path, 5)).rejects.toThrow("exceeds the 5-byte limit");
  });
});
