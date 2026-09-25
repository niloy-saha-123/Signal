import type { Metadata } from "next";
import Link from "next/link";

import { SignalMark } from "@/components/landing/SignalMark";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SignalTrace } from "@/components/landing/SignalTrace";
import { ProductWindow } from "@/components/landing/ProductWindow";
import { Bento } from "@/components/landing/Bento";

export const metadata: Metadata = {
  title: "Signal — Know what your competitors ship before they announce it",
  description:
    "Signal reads the public trail competitors leave — code, hiring, pricing, their own site and community — writes down what it expects them to do next, and scores itself when the date arrives.",
};

// Every claim on this page is one the product actually makes. No customer
// logos, no testimonials, no user counts, no accuracy figures — none exist yet,
// and a forecasting product caught overstating its own record on its own
// homepage has destroyed the only thing it sells. Product views use fictional
// companies and are labelled as examples.

const PIPELINE = [
  {
    n: "01",
    title: "Collect",
    body: "Nine public sources per competitor, on a schedule. Deduplicated, so ten retellings of one story count once.",
  },
  {
    n: "02",
    title: "Cluster",
    body: "Related evidence becomes one event with a quality score, instead of nine alerts about the same thing.",
  },
  {
    n: "03",
    title: "Predict",
    body: "Above an evidence floor, a dated claim with a probability and machine-checkable criteria. Below it, silence.",
  },
  {
    n: "04",
    title: "Resolve",
    body: "On the date, plain code checks the claim against what was collected. Hit, miss, or unresolved — all recorded.",
  },
];

// Grouped by *when* each source tends to move relative to an announcement,
// which is the property that actually matters for forecasting.
const SOURCE_GROUPS = [
  {
    timing: "Leading",
    note: "Moves before anything is announced",
    tint: "var(--color-tint-teal)",
    sources: [
      { name: "GitHub", detail: "Releases, pull requests, brand-new repositories" },
      { name: "Job boards", detail: "Greenhouse and Lever postings, as deltas" },
      { name: "Their website", detail: "Homepage and product copy, diffed daily" },
    ],
  },
  {
    timing: "Confirming",
    note: "Moves as the change goes public",
    tint: "var(--color-tint-sky)",
    sources: [
      { name: "Changelogs", detail: "RSS and Atom feeds, full text" },
      { name: "Newsroom posts", detail: "Press and announcement feeds" },
      { name: "Pricing pages", detail: "Structured diffs against a baseline" },
    ],
  },
  {
    timing: "Reacting",
    note: "Moves as the market responds",
    tint: "var(--color-tint-sand)",
    sources: [
      { name: "Community forums", detail: "Their own Discourse and discussions" },
      { name: "Hacker News", detail: "Weighted higher in pattern detection" },
      { name: "Reddit", detail: "Discovered subreddits per competitor" },
    ],
  },
];

const COMPARISON = [
  ["What you get", "A stream of things that changed", "Dated predictions, each with a probability"],
  ["Who it is for", "A sales rep, mid-call", "A product lead, at planning time"],
  ["On a quiet day", "Still sends something", "Says nothing"],
  ["When it is wrong", "Nobody finds out", "The miss is recorded and scored"],
  ["Where it looks", "Marketing surfaces", "Code, hiring, pricing, community, their own site"],
];

const QUESTIONS = [
  {
    q: "How accurate is it?",
    a: "There is no published accuracy figure yet, deliberately. Predictions have to reach their resolution date before a score means anything, and a number produced before then would be noise presented as evidence. Your workspace shows its own running score, against the coin-flip baseline, as soon as predictions start resolving.",
  },
  {
    q: "Why does it make so few predictions?",
    a: "Because every one is checked later. Below an evidence floor of five distinct signal clusters the forecaster does not call the model at all. A model handed four signals will still produce three confident-sounding forecasts, so the only reliable defence is not to ask.",
  },
  {
    q: "Who decides whether a prediction came true?",
    a: "Code, not a model. A model asked whether it was right tends to find a way to say yes. The resolver matches the prediction's written criteria against evidence actually collected; a model only writes the explanation, after the verdict is fixed.",
  },
  {
    q: "Can the assistant change things in my workspace?",
    a: "It can propose to — add a competitor, start an analysis, void a prediction — but anything that writes or spends waits for you to approve it. It also declines questions outside your competitive market rather than improvising an answer.",
  },
  {
    q: "What do I need to get started?",
    a: "A competitor's name and domain. Signal finds its GitHub organisation, job boards, changelog, pricing page, website and community on its own, and asks before it tracks anything it discovered.",
  },
];

function TwoTone({ lead, rest }: { lead: string; rest: string }) {
  return (
    <>
      {lead} <span className="text-ink-muted">{rest}</span>
    </>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-ground text-ink">
      {/* Announcement. Only ever something that has fully shipped. */}
      <a
        href="#sources"
        className="block border-b border-[var(--color-accent-line)] bg-[var(--color-tint-teal)] px-4 py-2 text-center text-[12.5px] text-ink-secondary transition-colors hover:text-ink"
      >
        <span className="mr-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
          New
        </span>
        Code is now a source — pull requests and releases, read weeks before the launch post
        <span aria-hidden="true" className="ml-1 text-accent">
          &rarr;
        </span>
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-ground/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="Signal home">
            <SignalMark />
          </Link>
          <nav className="flex items-center gap-1" aria-label="Site">
            {[
              ["#how", "How it works"],
              ["#capabilities", "Capabilities"],
              ["#sources", "Sources"],
              ["#questions", "Questions"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="hidden rounded-md px-3 py-2 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink md:inline-flex"
              >
                {label}
              </a>
            ))}
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="ml-1 inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Start tracking
            </Link>
          </nav>
        </div>
      </header>

      <main className="rails">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="grid-backdrop absolute inset-0" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
            style={{
              background:
                "radial-gradient(closest-side, var(--color-tint-teal), transparent), radial-gradient(closest-side at 70% 40%, var(--color-tint-sky), transparent)",
            }}
          />

          <div className="relative mx-auto max-w-6xl px-5 pt-16 sm:px-8 sm:pt-24">
            <div className="max-w-4xl">
              <p
                className="rise-in mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-accent-line)] bg-surface/70 px-3 py-1 text-[12px] font-medium text-accent backdrop-blur"
                style={{ animationDelay: "40ms" }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Competitive intelligence for teams building developer tools
              </p>

              <h1
                className="rise-in text-[clamp(2.5rem,6vw,4.75rem)] leading-[0.98] font-semibold tracking-[-0.04em] text-balance text-ink"
                style={{ animationDelay: "120ms" }}
              >
                Know what your competitors ship before they announce it.
              </h1>

              <p
                className="rise-in mt-7 max-w-2xl text-[18px] leading-relaxed text-ink-secondary"
                style={{ animationDelay: "200ms" }}
              >
                Your competitors are telling you what they&rsquo;re building right now, in public,
                and nobody&rsquo;s reading it. Signal does &mdash; then writes down what it
                expects next, with a probability, and scores itself when the date arrives.
              </p>

              <div
                className="rise-in mt-9 flex flex-wrap items-center gap-3"
                style={{ animationDelay: "280ms" }}
              >
                <Link
                  href="/signup"
                  className="inline-flex min-h-12 items-center rounded-lg bg-accent px-6 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(15,110,104,0.7)] transition-colors hover:bg-accent-hover"
                >
                  Track your first competitor
                </Link>
                <a
                  href="#how"
                  className="inline-flex min-h-12 items-center rounded-lg border border-line-strong bg-surface/80 px-6 text-[15px] font-medium text-ink backdrop-blur transition-colors hover:bg-surface"
                >
                  See how it works
                </a>
              </div>
            </div>
          </div>

          {/* The trace runs behind the product window and out past its edges. */}
          <div className="relative mt-14 sm:mt-16">
            <SignalTrace className="absolute inset-x-0 -top-16 h-[380px] w-full sm:-top-24 sm:h-[460px]" />
            <div className="relative mx-auto max-w-5xl px-5 pb-20 sm:px-8 sm:pb-28">
              <div className="rise-in" style={{ animationDelay: "420ms" }}>
                <ProductWindow />
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section id="how" className="scroll-mt-20 border-t border-line bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <h2 className="max-w-3xl text-balance text-[clamp(1.9rem,3.8vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.03em]">
              <TwoTone
                lead="Watch, predict, then keep score."
                rest="The same loop, for every competitor, running without you."
              />
            </h2>

            <ol className="relative mt-14 grid gap-8 md:grid-cols-4 md:gap-6">
              {/* Connector across the four stages. */}
              <div
                aria-hidden="true"
                className="absolute top-[18px] right-[12%] left-[12%] hidden h-px md:block"
                style={{
                  background:
                    "linear-gradient(90deg, var(--color-trace-a), var(--color-trace-b), var(--color-trace-c), var(--color-trace-d))",
                }}
              />
              {PIPELINE.map((stage) => (
                <li key={stage.n} className="relative">
                  <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-accent-line)] bg-surface font-mono text-[12px] font-medium text-accent">
                    {stage.n}
                  </span>
                  <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.015em]">{stage.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary">{stage.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Capabilities ─────────────────────────────────────────────── */}
        <section id="capabilities" className="scroll-mt-20 border-t border-line py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <h2 className="max-w-3xl text-balance text-[clamp(1.9rem,3.8vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.03em]">
              <TwoTone
                lead="Everything a competitive analyst does."
                rest="Including the part where they admit they were wrong."
              />
            </h2>
            <div className="mt-12">
              <Bento />
            </div>
          </div>
        </section>

        {/* ── Sources ──────────────────────────────────────────────────── */}
        <section id="sources" className="scroll-mt-20 border-t border-line bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
              <h2 className="text-balance text-[clamp(1.9rem,3.8vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.03em]">
                <TwoTone lead="Nine sources." rest="Sorted by when they move." />
              </h2>
              <p className="max-w-lg text-[15px] leading-relaxed text-ink-secondary">
                A changelog describes a change after it shipped. A pull request, a new job
                posting or a rewritten homepage <em>is</em> the change &mdash; timestamped,
                public, and usually weeks earlier. Tools built for sales teams never read any of
                it.
              </p>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {SOURCE_GROUPS.map((group) => (
                <div key={group.timing} className="overflow-hidden rounded-xl border border-line">
                  <div className="border-b border-line px-5 py-4" style={{ backgroundColor: group.tint }}>
                    <div className="text-[14px] font-semibold text-ink">{group.timing}</div>
                    <div className="text-[12.5px] text-ink-secondary">{group.note}</div>
                  </div>
                  <ul className="divide-y divide-line bg-surface">
                    {group.sources.map((source) => (
                      <li key={source.name} className="px-5 py-4">
                        <div className="text-[14px] font-medium text-ink">{source.name}</div>
                        <div className="mt-0.5 text-[12.5px] text-ink-muted">{source.detail}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Honesty band ─────────────────────────────────────────────── */}
        <section className="relative z-[1] overflow-hidden bg-[var(--color-deep)] py-20 text-[var(--color-deep-ink)] sm:py-28">
          <SignalTrace className="pointer-events-none absolute inset-x-0 top-1/2 h-[420px] w-full -translate-y-1/2 opacity-25" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <h2 className="text-balance text-[clamp(1.9rem,3.8vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.03em]">
                Honesty enforced in the schema,{" "}
                <span className="text-[var(--color-deep-muted)]">not promised in the copy.</span>
              </h2>
              <ul className="mt-10 space-y-6">
                {[
                  [
                    "It cannot claim certainty.",
                    "Probabilities are bounded away from 0 and 1 by the database itself.",
                  ],
                  [
                    "No model grades its own work.",
                    "The verdict is plain code against collected evidence.",
                  ],
                  [
                    "Silence is not failure.",
                    "A window with no evidence is recorded as unresolved and never scored as a miss.",
                  ],
                ].map(([h, p]) => (
                  <li key={h} className="flex gap-4">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--color-trace-c)]" />
                    <div>
                      <div className="text-[16px] font-semibold">{h}</div>
                      <div className="mt-1 text-[14px] leading-relaxed text-[var(--color-deep-muted)]">{p}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Real excerpts from the codebase, not an illustration of one. */}
            <div className="overflow-hidden rounded-xl border border-white/10 bg-black/25 backdrop-blur">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 font-mono text-[11px] text-[var(--color-deep-muted)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-trace-c)]" />
                from the Signal codebase
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.75]">
                <code>
                  <span className="text-[var(--color-deep-muted)]">-- predictions</span>
                  {"\n"}CHECK (probability &gt;= <span className="text-[var(--color-trace-d)]">0.05</span>
                  {"\n"}   AND probability &lt;= <span className="text-[var(--color-trace-d)]">0.95</span>)
                  {"\n\n"}
                  <span className="text-[var(--color-deep-muted)]">
                    {"// resolver: an unresolved window carries no score"}
                  </span>
                  {"\n"}const brier = outcome.status === <span className="text-[var(--color-trace-c)]">&quot;unresolved&quot;</span>
                  {"\n"}  ? <span className="text-[var(--color-trace-d)]">null</span>
                  {"\n"}  : brierScore(probability, hit);
                  {"\n\n"}
                  <span className="text-[var(--color-deep-muted)]">
                    {"// an empty track record is null — zero would read as perfect"}
                  </span>
                  {"\n"}if (resolved.length === <span className="text-[var(--color-trace-d)]">0</span>) return {"{"} brier: <span className="text-[var(--color-trace-d)]">null</span> {"}"};
                </code>
              </pre>
            </div>
          </div>
        </section>

        {/* ── Comparison ───────────────────────────────────────────────── */}
        <section className="border-t border-line py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <h2 className="max-w-3xl text-balance text-[clamp(1.9rem,3.8vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.03em]">
              <TwoTone lead="Not another alert feed." rest="A different kind of product." />
            </h2>

            <div className="mt-12 overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[12.5px]">
                    <th scope="col" className="px-5 py-3 font-semibold text-ink-muted">
                      <span className="sr-only">Aspect</span>
                    </th>
                    <th scope="col" className="bg-surface-sunken px-5 py-3 font-semibold text-ink-secondary">
                      Typical alert feed
                    </th>
                    <th scope="col" className="bg-[var(--color-tint-teal)] px-5 py-3 font-semibold text-accent">
                      Signal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map(([label, feed, signal]) => (
                    <tr key={label} className="border-b border-line last:border-b-0">
                      <th scope="row" className="px-5 py-4 font-medium text-ink">
                        {label}
                      </th>
                      <td className="bg-surface-sunken/60 px-5 py-4 text-ink-secondary">{feed}</td>
                      <td className="bg-[var(--color-tint-teal)]/60 px-5 py-4 text-ink">{signal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Questions ────────────────────────────────────────────────── */}
        <section id="questions" className="scroll-mt-20 border-t border-line bg-surface py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <h2 className="text-balance text-[clamp(1.9rem,3.8vw,2.9rem)] leading-[1.08] font-semibold tracking-[-0.03em]">
              <TwoTone lead="Questions," rest="answered plainly." />
            </h2>
            <div className="divide-y divide-line border-y border-line">
              {QUESTIONS.map((item) => (
                <details key={item.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16px] font-medium text-ink">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink-muted transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink-secondary">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final call ───────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-t border-line py-24 sm:py-32">
          <SignalTrace className="pointer-events-none absolute inset-x-0 top-1/2 h-[380px] w-full -translate-y-1/2 opacity-70" />
          <div className="relative mx-auto max-w-2xl px-5 text-center sm:px-8">
            <h2 className="text-balance text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] font-semibold tracking-[-0.035em]">
              Add one competitor. Let it run.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-[16px] leading-relaxed text-ink-secondary">
              A name and a domain is enough. Signal finds the rest and tells you what it expects
              &mdash; as probabilities, never certainties.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center rounded-lg bg-accent px-6 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(15,110,104,0.7)] transition-colors hover:bg-accent-hover"
              >
                Create a workspace
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-12 items-center rounded-lg border border-line-strong bg-surface px-6 text-[15px] font-medium text-ink transition-colors hover:bg-surface-sunken"
              >
                Sign in
              </Link>
            </div>
            <p className="mt-6 text-[12px] text-ink-muted">
              Product views on this page are illustrative and use fictional companies.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
