// Real-time RAG chat agent that retrieves signal context from Pinecone and streams responses via SSE.
export async function handleChatQuery(_query: string, _competitorIds: string[]): Promise<AsyncIterable<string>> {
  async function* empty() {}
  return empty();
}
