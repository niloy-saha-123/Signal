// Typed fetch wrapper for the Signal API. Every function validates its response against a
// packages/shared Zod schema where one exists. Competitor and Alert have no shared schema
// (apps/api/src/db/schema.ts never exports one for the frontend) — those use a plain
// TypeScript interface here instead of inventing a second schema that can drift from the
// table. Chat (SSE) is out of scope — see Part 7's ChatInterface.
import {
  CompanyProfileSchema,
  CompetitorCreateInputSchema,
  DiscoveryLogSchema,
  DiscoveryStatusSchema,
  SignalSchema,
  SignalScoreComponentsSchema,
  type CompanyProfile,
  type CompetitorCreateInput,
  type DiscoveryStatus,
  type Signal,
} from "@signal/shared";
import { z } from "zod";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`Signal API error ${status}`);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

// --- Competitors (apps/api/src/db/schema.ts's competitorsTable — no shared Zod schema) ---

export interface Competitor {
  id: string;
  name: string;
  domain: string;
  subreddits: string[];
  greenhouse_token: string | null;
  lever_token: string | null;
  pricing_url: string | null;
  changelog_rss: string | null;
  is_active: boolean;
  discovery_status: DiscoveryStatus;
  discovered_at: string | null;
  created_at: string;
  updated_at: string;
}

export function listCompetitors(): Promise<Competitor[]> {
  return request<Competitor[]>("/api/competitors");
}

export function getCompetitor(id: string): Promise<Competitor> {
  return request<Competitor>(`/api/competitors/${id}`);
}

export async function createCompetitor(input: CompetitorCreateInput): Promise<Competitor> {
  const body = CompetitorCreateInputSchema.parse(input);
  return request<Competitor>("/api/competitors", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const CompetitorScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  components: SignalScoreComponentsSchema,
  computed_at: z.string().datetime(),
  delta_7d: z.number().finite().nullable(),
  delta_30d: z.number().finite().nullable(),
});
export type CompetitorScore = z.infer<typeof CompetitorScoreSchema>;

export async function getCompetitorScore(id: string): Promise<CompetitorScore> {
  return CompetitorScoreSchema.parse(await request(`/api/competitors/${id}/score`));
}

const CompetitorDiscoverySchema = z.object({
  discovery_status: DiscoveryStatusSchema,
  log: z.array(DiscoveryLogSchema),
});
export type CompetitorDiscovery = z.infer<typeof CompetitorDiscoverySchema>;

export async function getCompetitorDiscovery(id: string): Promise<CompetitorDiscovery> {
  return CompetitorDiscoverySchema.parse(await request(`/api/competitors/${id}/discovery`));
}

export function analyzeCompetitor(id: string): Promise<{ run_id: string; status: "running" }> {
  return request(`/api/competitors/${id}/analyze`, { method: "POST" });
}
