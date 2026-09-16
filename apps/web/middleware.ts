import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && !isPublic && pathname !== "/onboarding") {
    // workspace_id is a JWT access-token claim, not user metadata — Supabase
    // doesn't surface it on `user.app_metadata`, so it has to be read off the
    // session's access token directly.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const claims = session ? decodeJwtPayload(session.access_token) : null;
    if (!claims?.workspace_id) {
      return NextResponse.redirect(new URL("/onboarding", request.url));
    }
  }

  return response;
}

// Middleware runs on the Edge runtime — no `jose` JWKS verification needed
// here (that's Express/Socket.IO's job for actual API calls); middleware only
// needs to *read* the workspace_id claim to decide which page to show, not
// cryptographically verify it — Supabase's own getUser() call above already
// validated the session server-side.
function decodeJwtPayload(token: string): { workspace_id?: string } | null {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export const config = {
  // apps/web has no app/api routes of its own (all API calls go to apps/api's
  // Express server via NEXT_PUBLIC_API_URL) — nothing here needs excluding
  // beyond Next.js's own static/image internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
