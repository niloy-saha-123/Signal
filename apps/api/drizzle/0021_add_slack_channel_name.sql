SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "slack_installations" ADD COLUMN "default_channel_name" text;--> statement-breakpoint
-- Same RLS guard as 0018: only tables still lacking RLS are altered.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
