import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CliUsageError, parseCliArgs, runCli } from "../../../scripts/lib/cli";

describe("parseCliArgs", () => {
  const schema = z
    .object({
      days: z.coerce.number().int().min(1).max(365),
      format: z.enum(["table", "json"]).default("table"),
    })
    .strict();

  it("parses validated --key=value flags and applies schema defaults", () => {
    expect(parseCliArgs(["--days=7"], schema)).toEqual({ days: 7, format: "table" });
  });

  it.each([
    [["7"], "Unexpected positional argument: 7"],
    [["--days"], "Expected --key=value, received: --days"],
    [["--days=7", "--days=8"], "Duplicate option: --days"],
    [["--days=7", "--unknown=yes"], "Unrecognized key"],
    [["--days=0"], "Number must be greater than or equal to 1"],
  ])("rejects malformed or invalid argv %#", (argv, expectedMessage) => {
    expect(() => parseCliArgs(argv, schema)).toThrowError(expectedMessage);
  });

  it("rejects prototype-named options instead of silently dropping them", () => {
    expect(() =>
      parseCliArgs(["--days=7", "--__proto__=polluted"], schema)
    ).toThrowError("Unrecognized key");
  });
});

describe("runCli", () => {
  it("returns the command's exit code, writes no errors, and awaits cleanup", async () => {
    const events: string[] = [];
    const stderr = vi.fn();

    const exitCode = await runCli(
      async () => {
        events.push("main");
        return 3;
      },
      async () => {
        await Promise.resolve();
        events.push("cleanup");
      },
      { stderr }
    );

    expect(exitCode).toBe(3);
    expect(events).toEqual(["main", "cleanup"]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("reports an Error safely and still cleans up", async () => {
    const cleanup = vi.fn(async () => undefined);
    const stderr = vi.fn();

    const exitCode = await runCli(
      async () => {
        throw new Error("database unavailable");
      },
      cleanup,
      { stderr }
    );

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith("Error: database unavailable");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("does not expose arbitrary thrown values", async () => {
    const stderr = vi.fn();

    const exitCode = await runCli(
      async () => {
        throw { password: "should-not-be-printed" };
      },
      async () => undefined,
      { stderr }
    );

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith("Error: Unknown failure");
  });

  it("redacts credential-bearing URLs from Error messages", async () => {
    const stderr = vi.fn();

    await runCli(
      async () => {
        throw new Error("connection failed: postgresql://signal:secret@db.example.com/signal");
      },
      async () => undefined,
      { stderr }
    );

    expect(stderr).toHaveBeenCalledWith("Error: connection failed: [REDACTED_URL]");
  });

  it("turns cleanup failure into failure without hiding an earlier command error", async () => {
    const stderr = vi.fn();

    const exitCode = await runCli(
      async () => {
        throw new CliUsageError("missing --days");
      },
      async () => {
        throw new Error("cleanup failed");
      },
      { stderr }
    );

    expect(exitCode).toBe(1);
    expect(stderr.mock.calls).toEqual([
      ["Error: missing --days"],
      ["Cleanup error: cleanup failed"],
    ]);
  });
});
