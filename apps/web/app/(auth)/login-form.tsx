// apps/web/app/login/login-form.tsx
// Email/password + Google OAuth login. Errors render inline under the form (no toast lib
// exists in this codebase) so a failed login stays diagnosable without losing form state.
"use client";
import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getSafeNextPath } from "@/lib/safe-redirect";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function handleGoogle() {
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/briefing` },
    });
    if (error) setError(error.message);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-secondary">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-[14px] text-ink outline-none transition-shadow focus:border-accent focus:ring-3 focus:ring-[var(--color-accent-tint)]"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-secondary">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-[14px] text-ink outline-none transition-shadow focus:border-accent focus:ring-3 focus:ring-[var(--color-accent-tint)]"
        />
      </label>
      {error ? (
        <p role="alert" className="text-[13px] text-[var(--color-status-critical)]">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        Log in
      </button>
      <div className="flex items-center gap-3 text-[12px] text-ink-muted">
        <div className="h-px flex-1 bg-line" />
        or
        <div className="h-px flex-1 bg-line" />
      </div>
      <button
        type="button"
        onClick={handleGoogle}
        className="rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-surface-sunken"
      >
        Continue with Google
      </button>
      <p className="text-center text-[13px] text-ink-muted">
        No account yet?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
