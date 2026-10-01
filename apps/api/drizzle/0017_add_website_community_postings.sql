CREATE TABLE "website_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"url" text NOT NULL,
	"content" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signals" DROP CONSTRAINT "signals_source_check";--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "website_urls" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "discourse_url" text;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "postings_rss" text;--> statement-breakpoint
ALTER TABLE "website_snapshots" ADD CONSTRAINT "website_snapshots_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "website_snapshots_competitor_url_idx" ON "website_snapshots" USING btree ("competitor_id","url");--> statement-breakpoint
-- NOT VALID skips re-scanning every existing signal under the ACCESS EXCLUSIVE
-- lock taken above. Safe because the new list is a strict superset of the old
-- one: every existing row already passed the narrower check. New rows are
-- checked as normal.
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_check" CHECK ("signals"."source" IN ('reddit', 'hn', 'jobs', 'changelog', 'pricing', 'github', 'website', 'community', 'postings')) NOT VALID;