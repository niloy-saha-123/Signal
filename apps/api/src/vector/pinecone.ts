// Pinecone client utilities with mandatory per-competitor namespace enforcement for all vector operations.
export function competitorNamespace(competitorId: string): string {
  return `competitor_${competitorId}`;
}

export async function pineconeQuery(
  competitorId: string,
  _embedding: number[],
  _topK = 20,
): Promise<unknown[]> {
  const _namespace = competitorNamespace(competitorId);
  return [];
}

export async function pineconeUpsert(
  competitorId: string,
  _vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>,
): Promise<void> {
  const _namespace = competitorNamespace(competitorId);
  // TODO: implement Pinecone upsert
}

export async function multiNamespaceQuery(
  competitorIds: string[],
  _embedding: number[],
  _topK = 20,
): Promise<unknown[]> {
  return competitorIds.flatMap(() => []);
}
