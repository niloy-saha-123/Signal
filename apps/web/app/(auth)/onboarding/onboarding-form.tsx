// apps/web/app/onboarding/onboarding-form.tsx
// Creates the first workspace for a freshly authenticated user. Errors render inline (same
// convention as LoginForm/SignupForm — no toast lib exists in this codebase).
"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("Session expired — please log in again.");
      setPending(false);
      return;
    }
    const res = await fetch(`${API_BASE}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError("Could not create your workspace — try again.");
      setPending(false);
      return;
    }
    // The just-created workspace_id isn't in this session's JWT yet (the Custom Access Token
    // Hook stamps it at token *mint* time) — force a refresh so the next request/page load
    // carries the updated claim.
    await supabase.auth.refreshSession();
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Workspace name
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
      >
        Create workspace
      </button>
    </form>
  );
}
