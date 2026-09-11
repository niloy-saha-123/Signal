import { open } from "node:fs/promises";
import { CliUsageError } from "./cli";

export const DEFAULT_FIXTURE_MAX_BYTES = 10 * 1024 * 1024;

export async function readUtf8Fixture(
  path: string,
  maxBytes = DEFAULT_FIXTURE_MAX_BYTES
): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size > maxBytes) {
      throw new CliUsageError(`Fixture exceeds the ${maxBytes}-byte limit`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
