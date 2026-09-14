// Single shared Postgres connection pool + Drizzle instance. Every module that touches
// the database imports `db` from here rather than opening its own pg.Pool — one pool per
// process, not one per module.
import { existsSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { logger } from "../lib/logger";

// Every entrypoint (API server, worker, scripts) imports this module before
// touching process.env.DATABASE_URL, so loading the repo-root .env here once
// covers all of them. A real environment variable (CI, prod) always wins —
// loadEnvFile never overwrites an already-set process.env key.
const rootEnvPath = path.resolve(__dirname, "../../../../.env");
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

// Bound connection acquisition so infrastructure probes and application work
// cannot queue forever behind an unreachable database.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 2_000,
});

// Idle-client errors (dropped connection, backend restart) emit on the pool;
// with zero listeners, Node throws synchronously and crashes the process.
pool.on("error", (err) => logger.error("Unexpected pg pool error", { error: err }));

export const db = drizzle(pool, { schema });

export interface ReadinessProbeOptions {
  timeoutMs: number;
  signal: AbortSignal;
}

export async function checkDatabaseReadiness({
  timeoutMs,
  signal,
}: ReadinessProbeOptions): Promise<void> {
  signal.throwIfAborted();
  let removeAbortListener = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("readiness check aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    // query_timeout bounds a query after pool acquisition; the pool-level
    // connection timeout independently bounds acquisition/connection setup.
    // pg supports query_timeout at runtime even though @types/pg omits it from
    // QueryConfig; a named structurally compatible value avoids an unsafe cast.
    const readinessQuery = { text: "select 1", query_timeout: timeoutMs };
    await Promise.race([pool.query(readinessQuery), aborted]);
  } finally {
    removeAbortListener();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
