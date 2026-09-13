CREATE TABLE "signal_pipeline_outbox" (
	"signal_id" uuid PRIMARY KEY NOT NULL,
	"stage" text DEFAULT 'entity_extraction' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_pipeline_outbox_stage_check" CHECK ("signal_pipeline_outbox"."stage" IN ('entity_extraction', 'quality_scoring', 'deduplication'))
);
--> statement-breakpoint
ALTER TABLE "signal_pipeline_outbox" ADD CONSTRAINT "signal_pipeline_outbox_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_pipeline_outbox_created_at_idx" ON "signal_pipeline_outbox" USING btree ("created_at");--> statement-breakpoint
-- Establish the outbox invariant for signals that predate this table. Starting
-- at entity extraction is deliberately conservative: populated entity JSON is
-- skipped by the processor, scoring is deterministic, and Pinecone upsert uses
-- the signal UUID, so every path is replay-safe while previously stranded rows
-- become recoverable in bounded scheduler batches.
INSERT INTO "signal_pipeline_outbox" ("signal_id", "stage")
SELECT "id", 'entity_extraction'
FROM "signals"
ON CONFLICT ("signal_id") DO NOTHING;
