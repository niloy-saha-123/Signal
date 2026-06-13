// Pipeline that chunks long signals, generates embeddings, and upserts vectors to Pinecone.
export async function embedAndUpsertSignal(
  _competitorId: string,
  _signalId: string,
  _content: string,
): Promise<void> {
  // TODO: chunk → text-embedding-3-small → Pinecone upsert
}
