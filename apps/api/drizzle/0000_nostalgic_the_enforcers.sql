CREATE TABLE "agent_latencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"model_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_latencies_agent_name_check" CHECK ("agent_latencies"."agent_name" IN ('intent_analyzer', 'sentiment_clusterer', 'change_detector', 'pattern_detector', 'vulnerability_detector', 'synthesis', 'chat_agent', 'quality_scorer', 'deduplicator', 'entity_extractor')),
	CONSTRAINT "agent_latencies_status_check" CHECK ("agent_latencies"."status" IN ('success', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"prompt_version_id" uuid,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"outcome" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_trigger_check" CHECK ("agent_runs"."trigger" IN ('scheduled', 'manual', 'backfill')),
	CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" IN ('running', 'completed', 'failed')),
	CONSTRAINT "agent_runs_outcome_check" CHECK ("agent_runs"."outcome" IS NULL OR "agent_runs"."outcome" IN ('alert', 'digest', 'suppress'))
);
--> statement-breakpoint
CREATE TABLE "agent_test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"expected_output" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"run_id" uuid,
	"pattern" text NOT NULL,
	"confidence" real NOT NULL,
	"evidence" jsonb NOT NULL,
	"interpretation" text NOT NULL,
	"vulnerability_window_days" integer,
	"recommended_actions" jsonb NOT NULL,
	"supporting_cluster_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_confidence_check" CHECK ("alerts"."confidence" >= 0 AND "alerts"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "circuit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circuit_events_state_check" CHECK ("circuit_events"."state" IN ('closed', 'open', 'half_open'))
);
--> statement-breakpoint
CREATE TABLE "competitor_signal_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"components" jsonb NOT NULL,
	"delta_7d" real,
	"delta_30d" real,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_signal_scores_score_check" CHECK ("competitor_signal_scores"."score" >= 0 AND "competitor_signal_scores"."score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"subreddits" text[] DEFAULT '{}'::text[] NOT NULL,
	"greenhouse_token" text,
	"lever_token" text,
	"pricing_url" text,
	"changelog_rss" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"competitor_id" uuid,
	"agent_name" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"baseline_id" uuid NOT NULL,
	"diff" jsonb NOT NULL,
	"significance" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_diffs_significance_check" CHECK ("pricing_diffs"."significance" IN ('minor', 'moderate', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_name" text NOT NULL,
	"version" integer NOT NULL,
	"prompt_text" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"accuracy" real,
	"promoted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_eval_dataset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"expected_answer" text NOT NULL,
	"supporting_chunk_ids" text[],
	"competitor_id" uuid,
	"category" text NOT NULL,
	"confidence_level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"last_faithfulness_score" real,
	CONSTRAINT "rag_eval_dataset_category_check" CHECK ("rag_eval_dataset"."category" IN ('pricing_history', 'hiring_pattern', 'product_change', 'sentiment_theme', 'strategic_move', 'general')),
	CONSTRAINT "rag_eval_dataset_confidence_level_check" CHECK ("rag_eval_dataset"."confidence_level" IN ('high', 'medium', 'low'))
);
--> statement-breakpoint
CREATE TABLE "rag_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_questions" integer NOT NULL,
	"passed" integer NOT NULL,
	"failed" integer NOT NULL,
	"faithfulness_score" real NOT NULL,
	"threshold" real NOT NULL,
	"ci_triggered" boolean DEFAULT false NOT NULL,
	"git_commit" text,
	"results" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"canonical_summary" text NOT NULL,
	"contributing_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"corroboration_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"title" text,
	"raw_text" text NOT NULL,
	"quality_score" real DEFAULT 0 NOT NULL,
	"entities" jsonb DEFAULT '{}'::jsonb,
	"cluster_id" uuid,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_source_check" CHECK ("signals"."source" IN ('reddit', 'hn', 'jobs', 'changelog', 'pricing')),
	CONSTRAINT "signals_quality_score_check" CHECK ("signals"."quality_score" >= 0 AND "signals"."quality_score" <= 1)
);
--> statement-breakpoint
ALTER TABLE "agent_latencies" ADD CONSTRAINT "agent_latencies_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_signal_scores" ADD CONSTRAINT "competitor_signal_scores_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_costs" ADD CONSTRAINT "llm_costs_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_costs" ADD CONSTRAINT "llm_costs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_baselines" ADD CONSTRAINT "pricing_baselines_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_diffs" ADD CONSTRAINT "pricing_diffs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_diffs" ADD CONSTRAINT "pricing_diffs_baseline_id_pricing_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."pricing_baselines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_dataset" ADD CONSTRAINT "rag_eval_dataset_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_clusters" ADD CONSTRAINT "signal_clusters_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_cluster_id_signal_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."signal_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_latencies_run_id_idx" ON "agent_latencies" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_latencies_agent_created_idx" ON "agent_latencies" USING btree ("agent_name","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_competitor_started_idx" ON "agent_runs" USING btree ("competitor_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_test_cases_agent_name_idx" ON "agent_test_cases" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX "alerts_competitor_created_idx" ON "alerts" USING btree ("competitor_id","created_at");--> statement-breakpoint
CREATE INDEX "circuit_events_service_occurred_idx" ON "circuit_events" USING btree ("service","occurred_at");--> statement-breakpoint
CREATE INDEX "competitor_signal_scores_competitor_computed_idx" ON "competitor_signal_scores" USING btree ("competitor_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_domain_idx" ON "competitors" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "competitors_is_active_idx" ON "competitors" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "llm_costs_competitor_created_idx" ON "llm_costs" USING btree ("competitor_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_costs_agent_name_idx" ON "llm_costs" USING btree ("agent_name");--> statement-breakpoint
CREATE INDEX "pricing_baselines_competitor_captured_idx" ON "pricing_baselines" USING btree ("competitor_id","captured_at");--> statement-breakpoint
CREATE INDEX "pricing_diffs_competitor_detected_idx" ON "pricing_diffs" USING btree ("competitor_id","detected_at");--> statement-breakpoint
CREATE INDEX "pricing_diffs_critical_idx" ON "pricing_diffs" USING btree ("detected_at") WHERE "pricing_diffs"."significance" = 'critical';--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_agent_version_idx" ON "prompt_versions" USING btree ("agent_name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_one_active_per_agent_idx" ON "prompt_versions" USING btree ("agent_name") WHERE "prompt_versions"."is_active" = true;--> statement-breakpoint
CREATE INDEX "signal_clusters_competitor_id_idx" ON "signal_clusters" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "signal_clusters_competitor_last_updated_idx" ON "signal_clusters" USING btree ("competitor_id","last_updated");--> statement-breakpoint
CREATE INDEX "signals_competitor_id_idx" ON "signals" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "signals_created_at_idx" ON "signals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "signals_quality_score_idx" ON "signals" USING btree ("quality_score");--> statement-breakpoint
CREATE INDEX "signals_cluster_id_idx" ON "signals" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "signals_competitor_source_created_idx" ON "signals" USING btree ("competitor_id","source","created_at");