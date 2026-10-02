SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "prediction_roadmap_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prediction_id" uuid NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"stance" text DEFAULT 'watching' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_roadmap_links_title_check" CHECK (char_length("prediction_roadmap_links"."title") BETWEEN 1 AND 200),
	CONSTRAINT "prediction_roadmap_links_url_check" CHECK ("prediction_roadmap_links"."url" ~* '^https?://' AND char_length("prediction_roadmap_links"."url") <= 2000),
	CONSTRAINT "prediction_roadmap_links_stance_check" CHECK ("prediction_roadmap_links"."stance" IN ('accelerate', 'deprioritize', 'watching'))
);
--> statement-breakpoint
ALTER TABLE "prediction_roadmap_links" ADD CONSTRAINT "prediction_roadmap_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_roadmap_links" ADD CONSTRAINT "prediction_roadmap_links_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prediction_roadmap_links_prediction_id_idx" ON "prediction_roadmap_links" USING btree ("prediction_id");--> statement-breakpoint
-- Same RLS guard as 0018: only tables still lacking RLS are altered.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
