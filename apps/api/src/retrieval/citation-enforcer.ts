// Citation enforcer — stage 3 of 3 in the retrieval pipeline (retrieval/index.ts, a later
// task), after hybridRetrieve() and rerankChunks(). Validates an already-generated chat
// response against the reranked evidence chunks that were supposed to ground it: extracts
// the response's factual claims via an LLM, checks each claim against the chunk set by
// embedding-cosine similarity, and returns either a grounded CitationResult or a typed
// RefusalResult if any claim is unsupported. Operational failures never certify a draft.
import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { CitationResult, RefusalResult, Citation } from "@signal/shared";
import { embedText } from "../lib/embeddings";
import { logger } from "../lib/logger";
import { parseNumericSetting } from "../lib/numeric-config";
import { selectModel, getDailyBudget } from "../llm/adaptive-router";
import { trackCost, getDailySpend } from "../llm/cost-tracker";
import type { RerankedChunk } from "./reranker";

// No dedicated AgentName enum value exists for citation enforcement (adding one is a
// schema migration, out of scope) — retrieval only ever runs as part of a chat request,
// so "chat_agent" is accurate attribution, not a misattribution.
const AGENT_NAME = "chat_agent" as const;
// Not a downgrade target in adaptive-router's DOWNGRADE_MAP, so selectModel(..., true)
// always returns this literally — called anyway for consistency, same as entity-extractor.ts.
const PREFERRED_MODEL = "gpt-4o-mini";

// Bounded client budget — same rationale as entity-extractor.ts and embeddings.ts: a hung
// request must not hold a worker slot for ~70 minutes under LangChain's defaults.
const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

// Each claim fires its own concurrent embedText call — an unbounded claim count from a
// claim-dense response multiplies real OpenAI embedding cost/latency per request with no
// bound. Reject over-limit extractions: truncation would leave omitted claims unchecked.
const MAX_CLAIMS = 30;

export class CitationVerificationUnavailableError extends Error {
  constructor(
    readonly code: "budget_exhausted" | "invalid_claims" | "claim_limit_exceeded" | "dependency_failed"
  ) {
    super(`Citation verification unavailable: ${code}`);
    this.name = "CitationVerificationUnavailableError";
  }
}

const CLAIM_EXTRACTION_PROMPT =
  "Extract every distinct factual claim made in the following text, each as a short " +
  "standalone sentence. Return an empty array if the text makes no checkable factual " +
  "assertions.";

// Local only — no other consumer, doesn't belong in packages/shared.
const claimsSchema = z.object({
  claims: z
    .array(z.string().trim().min(1))
    .describe(
      "Every distinct factual claim made in the text, each as a short standalone sentence. " +
        "Empty array if the text makes no checkable factual assertions."
    ),
});

// No cosine-similarity helper exists anywhere else in this codebase — every other cosine
// comparison happens server-side inside Pinecone. Standard dot-product-over-magnitudes
// formula, guarded against a zero-magnitude vector to avoid a NaN.
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function extractClaims(response: string): Promise<string[]> {
  // selectModel never reaches its own budget check for gpt-4o-mini (not a DOWNGRADE_MAP
  // key, so it returns early), so the daily cap has to be enforced here or not at all.
  const budget = getDailyBudget();
  const spend = await getDailySpend();
  if (spend >= budget) {
    logger.warn("citation-enforcer: daily LLM budget reached", {
      spend,
      budget,
    });
    throw new CitationVerificationUnavailableError("budget_exhausted");
  }

  const model = await selectModel(PREFERRED_MODEL, true);
  const chatModel = new ChatOpenAI({
    model,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
  });
  const structuredModel = chatModel.withStructuredOutput(claimsSchema, { includeRaw: true });

  const { raw, parsed } = await structuredModel.invoke([
    ["system", CLAIM_EXTRACTION_PROMPT],
    ["human", response],
  ]);

  // The call was made and billed whether or not the response parsed — track it first.
  const usage = (raw as AIMessage).usage_metadata;
  await trackCost(
    AGENT_NAME,
    model,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0,
    { competitorId: null, identity: { kind: "unattributed" } }
  );

  // includeRaw can return parsed:null; validate the runtime boundary regardless of SDK types.
  const validated = claimsSchema.safeParse(parsed);
  if (!validated.success) {
    logger.error("citation-enforcer: structured output failed schema validation", {
      model,
      failure: "invalid_claims",
    });
    throw new CitationVerificationUnavailableError("invalid_claims");
  }

  if (validated.data.claims.length > MAX_CLAIMS) {
    throw new CitationVerificationUnavailableError("claim_limit_exceeded");
  }

  return validated.data.claims;
}

export async function enforceCitations(
  response: string,
  chunks: RerankedChunk[],
  _query: string
): Promise<CitationResult | RefusalResult> {
  const threshold = getCitationEnforcementThreshold();
  try {
    return await verifyResponse(response, chunks, threshold);
  } catch (error) {
    if (error instanceof CitationVerificationUnavailableError) throw error;
    // Provider errors can contain prompts or raw response bodies. Do not retain
    // the cause: callers may log the operational error, including its stack.
    logger.error("citation-enforcer: verification dependency failed", { failure: "dependency_failed" });
    throw new CitationVerificationUnavailableError("dependency_failed");
  }
}

export function getCitationEnforcementThreshold(): number {
  return parseNumericSetting(
    "CITATION_ENFORCEMENT_THRESHOLD", process.env.CITATION_ENFORCEMENT_THRESHOLD,
    { defaultValue: 0.75, min: 0, max: 1 }
  );
}

async function verifyResponse(
  response: string, chunks: RerankedChunk[], threshold: number
): Promise<CitationResult | RefusalResult> {
  const claims = await extractClaims(response);
  // This boundary receives answer drafts, not typed refusals. Empty extraction
  // cannot prove arbitrary prose is grounded.
  if (claims.length === 0) {
    return {
      refused: true,
      reason: "No factual claims could be verified against retrieved evidence.",
      suggested_query: "Try asking about a specific competitor, timeframe, or product feature.",
    };
  }

  // Each claim/chunk text embedded exactly once — O(claims) + O(chunks), not
  // O(claims x chunks) — then every claim is compared against every chunk in memory.
  const claimEmbeddings = await Promise.all(claims.map((claim) => embedText(claim)));
  const chunkEmbeddings = await Promise.all(chunks.map((chunk) => embedText(chunk.text)));

  const supported: Citation[] = [];
  const unsupportedClaims: string[] = [];

  claims.forEach((claim, claimIndex) => {
    let best: { chunk: RerankedChunk; score: number } | undefined;
    chunks.forEach((chunk, chunkIndex) => {
      const score = cosineSimilarity(claimEmbeddings[claimIndex], chunkEmbeddings[chunkIndex]);
      if (!best || score > best.score) {
        best = { chunk, score };
      }
    });

    if (best && best.score >= threshold) {
      supported.push({
        claim,
        chunk_id: best.chunk.id,
        source: best.chunk.source,
        similarity_score: best.score,
      });
    } else {
      unsupportedClaims.push(claim);
    }
  });

  const unsupportedCount = unsupportedClaims.length;
  if (unsupportedCount > 0) {
    logger.warn("citation-enforcer: refusing response with unsupported claims", {
      unsupported_count: unsupportedCount,
      total_claims: claims.length,
    });
    return {
      refused: true,
      reason: `${unsupportedCount}/${claims.length} claims unsupported by retrieved evidence.`,
      suggested_query: "Try asking about a specific competitor, timeframe, or product feature.",
    };
  }

  return { refused: false, answer: response, citations: supported };
}
