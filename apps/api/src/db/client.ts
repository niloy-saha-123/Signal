// Single shared Postgres connection pool + Drizzle instance. Every module that touches
// the database imports `db` from here rather than opening its own pg.Pool — one pool per
// process, not one per module.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
