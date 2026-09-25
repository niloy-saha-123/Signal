CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"run_id" uuid,
	"statement" text NOT NULL,
	"pattern_type" text NOT NULL,
	"probability" real NOT NULL,
	"resolution_criteria" jsonb NOT NULL,
	"horizon_days" integer NOT NULL,
	"resolves_at" timestamp with time zone NOT NULL,
	"evidence_signal_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"evidence_count" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"resolution_evidence_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"brier_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "predictions_probability_check" CHECK ("predictions"."probability" >= 0.05 AND "predictions"."probability" <= 0.95),
	CONSTRAINT "predictions_horizon_days_check" CHECK ("predictions"."horizon_days" > 0),
	CONSTRAINT "predictions_evidence_count_check" CHECK ("predictions"."evidence_count" >= 0),
	CONSTRAINT "predictions_status_check" CHECK ("predictions"."status" IN ('open', 'hit', 'miss', 'unresolved', 'void')),
	CONSTRAINT "predictions_brier_score_check" CHECK ("predictions"."brier_score" IS NULL OR ("predictions"."brier_score" >= 0 AND "predictions"."brier_score" <= 1))
);
--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "predictions_workspace_status_resolves_idx" ON "predictions" USING btree ("workspace_id","status","resolves_at");--> statement-breakpoint
CREATE INDEX "predictions_competitor_created_idx" ON "predictions" USING btree ("competitor_id","created_at");--> statement-breakpoint
CREATE INDEX "predictions_workspace_status_idx" ON "predictions" USING btree ("workspace_id","status");