CREATE TABLE "company_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_description" text NOT NULL,
	"icp_company_size" text,
	"icp_industries" text[] DEFAULT '{}'::text[] NOT NULL,
	"icp_buyer_role" text,
	"pricing_tiers" jsonb DEFAULT '[]'::jsonb,
	"key_differentiators" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_competitor_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_discovery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"attempted_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"discovered_value" text,
	"status" text NOT NULL,
	"error_message" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_discovery_log_field_name_check" CHECK ("competitor_discovery_log"."field_name" IN ('subreddits', 'greenhouse', 'lever', 'pricing_url', 'rss_url')),
	CONSTRAINT "competitor_discovery_log_status_check" CHECK ("competitor_discovery_log"."status" IN ('found', 'not_found', 'error'))
);
--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "discovery_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "discovered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitor_discovery_log" ADD CONSTRAINT "competitor_discovery_log_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_discovery_log_competitor_id_idx" ON "competitor_discovery_log" USING btree ("competitor_id");--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_discovery_status_check" CHECK ("competitors"."discovery_status" IN ('pending', 'in_progress', 'complete', 'failed'));