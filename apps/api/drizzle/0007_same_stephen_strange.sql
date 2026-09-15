CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_role_check" CHECK ("workspace_members"."role" IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_profile" DROP CONSTRAINT "company_profile_singleton_check";--> statement-breakpoint
DROP INDEX "company_profile_singleton_idx";--> statement-breakpoint
DROP INDEX "competitors_domain_idx";--> statement-breakpoint
ALTER TABLE "company_profile" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
-- competitors/company_profile predate the workspace model and may already
-- carry rows in dev — backfill them into a single default workspace before
-- the NOT NULL constraint lands below, so this migration applies cleanly
-- whether or not those tables are empty.
DO $$
DECLARE
	default_workspace_id uuid;
BEGIN
	IF EXISTS (SELECT 1 FROM "competitors" WHERE "workspace_id" IS NULL)
		OR EXISTS (SELECT 1 FROM "company_profile" WHERE "workspace_id" IS NULL) THEN
		INSERT INTO "workspaces" ("name", "owner_id")
		VALUES ('Default Workspace', gen_random_uuid())
		RETURNING "id" INTO default_workspace_id;

		UPDATE "competitors" SET "workspace_id" = default_workspace_id WHERE "workspace_id" IS NULL;
		UPDATE "company_profile" SET "workspace_id" = default_workspace_id WHERE "workspace_id" IS NULL;
	END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "company_profile" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_token_idx" ON "workspace_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "workspace_invites_workspace_id_idx" ON "workspace_invites" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_user_id_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_workspace_id_idx" ON "workspace_members" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_profile_workspace_idx" ON "company_profile" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_workspace_domain_idx" ON "competitors" USING btree ("workspace_id","domain");--> statement-breakpoint
ALTER TABLE "company_profile" DROP COLUMN "singleton";--> statement-breakpoint
-- Stamps workspace_id into the JWT at sign-in so Express/Socket.IO middleware
-- and every query function can read it without an extra DB round-trip.
-- Must also be registered in Supabase Dashboard → Authentication → Hooks →
-- Custom Access Token → point at public.custom_access_token_hook (dashboard-only
-- config, not expressible in SQL — do this manually after applying the migration).
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  ws_id uuid;
BEGIN
  SELECT workspace_id INTO ws_id
  FROM public.workspace_members
  WHERE user_id = (event->>'user_id')::uuid
  LIMIT 1;

  claims := event->'claims';
  IF ws_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{workspace_id}', to_jsonb(ws_id::text));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
