ALTER TABLE "company_profile" ADD COLUMN "singleton" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_latencies_created_at_idx" ON "agent_latencies" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_profile_singleton_idx" ON "company_profile" USING btree ("singleton");--> statement-breakpoint
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_singleton_check" CHECK ("company_profile"."singleton" = true);