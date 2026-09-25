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
  type ChatAgentResult,
  type DiscoveryStatus,
  type PredictionPatternType,
  type PredictionStatus,
  type ResolutionCriteria,
  type Signal,
  type SignalScore,
} from "@signal/shared";
import { z } from "zod";
import { getSupabaseBrowserClient } from "./supabase-browser";

export type {
  CompanyProfile,
  PredictionPatternType,
  PredictionStatus,
  ResolutionCriteria,
  SignalSource,
} from "@signal/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 8_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`Signal API error ${status}`);
    this.name = "ApiError";
  }
}

// Server Components have no window/localStorage, so the browser client always sees a
// null session there. They must pass their own server-derived `token` (via
// supabase-server.ts's getServerAccessToken — imported directly by the page, never
// through this module, since next/headers can't reach client bundles that also import
// this file, e.g. settings/page.tsx).
export async function authHeader(token?: string): Promise<Record<string, string>> {
  if (token) return { Authorization: `Bearer ${token}` };
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);

  if (externalSignal?.aborted) {
    abortFromCaller();
  } else {
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(new Error("Signal API request timed out after 8 seconds"));
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader(token)),
      ...init?.headers,
    },
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
  is_own_company: boolean;
  discovery_status: DiscoveryStatus;
  discovered_at: string | null;
  created_at: string;
  updated_at: string;
}

export function listCompetitors(token?: string): Promise<Competitor[]> {
  return request<Competitor[]>("/api/competitors", undefined, token);
}

export function getCompetitor(id: string, token?: string): Promise<Competitor> {
  return request<Competitor>(`/api/competitors/${id}`, undefined, token);
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

export async function getCompetitorScore(id: string, token?: string): Promise<CompetitorScore> {
  return CompetitorScoreSchema.parse(
    await request(`/api/competitors/${id}/score`, undefined, token)
  );
}

// Oldest-first, for SignalScoreCard's sparkline / TrendChart's Signal Score panel.
export async function getCompetitorScoreHistory(
  id: string,
  limit = 30,
  token?: string
): Promise<SignalScore[]> {
  const raw = await request<{ data: unknown[] }>(
    `/api/competitors/${id}/scores?limit=${limit}`,
    undefined,
    token
  );
  return raw.data.map((row) => SignalScoreSchema.parse(row));
}

// Chronological, for TrendChart's mention-volume/sentiment/score panels.
const TrendChartDataPointSchema = z.object({
  date: z.string(),
  mention_volume: z.number(),
  sentiment: z.number(),
  score: z.number(),
});
export type CompetitorTrendPoint = z.infer<typeof TrendChartDataPointSchema>;

export async function getCompetitorTrend(
  id: string,
  days = 30,
  token?: string
): Promise<CompetitorTrendPoint[]> {
  const raw = await request<{ data: unknown[] }>(
    `/api/competitors/${id}/trend?days=${days}`,
    undefined,
    token
  );
  return raw.data.map((row) => TrendChartDataPointSchema.parse(row));
}

// Recent-vs-prior department hiring deltas for HiringChart.
const HiringChartDataPointSchema = z.object({
  department: z.string(),
  delta: z.number(),
});
export type CompetitorHiringDelta = z.infer<typeof HiringChartDataPointSchema>;

export async function getCompetitorHiring(
  id: string,
  days = 30,
  token?: string
): Promise<CompetitorHiringDelta[]> {
  const raw = await request<{ data: unknown[] }>(
    `/api/competitors/${id}/hiring?days=${days}`,
    undefined,
    token
  );
  return raw.data.map((row) => HiringChartDataPointSchema.parse(row));
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

export async function listSignals(
  params: ListSignalsParams,
  token?: string
): Promise<Paginated<Signal>> {
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
    `/api/signals?${query}`,
    undefined,
    token
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

export function listAlerts(
  params: ListAlertsParams,
  token?: string
): Promise<Paginated<Alert>> {
  const query = buildQuery({
    competitor_ids: params.competitor_ids.join(","),
    cursor: params.cursor,
    limit: params.limit?.toString(),
  });
  return request(`/api/alerts?${query}`, undefined, token);
}

// --- Company profile ---

export async function getCompanyProfile(): Promise<CompanyProfile | null> {
  const res = await fetchWithTimeout(`${API_BASE}/api/company-profile`, {
    headers: await authHeader(),
  });
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

// --- Chat threads (apps/api/src/api/chat-threads.ts) ---

export interface ChatThreadSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

export function listChatThreads(token?: string): Promise<ChatThreadSummary[]> {
  return request<ChatThreadSummary[]>("/api/chat-threads", undefined, token);
}

export async function deleteChatThread(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat-threads/${id}`, {
    method: "DELETE",
    headers: await authHeader(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, body);
  }
}

export function createChatThread(): Promise<ChatThreadSummary> {
  return request<ChatThreadSummary>("/api/chat-threads", { method: "POST", body: "{}" });
}

export interface ChatThreadMessage {
  type: string;
  content: string;
}

export async function getChatThreadMessages(id: string): Promise<ChatThreadMessage[]> {
  const raw = await request<{ messages: { type?: string; content?: unknown }[] }>(
    `/api/chat-threads/${id}/messages`
  );
  return raw.messages.map((m) => ({
    type: m.type ?? "message",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
  }));
}

// --- Chat thread time travel (apps/api/src/api/chat-threads.ts) ---

export interface ChatThreadCheckpoint {
  checkpoint_id: string;
  created_at: string | undefined;
  message_count: number;
}

export async function listChatThreadCheckpoints(id: string): Promise<ChatThreadCheckpoint[]> {
  const raw = await request<{ checkpoints: ChatThreadCheckpoint[] }>(
    `/api/chat-threads/${id}/checkpoints`
  );
  return raw.checkpoints;
}

export function regenerateChatThread(
  id: string,
  checkpointId: string
): Promise<ChatAgentResult> {
  return request<ChatAgentResult>(`/api/chat-threads/${id}/regenerate`, {
    method: "POST",
    body: JSON.stringify({ checkpoint_id: checkpointId }),
  });
}

// ── Discovery Board ──────────────────────────────────────────────────────────

export interface TrackedEntity {
  id: string;
  workspace_id: string;
  source: string;
  status: string;
  candidate_name: string;
  candidate_domain: string;
  relationship_type: string | null;
  relationship_confidence: number | null;
  candidate_reason: string;
  competitor_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function listTrackedEntities(token?: string) {
  return request<TrackedEntity[]>("/api/tracked-entities", undefined, token);
}

export async function resumeDiscovery(threadId: string, decision: "confirm" | "dismiss") {
  return request(`/api/discovery/${threadId}/resume`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export async function triggerDiscovery() {
  return request("/api/discovery/trigger", { method: "POST", body: "{}" });
}

// ── Company Documents ────────────────────────────────────────────────────────

export interface CompanyDocument {
  id: string;
  workspace_id: string;
  filename: string;
  mime_type: string;
  doc_type: string;
  extraction_status: string;
  pinecone_namespace: string | null;
  created_at: Date;
}

export async function listCompanyDocuments(token?: string) {
  return request<CompanyDocument[]>("/api/company-documents", undefined, token);
}

export async function uploadCompanyDocument(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/company-documents`, {
    method: "POST",
    headers: await authHeader(),
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, body);
  }
  return res.json();
}

export async function submitCompanyText(text: string) {
  return request("/api/company-documents/text", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// ── Dashboard Summary ────────────────────────────────────────────────────────

export interface DashboardSummary {
  competitors_tracked: number;
  signals_this_week: number;
  open_alerts: number;
  pending_candidates: number;
}

export async function getDashboardSummary(token?: string) {
  return request<DashboardSummary>("/api/dashboard/summary", undefined, token);
}

// ── Signal goal (long-term memory) ───────────────────────────────────────────

export interface SignalGoal {
  goal: string | null;
  confidence: number | null;
}

export function getSignalGoal(token?: string): Promise<SignalGoal> {
  return request<SignalGoal>("/api/company-profile/signal-goal", undefined, token);
}

export async function saveSignalGoal(goal: string): Promise<SignalGoal> {
  return request<SignalGoal>("/api/company-profile/signal-goal", {
    method: "PUT",
    body: JSON.stringify({ goal }),
  });
}

// ── Company goals (apps/api/src/api/company-goals.ts) ────────────────────────

export interface CompanyGoal {
  id: string;
  workspace_id: string;
  content: string;
  created_by: "user" | "agent";
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export function listCompanyGoals(token?: string): Promise<CompanyGoal[]> {
  return request<CompanyGoal[]>("/api/company-goals", undefined, token);
}

export function createCompanyGoal(content: string): Promise<CompanyGoal> {
  return request<CompanyGoal>("/api/company-goals", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function updateCompanyGoal(
  id: string,
  changes: { content?: string; status?: "active" | "archived" }
): Promise<CompanyGoal> {
  return request<CompanyGoal>(`/api/company-goals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export async function deleteCompanyGoal(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/company-goals/${id}`, {
    method: "DELETE",
    headers: await authHeader(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, body);
  }
}

// ── Resolve Company (name + domain from single input) ───────────────────────────

export interface ResolvedCompany {
  name: string;
  domain: string;
}

export async function resolveCompany(input: string): Promise<ResolvedCompany> {
  const body = { input };
  const res = await fetch(`${API_BASE}/api/resolve-company`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeader()),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<ResolvedCompany>;
}

// ── Workspace (account / profile) ────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export function getWorkspace(token?: string): Promise<Workspace> {
  return request<Workspace>("/api/workspaces", undefined, token);
}

export function renameWorkspace(name: string): Promise<Workspace> {
  return request<Workspace>("/api/workspaces", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}


// --- Prediction ledger ---

export interface PredictionRow {
  id: string;
  workspace_id: string;
  competitor_id: string;
  run_id: string | null;
  statement: string;
  pattern_type: PredictionPatternType;
  probability: number;
  resolution_criteria: ResolutionCriteria;
  horizon_days: number;
  resolves_at: string;
  evidence_signal_ids: string[];
  evidence_count: number;
  status: PredictionStatus;
  resolved_at: string | null;
  resolution_note: string | null;
  resolution_evidence_urls: string[];
  // null while open, and null for unresolved/void — those carry no information
  // about accuracy, so they never get a score. Render the absence, do not
  // coerce it to 0: zero is a perfect Brier score.
  brier_score: number | null;
  created_at: string;
}

export interface PredictionDetail extends PredictionRow {
  evidence: Signal[];
}

export interface ListPredictionsParams {
  status?: PredictionStatus;
  pattern_type?: PredictionPatternType;
  competitor_id?: string;
  limit?: number;
}

export async function listPredictions(
  params: ListPredictionsParams = {},
  token?: string
): Promise<PredictionRow[]> {
  const query = buildQuery({
    status: params.status,
    pattern_type: params.pattern_type,
    competitor_id: params.competitor_id,
    limit: params.limit?.toString(),
  });
  const res = await request<{ data: PredictionRow[] }>(
    `/api/predictions?${query}`,
    undefined,
    token
  );
  return res.data;
}

export function getPrediction(id: string, token?: string): Promise<PredictionDetail> {
  return request(`/api/predictions/${id}`, undefined, token);
}

export interface CalibrationBucket {
  range: string;
  predicted: number;
  observed: number;
  count: number;
}

export interface Calibration {
  resolved_count: number;
  // null means no track record yet. It must render as "nothing resolved yet",
  // never as a score — 0 is flawless calibration and would be a lie.
  brier: number | null;
  baseline_brier: number;
  buckets: CalibrationBucket[];
}

export function getCalibration(
  params: { competitor_id?: string; pattern_type?: PredictionPatternType } = {},
  token?: string
): Promise<Calibration> {
  const query = buildQuery({
    competitor_id: params.competitor_id,
    pattern_type: params.pattern_type,
  });
  return request(`/api/predictions/calibration?${query}`, undefined, token);
}

// Marks a prediction moot. Only an open prediction can be voided — a settled
// one keeps its recorded outcome, so a user cannot quietly delete a miss from
// their own track record.
export function voidPrediction(id: string, token?: string): Promise<{ id: string; status: string }> {
  return request(`/api/predictions/${id}/void`, { method: "POST" }, token);
}
