// Winston logger configured with job_id/run_id correlation.
import winston from "winston";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// Returns a child logger that stamps job_id/run_id on every log line it emits —
// use inside a BullMQ worker or agent run so every log from that execution is
// correlatable back to the job/run that produced it.
export function withCorrelation(jobId: string, runId: string): winston.Logger {
  const child = logger.child({ job_id: jobId, run_id: runId });
  child.defaultMeta = { job_id: jobId, run_id: runId };
  return child;
}
