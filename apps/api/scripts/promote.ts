// Promotes a prompt version after a two-proportion z-test against the active version.
import { AgentNameSchema } from "@signal/shared";
import { z } from "zod";
import {
  EvaluationCountsSchema,
  PromotePromptVersionInputSchema,
  passesPromotionGate,
  twoProportionZTest,
  type PromotePromptVersionInput,
  type PromotionResult,
  type TwoProportionResult,
} from "../src/evaluation/prompt-contracts";
import { parseCliArgs, runCli, safeIntegerCliOption } from "./lib/cli";

export {
  passesPromotionGate,
  twoProportionZTest,
  type PromotePromptVersionInput,
  type PromotionResult,
  type TwoProportionResult,
};

export type PromptPromotionDeps = {
  promotePromptVersion: (input: PromotePromptVersionInput) => Promise<PromotionResult>;
};

export type PromptPromotionRuntime = {
  deps: PromptPromotionDeps;
  cleanup: () => Promise<void>;
};

export type PromoteCliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

const PromoteOptionsSchema = z
  .object({
    "agent-name": AgentNameSchema,
    "candidate-version": safeIntegerCliOption(1),
    "active-version": safeIntegerCliOption(1),
    "candidate-passed": safeIntegerCliOption(0),
    "candidate-total": safeIntegerCliOption(1),
    "active-passed": safeIntegerCliOption(0),
    "active-total": safeIntegerCliOption(1),
  })
  .strict()
  .superRefine((value, context) => {
    const candidate = EvaluationCountsSchema.safeParse({
      passed: value["candidate-passed"],
      total: value["candidate-total"],
    });
    if (!candidate.success) {
      for (const issue of candidate.error.issues) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Candidate counts: ${issue.message}`,
          path: ["candidate-passed"],
        });
      }
    }

    const active = EvaluationCountsSchema.safeParse({
      passed: value["active-passed"],
      total: value["active-total"],
    });
    if (!active.success) {
      for (const issue of active.error.issues) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Active counts: ${issue.message}`,
          path: ["active-passed"],
        });
      }
    }
  });

function toPromotionInput(options: z.output<typeof PromoteOptionsSchema>): PromotePromptVersionInput {
  return PromotePromptVersionInputSchema.parse({
    agentName: options["agent-name"],
    candidateVersion: options["candidate-version"],
    activeVersion: options["active-version"],
    candidate: {
      passed: options["candidate-passed"],
      total: options["candidate-total"],
    },
    active: {
      passed: options["active-passed"],
      total: options["active-total"],
    },
  });
}

async function loadDefaultRuntime(): Promise<PromptPromotionRuntime> {
  const [{ promotePromptVersion }, { closeDatabase }] = await Promise.all([
    import("../src/db/queries.js"),
    import("../src/db/client.js"),
  ]);
  return {
    deps: { promotePromptVersion },
    cleanup: closeDatabase,
  };
}

const defaultIo: PromoteCliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

export async function runPromoteCli(
  argv: string[],
  loadRuntime: () => Promise<PromptPromotionRuntime> = loadDefaultRuntime,
  io: PromoteCliIo = defaultIo
): Promise<number> {
  let cleanup: () => Promise<void> = async () => {};
  return runCli(
    async () => {
      const input = toPromotionInput(parseCliArgs(argv, PromoteOptionsSchema));
      const runtime = await loadRuntime();
      cleanup = runtime.cleanup;
      const result = await runtime.deps.promotePromptVersion(input);
      io.stdout(JSON.stringify(result, null, 2));
    },
    () => cleanup(),
    { stderr: io.stderr }
  );
}

if (require.main === module) {
  void runPromoteCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
