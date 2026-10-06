SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "submitted_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_id_workspace_id_idx" ON "predictions" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "prediction_roadmap_links" DROP CONSTRAINT "prediction_roadmap_links_prediction_id_predictions_id_fk";--> statement-breakpoint
ALTER TABLE "prediction_roadmap_links" ADD CONSTRAINT "prediction_roadmap_links_prediction_workspace_fk" FOREIGN KEY ("prediction_id","workspace_id") REFERENCES "public"."predictions"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DELETE FROM "prediction_roadmap_links" a USING "prediction_roadmap_links" b WHERE a."prediction_id" = b."prediction_id" AND a."url" = b."url" AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX "prediction_roadmap_links_prediction_url_idx" ON "prediction_roadmap_links" USING btree ("prediction_id","url");--> statement-breakpoint
DROP INDEX "prediction_roadmap_links_prediction_id_idx";--> statement-breakpoint
CREATE INDEX "prediction_roadmap_links_workspace_id_idx" ON "prediction_roadmap_links" USING btree ("workspace_id");
