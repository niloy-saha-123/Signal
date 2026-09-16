// Wraps the existing hybridRetrieve/hybridRetrieveProfile fusion logic as a
// LangChain tool so an agent (Task 8's discovery agent) can call retrieval
// itself inside a ReAct loop, instead of it only being invokable as a plain
// function from application code. The underlying RRF/BM25 fusion logic is
// NOT reimplemented here — see hybrid-retrieval.ts; LangChain's generic
// createRetrieverTool doesn't support the multi-namespace fan-out this
// project's retrieval actually needs.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { hybridRetrieve, hybridRetrieveProfile } from "./hybrid-retrieval";

const RetrievalInputSchema = z.object({
  query: z.string(),
  competitor_ids: z.array(z.string()).optional(),
  workspace_id: z.string().optional(),
});

export const retrievalTool = tool(
  async ({ query, competitor_ids, workspace_id }) => {
    const chunks =
      competitor_ids && competitor_ids.length > 0
        ? await hybridRetrieve(query, competitor_ids)
        : workspace_id
          ? await hybridRetrieveProfile(query, workspace_id)
          : [];
    return JSON.stringify(chunks.map((c) => ({ id: c.id, text: c.text ?? "" })));
  },
  {
    name: "retrieve_signals",
    description:
      "Search Signal's collected competitor signals or the user's own company profile " +
      "for relevant evidence. Pass competitor_ids to search a specific competitor's " +
      "signals, or workspace_id to search the user's own company documents.",
    schema: RetrievalInputSchema,
  }
);