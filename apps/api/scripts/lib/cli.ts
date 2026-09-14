import { z } from "zod";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export type CliIo = {
  stderr: (message: string) => void;
};

export function safeIntegerCliOption(minimum: number) {
  return z
    .string()
    .regex(/^(0|[1-9]\d*)$/, "Expected a base-10 non-negative integer")
    .transform(Number)
    .pipe(z.number().int().safe().min(minimum));
}

const defaultIo: CliIo = {
  stderr: (message) => console.error(message),
};

export function parseCliArgs<TSchema extends z.ZodTypeAny>(
  argv: string[],
  schema: TSchema
): z.output<TSchema> {
  // A null-prototype record makes option names such as `__proto__`
  // ordinary own keys, so the strict Zod schema can reject them.
  const values: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      throw new CliUsageError(`Unexpected positional argument: ${argument}`);
    }

    const equalsIndex = argument.indexOf("=");
    if (equalsIndex < 3) {
      throw new CliUsageError(`Expected --key=value, received: ${argument}`);
    }

    const key = argument.slice(2, equalsIndex);
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new CliUsageError(`Duplicate option: --${key}`);
    }
    values[key] = argument.slice(equalsIndex + 1);
  }

  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    throw new CliUsageError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown failure";
  return error.message.replace(
    /\b(?:postgres(?:ql)?|redis(?:s)?|https?):\/\/\S+/gi,
    "[REDACTED_URL]"
  );
}

export async function runCli(
  main: () => Promise<void | number>,
  cleanup: () => Promise<void>,
  io: CliIo = defaultIo
): Promise<number> {
  let exitCode = 0;

  try {
    exitCode = (await main()) ?? 0;
  } catch (error) {
    io.stderr(`Error: ${safeErrorMessage(error)}`);
    exitCode = 1;
  }

  try {
    await cleanup();
  } catch (error) {
    io.stderr(`Cleanup error: ${safeErrorMessage(error)}`);
    exitCode = 1;
  }

  return exitCode;
}
