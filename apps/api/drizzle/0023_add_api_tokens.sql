SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_name_check" CHECK (char_length("api_tokens"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_workspace_id_idx" ON "api_tokens" USING btree ("workspace_id");--> statement-breakpoint
-- Service role only: RLS on with no policies denies the anon/authenticated roles.
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;
