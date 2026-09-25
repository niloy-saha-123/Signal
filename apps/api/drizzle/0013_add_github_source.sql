ALTER TABLE "signals" DROP CONSTRAINT "signals_source_check";--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "github_org" text;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_check" CHECK ("signals"."source" IN ('reddit', 'hn', 'jobs', 'changelog', 'pricing', 'github'));