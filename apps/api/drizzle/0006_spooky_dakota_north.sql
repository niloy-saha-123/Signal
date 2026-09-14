ALTER TABLE "agent_latencies" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_latencies" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "llm_costs" ADD COLUMN "job_id" text;--> statement-breakpoint
CREATE INDEX "agent_latencies_job_id_idx" ON "agent_latencies" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_runs_prompt_version_id_idx" ON "agent_runs" USING btree ("prompt_version_id");--> statement-breakpoint
CREATE INDEX "alerts_run_id_idx" ON "alerts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "llm_costs_run_id_idx" ON "llm_costs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "llm_costs_job_id_idx" ON "llm_costs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "pricing_diffs_baseline_id_idx" ON "pricing_diffs" USING btree ("baseline_id");--> statement-breakpoint
CREATE INDEX "rag_eval_dataset_competitor_id_idx" ON "rag_eval_dataset" USING btree ("competitor_id");--> statement-breakpoint
ALTER TABLE "agent_latencies" ADD CONSTRAINT "agent_latencies_identity_check" CHECK ("agent_latencies"."run_id" IS NOT NULL OR "agent_latencies"."job_id" IS NOT NULL);--> statement-breakpoint
DO $$
BEGIN
	IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
		EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC';
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
			EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon';
		END IF;
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
			EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated';
		END IF;
	END IF;
END
$$;
