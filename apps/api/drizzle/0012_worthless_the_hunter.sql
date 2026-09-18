CREATE TABLE "company_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_goals_created_by_check" CHECK ("company_goals"."created_by" IN ('user', 'agent')),
	CONSTRAINT "company_goals_status_check" CHECK ("company_goals"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "company_goals" ADD CONSTRAINT "company_goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_goals_workspace_id_idx" ON "company_goals" USING btree ("workspace_id");