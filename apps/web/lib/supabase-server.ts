import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getServerAccessToken(): Promise<string | undefined> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token;
}

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component with no response to attach cookies
            // to — middleware.ts (Task 13) is the one place that actually
            // refreshes the session cookie, so this is safe to ignore here.
          }
        },
      },
    }
  );
}
