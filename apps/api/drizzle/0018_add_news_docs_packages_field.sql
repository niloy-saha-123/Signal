SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "signals" DROP CONSTRAINT "signals_source_check";--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "news_query" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "docs_sitemap_url" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "npm_packages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "pypi_packages" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- NOT VALID skips re-scanning every existing signal under the ACCESS EXCLUSIVE
-- lock taken above. Safe because the new list is a strict superset of the old
-- one: every existing row already passed the narrower check.
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_check" CHECK ("signals"."source" IN ('reddit', 'hn', 'jobs', 'changelog', 'pricing', 'github', 'website', 'community', 'postings', 'news', 'docs', 'packages', 'field')) NOT VALID;--> statement-breakpoint
-- Supabase runs every public table with RLS on and no policies (deny-all for
-- PostgREST; the API connects directly as the table owner, which RLS does not
-- apply to without FORCE). This makes a database built from drizzle/ match.
-- Only tables still lacking RLS are altered (and so locked); where RLS is
-- already on everywhere this is a no-op. The lock_timeout at the top makes a
-- long-running transaction fail this migration instead of queueing all
-- traffic behind its lock request.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
