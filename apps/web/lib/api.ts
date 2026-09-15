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
  SignalScoreSchema,
  type CompanyProfile,
  type CompetitorCreateInput,
  type DiscoveryStatus,
  type Signal,
  type SignalScore,
} from "@signal/shared";
import { z } from "zod";

export type { CompanyProfile, SignalSource } from "@signal/shared";

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

// Oldest-first, for SignalScoreCard's sparkline / TrendChart's Signal Score panel.
export async function getCompetitorScoreHistory(id: string, limit = 30): Promise<SignalScore[]> {
  const raw = await request<{ data: unknown[] }>(`/api/competitors/${id}/scores?limit=${limit}`);
  return raw.data.map((row) => SignalScoreSchema.parse(row));
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

// --- Signals ---

export interface Paginated<T> {
  data: T[];
  next_cursor: string | null;
}

export interface ListSignalsParams {
  competitor_ids: string[];
  sources?: string[];
  min_quality?: number;
  created_after?: string;
  created_before?: string;
  cursor?: string;
  limit?: number;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) q.set(key, value);
  }
  return q.toString();
}

export async function listSignals(params: ListSignalsParams): Promise<Paginated<Signal>> {
  const query = buildQuery({
    competitor_ids: params.competitor_ids.join(","),
    sources: params.sources?.join(","),
    min_quality: params.min_quality?.toString(),
    created_after: params.created_after,
    created_before: params.created_before,
    cursor: params.cursor,
    limit: params.limit?.toString(),
  });
  const raw = await request<{ data: unknown[]; next_cursor: string | null }>(
    `/api/signals?${query}`
  );
  return { data: raw.data.map((row) => SignalSchema.parse(row)), next_cursor: raw.next_cursor };
}

// --- Alerts (apps/api/src/db/schema.ts's alertsTable — no shared Zod schema) ---

export interface Alert {
  id: string;
  competitor_id: string;
  run_id: string | null;
  pattern: string;
  confidence: number;
  evidence: Record<string, unknown>[];
  interpretation: string;
  vulnerability_window_days: number | null;
  recommended_actions: Record<string, unknown>[];
  supporting_cluster_ids: string[];
  delivered: boolean;
  created_at: string;
}

export interface ListAlertsParams {
  competitor_ids: string[];
  cursor?: string;
  limit?: number;
}

export function listAlerts(params: ListAlertsParams): Promise<Paginated<Alert>> {
  const query = buildQuery({
    competitor_ids: params.competitor_ids.join(","),
    cursor: params.cursor,
    limit: params.limit?.toString(),
  });
  return request(`/api/alerts?${query}`);
}

// --- Company profile ---

export async function getCompanyProfile(): Promise<CompanyProfile | null> {
  const res = await fetch(`${API_BASE}/api/company-profile`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, body);
  }
  return CompanyProfileSchema.parse(await res.json());
}

export async function saveCompanyProfile(input: CompanyProfile): Promise<CompanyProfile> {
  const body = CompanyProfileSchema.parse(input);
  return CompanyProfileSchema.parse(
    await request("/api/company-profile", { method: "POST", body: JSON.stringify(body) })
  );
}
