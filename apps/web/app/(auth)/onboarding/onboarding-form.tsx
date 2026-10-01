// apps/web/app/(auth)/onboarding/onboarding-form.tsx
// Three steps for a freshly authenticated user: name the workspace, add the
// first competitor (pre-filled from the landing page when there was one), and
// a short "what happens next". Errors render inline in each step.
"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Sig } from "@/components/brand/Sig";
import { Button, TextInput } from "@/components/ui/primitives";
import { addCompetitorByDomain } from "@/lib/add-competitor";
import type { Competitor } from "@/lib/api";
import { normalizeDomain } from "@/lib/domain";
import { clearPendingCompetitor, readPendingCompetitor } from "@/lib/pending-competitor";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const MAX_FIRST_COMPETITORS = 5;

type Step = 1 | 2 | 3;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Workspace" },
  { n: 2, label: "First competitor" },
  { n: 3, label: "Ready" },
];

export function OnboardingForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [added, setAdded] = useState<Competitor[]>([]);

  // A reload mid-setup lands here again after the workspace already exists;
  // creating it twice would fail, so resume at the competitor step.
  useEffect(() => {
    let cancelled = false;
    getSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (!cancelled && session && workspaceIdFromToken(session.access_token)) {
          setStep((current) => (current === 1 ? 2 : current));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function finish() {
    clearPendingCompetitor();
    router.push("/briefing");
    router.refresh();
  }

  return (
    <div>
      <ol className="mb-8 flex items-center gap-2" aria-label="Setup progress">
        {STEPS.map((s) => (
          <li key={s.n} className="flex items-center gap-2" aria-current={s.n === step ? "step" : undefined}>
            <span
              className={
                s.n < step
                  ? "flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-white"
                  : s.n === step
                    ? "flex h-7 w-7 items-center justify-center rounded-full bg-sun text-[13px] font-bold text-ink"
                    : "flex h-7 w-7 items-center justify-center rounded-full bg-surface-sunken text-[13px] font-bold text-ink-muted"
              }
            >
              {s.n}
            </span>
            <span className={s.n === step ? "text-[13px] font-semibold text-ink" : "hidden text-[13px] text-ink-muted sm:inline"}>
              {s.label}
            </span>
            {s.n < 3 ? <span className="mx-1 h-px w-5 bg-line-strong" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>

      {step === 1 ? <WorkspaceStep onDone={() => setStep(2)} /> : null}
      {step === 2 ? (
        <CompetitorStep
          added={added}
          onAdded={(competitor) => setAdded((list) => [...list, competitor])}
          onContinue={() => setStep(3)}
          onSkip={finish}
        />
      ) : null}
      {step === 3 ? <ReadyStep count={added.length} onFinish={finish} /> : null}
    </div>
  );
}

function workspaceIdFromToken(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { workspace_id?: unknown };
    return typeof payload.workspace_id === "string" ? payload.workspace_id : null;
  } catch {
    return null;
  }
}

function WorkspaceStep({ onDone }: { onDone: () => void }) {
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
    // The new workspace_id isn't in this session's JWT yet (the Custom Access
    // Token Hook stamps it at mint time) — refresh so later calls carry it.
    await supabase.auth.refreshSession();
    setPending(false);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink">
          Name your workspace
        </h1>
        <p className="mt-1.5 text-[15px] text-ink-secondary">Usually your company or team. You can rename it later.</p>
      </div>
      <TextInput label="Workspace name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      {error ? (
        <p role="alert" className="text-[14px] font-medium text-miss-text">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending || !name.trim()} className="w-full">
        Create workspace
      </Button>
    </form>
  );
}

function CompetitorStep({
  added,
  onAdded,
  onContinue,
  onSkip,
}: {
  added: Competitor[];
  onAdded: (competitor: Competitor) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const pendingDomain = readPendingCompetitor();
    if (pendingDomain) setValue(pendingDomain);
  }, []);

  const full = added.length >= MAX_FIRST_COMPETITORS;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const domain = normalizeDomain(value);
    if (!domain) {
      setError("Enter a company's website, like kestrel.dev");
      return;
    }
    if (added.some((c) => c.domain === domain)) {
      setError(`${domain} is already on the list.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const competitor = await addCompetitorByDomain(domain);
      onAdded(competitor);
      clearPendingCompetitor();
      setValue("");
    } catch {
      setError("Couldn't add that competitor. Check the website and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink">
          Who should Signal watch first?
        </h1>
        <p className="mt-1.5 text-[15px] text-ink-secondary">
          Their website is enough. Signal finds their job boards, docs, feeds and forums itself.
        </p>
      </div>

      {added.length > 0 ? (
        <ul className="space-y-2" aria-label="Competitors added">
          {added.map((competitor) => (
            <li key={competitor.id} className="flex items-center gap-3 rounded-[12px] bg-sky px-4 py-3">
              <Sig mood="happy" size={26} decorative />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{competitor.name}</span>
                <span className="block truncate text-[13px] text-ink-muted">{competitor.domain}</span>
              </span>
              <span className="text-[13px] font-semibold text-hit-text">Added</span>
            </li>
          ))}
        </ul>
      ) : null}

      {full ? null : (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
          <TextInput
            label="Competitor website"
            placeholder="competitor.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
          />
          {error ? (
            <p role="alert" className="text-[14px] font-medium text-miss-text">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant={added.length ? "secondary" : "primary"} size="lg" disabled={pending} className="w-full">
            {pending ? "Adding…" : added.length ? "Add another" : "Add competitor"}
          </Button>
        </form>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onSkip}>
          {added.length ? "Go to Home" : "Skip for now"}
        </Button>
        {added.length ? (
          <Button variant="primary" onClick={onContinue}>
            Continue
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ReadyStep({ count, onFinish }: { count: number; onFinish: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <Sig mood="happy" size={56} decorative />
      <div>
        <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink">
          Signal is on it.
        </h1>
        <p className="mt-2 text-[15px] text-ink-secondary">
          It&rsquo;s finding sources for {count === 1 ? "your competitor" : `your ${count} competitors`} now. Evidence
          starts arriving within hours. A forecast appears once enough independent sources agree, usually after a few
          days.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="lg" onClick={onFinish}>
          Go to Home
        </Button>
      </div>
    </div>
  );
}
