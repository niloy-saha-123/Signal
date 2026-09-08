// Namespaced Pinecone query/upsert utility — competitor_id is a mandatory parameter,
// never optional, so one competitor's vectors can never leak into another's results.
import { Pinecone, Index } from "@pinecone-database/pinecone";

let pineconeInstance: Pinecone | undefined;
let indexInstance: Index | undefined;

function getIndex() {
  if (!pineconeInstance) {
    pineconeInstance = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    indexInstance = pineconeInstance.index({ name: process.env.PINECONE_INDEX_NAME ?? "signal" });
  }
  return indexInstance;
}

export interface PineconeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface PineconeRecord {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean>;
}

export async function pineconeQuery(
  competitorId: string,
  vector: number[],
  topK: number,
  filter?: Record<string, unknown>
): Promise<PineconeMatch[]> {
  const index = getIndex()!;
  const response = await index.namespace(competitorId).query({
    vector,
    topK,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });
  return (response.matches ?? []) as PineconeMatch[];
}

export async function pineconeUpsert(
  competitorId: string,
  records: PineconeRecord[]
): Promise<void> {
  const index = getIndex()!;
  await index.namespace(competitorId).upsert({ records });
}
