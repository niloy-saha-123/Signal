// Email/password + Google OAuth, for both log-in and sign-up. Errors render
// inline under the form so a failed attempt stays diagnosable without losing
// what was typed.
"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, TextInput } from "@/components/ui/primitives";
import { rememberPendingCompetitor } from "@/lib/pending-competitor";
import { getSafeNextPath } from "@/lib/safe-redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Mode = "login" | "signup";

const COPY: Record<Mode, { submit: string; switchText: string; switchLink: string; switchHref: string }> = {
  login: { submit: "Log in", switchText: "No account yet?", switchLink: "Sign up", switchHref: "/signup" },
  signup: { submit: "Sign up", switchText: "Have an account already?", switchLink: "Log in", switchHref: "/login" },
};

export function CredentialsForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const copy = COPY[mode];

  // A domain typed on the landing page rides along to onboarding.
  const domainParam = searchParams.get("domain");
  useEffect(() => {
    rememberPendingCompetitor(domainParam);
  }, [domainParam]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
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
      <Button onClick={handleGoogle} size="lg" className="w-full">
        <GoogleMark />
        Continue with Google
      </Button>
      <div className="flex items-center gap-3 text-[13px] text-ink-muted">
        <div className="h-px flex-1 bg-line" />
        or with email
        <div className="h-px flex-1 bg-line" />
      </div>
      <TextInput
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <TextInput
        label="Password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        minLength={mode === "signup" ? 6 : undefined}
      />
      {error ? (
        <p role="alert" className="text-[14px] font-medium text-miss-text">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
        {copy.submit}
      </Button>
      <p className="text-center text-[14px] text-ink-secondary">
        {copy.switchText}{" "}
        <Link href={copy.switchHref} className="font-semibold text-accent hover:underline">
          {copy.switchLink}
        </Link>
      </p>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" aria-hidden="true">
      <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z" />
      <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
      <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.5 1.4l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z" />
    </svg>
  );
}
