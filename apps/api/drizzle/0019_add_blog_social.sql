SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "signals" DROP CONSTRAINT "signals_source_check";--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "blog_feeds" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "social_feeds" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "forum_feeds" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "bluesky_handle" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "stackoverflow_tag" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "links_scanned_at" timestamp with time zone;--> statement-breakpoint
-- NOT VALID: strict superset of the old list, so existing rows already pass.
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_check" CHECK ("signals"."source" IN ('reddit', 'hn', 'jobs', 'changelog', 'pricing', 'github', 'website', 'community', 'postings', 'news', 'docs', 'packages', 'field', 'blog', 'social')) NOT VALID;--> statement-breakpoint
-- Same RLS guard as 0018: only tables still lacking RLS are altered.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
