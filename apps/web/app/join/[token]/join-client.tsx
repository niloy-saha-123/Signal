// Redeems a workspace invite. A logged-out visitor is prompted to log in/sign up (preserving
// this URL via ?next=); a logged-in visitor auto-joins on mount.
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "../../../lib/supabase-browser";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Status = "checking" | "joining" | "invalid" | "needs-auth";

export function JoinClient({ token }: { token: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setStatus("needs-auth");
        return;
      }
      if (!cancelled) setStatus("joining");
      const res = await fetch(`${API_BASE}/api/workspaces/join/${token}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (cancelled) return;
      if (!res.ok) {
        setStatus("invalid");
        return;
      }
      // Same reason as OnboardingForm: workspace_id isn't in this session's JWT until the
      // token is re-minted, so force a refresh before navigating home.
      await supabase.auth.refreshSession();
      router.push("/");
      router.refresh();
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (status === "needs-auth") {
    return (
      <p className="text-center text-sm text-slate-700">
        Log in or sign up to join this workspace —{" "}
        <Link href={`/login?next=/join/${token}`} className="font-medium text-indigo-600">
          Log in
        </Link>{" "}
        ·{" "}
        <Link href={`/signup?next=/join/${token}`} className="font-medium text-indigo-600">
          Sign up
        </Link>
      </p>
    );
  }

  if (status === "invalid") {
    return (
      <p role="alert" className="text-center text-sm text-red-600">
        This invite is no longer valid.
      </p>
    );
  }

  return <p className="text-center text-sm text-slate-500">Joining…</p>;
}
