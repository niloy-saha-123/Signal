SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- Plain (not CONCURRENTLY): drizzle runs each migration in a transaction.
-- Blocks signal writes while it builds; signals is empty on Supabase today.
CREATE UNIQUE INDEX "signals_competitor_source_url_idx" ON "signals" USING btree ("competitor_id","source","source_url") WHERE "signals"."source" NOT IN ('pricing', 'website');--> statement-breakpoint
-- Same RLS guard as 0018: only tables still lacking RLS are altered.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
