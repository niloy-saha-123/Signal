export type TelemetryIdentity =
  | { kind: "run"; runId: string }
  | { kind: "job"; jobId: string }
  | { kind: "unattributed" };

export interface TelemetryContext {
  competitorId: string | null;
  identity: TelemetryIdentity;
}

export interface LatencyTelemetryContext extends Omit<TelemetryContext, "competitorId" | "identity"> {
  competitorId: string;
  identity: Exclude<TelemetryIdentity, { kind: "unattributed" }>;
}

export function telemetryIdentityColumns(identity: TelemetryIdentity): {
  run_id: string | null;
  job_id: string | null;
} {
  if (!identity || typeof identity !== "object") {
    throw new Error("Telemetry identity is required");
  }
  if (identity.kind === "run" && identity.runId.trim()) {
    return { run_id: identity.runId, job_id: null };
  }
  if (identity.kind === "job" && identity.jobId.trim()) {
    return { run_id: null, job_id: identity.jobId };
  }
  if (identity.kind === "unattributed") {
    return { run_id: null, job_id: null };
  }
  throw new Error("Telemetry identity must contain a non-empty runId or jobId");
}
