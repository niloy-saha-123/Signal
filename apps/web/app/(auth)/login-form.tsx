// apps/web/app/login/login-form.tsx
// Email/password + Google OAuth login. Errors render inline under the form (no toast lib
// exists in this codebase) so a failed login stays diagnosable without losing form state.
"use client";
import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
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
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) setError(error.message);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-studio-muted">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="rounded-md border border-studio-line px-3 py-2 text-sm text-studio-ink outline-none focus:border-studio-action"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-studio-muted">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="rounded-md border border-studio-line px-3 py-2 text-sm text-studio-ink outline-none focus:border-studio-action"
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
        className="rounded-md bg-studio-action px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-studio-action-hover disabled:opacity-50"
      >
        Log in
      </button>
      <div className="flex items-center gap-3 text-xs text-studio-muted">
        <div className="h-px flex-1 bg-studio-line" />
        or
        <div className="h-px flex-1 bg-studio-line" />
      </div>
      <button
        type="button"
        onClick={handleGoogle}
        className="rounded-md border border-studio-line px-4 py-2 text-sm font-medium text-studio-ink transition-colors hover:bg-studio-sky-soft"
      >
        Continue with Google
      </button>
      <p className="text-center text-sm text-studio-muted">
        No account yet?{" "}
        <Link href="/signup" className="font-medium text-studio-action">
          Sign up
        </Link>
      </p>
    </form>
  );
}
