// Reusable database query functions abstracting raw SQL away from agent and API layers.
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema.js";
import { competitors } from "./schema.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function getCompetitorById(id: number) {
  const rows = await db.select().from(competitors).where(eq(competitors.id, id)).limit(1);
  return rows[0] ?? null;
}
