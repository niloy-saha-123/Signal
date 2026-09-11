ALTER TABLE "competitor_signal_scores" ADD COLUMN "day" date GENERATED ALWAYS AS (("computed_at" AT TIME ZONE 'UTC')::date) STORED;--> statement-breakpoint
-- Preserve the newest score if pre-migration retries already created more
-- than one row for the same competitor and UTC day. Without this cleanup the
-- following unique index can fail during rollout on an otherwise valid DB.
DELETE FROM "competitor_signal_scores" AS older
USING "competitor_signal_scores" AS newer
WHERE older."competitor_id" = newer."competitor_id"
  AND older."day" = newer."day"
  AND (
    older."computed_at" < newer."computed_at"
    OR (older."computed_at" = newer."computed_at" AND older."id" < newer."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_signal_scores_competitor_day_uidx" ON "competitor_signal_scores" USING btree ("competitor_id","day");
