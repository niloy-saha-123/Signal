CREATE TABLE "company_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"doc_type" text,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"pinecone_namespace" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_documents_doc_type_check" CHECK ("company_documents"."doc_type" IS NULL OR "company_documents"."doc_type" IN ('pitch_deck', 'financials', 'website_snapshot', 'other')),
	CONSTRAINT "company_documents_extraction_status_check" CHECK ("company_documents"."extraction_status" IN ('pending', 'structured', 'embedded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "tracked_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"competitor_id" uuid,
	"relationship_type" text DEFAULT 'competitor' NOT NULL,
	"relationship_confidence" real,
	"source" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"candidate_name" text,
	"candidate_domain" text,
	"candidate_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_entities_relationship_type_check" CHECK ("tracked_entities"."relationship_type" IN ('competitor', 'aspirational', 'other')),
	CONSTRAINT "tracked_entities_source_check" CHECK ("tracked_entities"."source" IN ('user_added', 'discovered')),
	CONSTRAINT "tracked_entities_status_check" CHECK ("tracked_entities"."status" IN ('confirmed', 'candidate', 'dismissed')),
	CONSTRAINT "tracked_entities_competitor_id_when_confirmed_check" CHECK ("tracked_entities"."status" = 'candidate' OR "tracked_entities"."competitor_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "company_profile" ADD COLUMN "signal_goal" text;--> statement-breakpoint
ALTER TABLE "company_profile" ADD COLUMN "signal_goal_confidence" real;--> statement-breakpoint
ALTER TABLE "company_profile" ADD COLUMN "signal_goal_inferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_entities" ADD CONSTRAINT "tracked_entities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_entities" ADD CONSTRAINT "tracked_entities_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_documents_workspace_id_idx" ON "company_documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tracked_entities_workspace_id_idx" ON "tracked_entities" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tracked_entities_status_idx" ON "tracked_entities" USING btree ("workspace_id","status");