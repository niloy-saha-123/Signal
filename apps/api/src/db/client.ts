// Single shared Postgres connection pool + Drizzle instance. Every module that touches
// the database imports `db` from here rather than opening its own pg.Pool — one pool per
// process, not one per module.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { logger } from "../lib/logger";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Idle-client errors (dropped connection, backend restart) emit on the pool;
// with zero listeners, Node throws synchronously and crashes the process.
pool.on("error", (err) => logger.error("Unexpected pg pool error", { error: err }));

export const db = drizzle(pool, { schema });

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
