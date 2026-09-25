process.loadEnvFile("../../.env");
const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(async () => {
    const t = await c.query("SELECT to_regclass('public.company_goals') AS tbl");
    console.log("company_goals table:", t.rows[0].tbl);
    const cols = await c.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='company_goals' ORDER BY ordinal_position"
    );
    console.log("columns:", cols.rows.map((r) => r.column_name).join(", "));
    const m = await c.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at"
    );
    console.log("tracked hashes:", m.rows.map((r) => r.hash.slice(0, 12)).join(", "));
    await c.end();
  })
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  });
