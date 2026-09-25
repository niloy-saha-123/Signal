import type { Metadata } from "next";
import Link from "next/link";

import { Calibration } from "@/components/landing/Calibration";
import { HeroProduct } from "@/components/landing/HeroProduct";
import { LeadTimeline } from "@/components/landing/LeadTimeline";
import { ProductTour } from "@/components/landing/ProductTour";
import { SignalTrace } from "@/components/landing/SignalTrace";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";

export const metadata: Metadata = {
  title: "Signal — See what competitors ship before they announce it",
  description:
    "Signal reads the public trail competitors leave — code, hiring, pricing, their own site and community — writes down what it expects them to do next, and scores itself when the date arrives.",
};

// Signal v4 landing. Brand system and rules: DESIGN.md. Nothing on this page
// claims a number Signal has not measured — no customer counts, no accuracy
// figure — and every product view uses fictional companies under an
// "illustrative" label. test/app/landing-page.test.tsx pins both.

const CONTAINER = "mx-auto w-full max-w-[1200px] px-5 sm:px-8";
const SECTION_TITLE =
  "font-display text-balance text-[clamp(2rem,4.2vw,3.4rem)] leading-[1.02] font-semibold tracking-[-0.035em]";

function TwoTone({ lead, rest }: { lead: string; rest: string }) {
  return (
    <>
      <span className="text-ink">{lead}</span> <span className="text-ink-muted">{rest}</span>
    </>
  );
}

const TRAIL = ["github", "greenhouse", "lever", "rss · atom", "discourse", "hacker news", "reddit", "pricing pages", "newsrooms"];

const LOOP = [
  {
    step: "01",
    title: "Watch",
    body: "Nine public sources per competitor, on a schedule. Ten retellings of one story count once.",
    spec: "collect → dedupe → cluster",
  },
  {
    step: "02",
    title: "Predict",
    body: "Above an evidence floor of five distinct clusters, a dated claim with a probability. Below it, silence.",
    spec: "p ∈ [0.05, 0.95]",
  },
  {
    step: "03",
    title: "Keep score",
    body: "On the date, plain code checks the claim against what was collected: hit, miss, or unresolved.",
    spec: "Brier vs 0.25 baseline",
  },
];

// Grouped by *when* each source tends to move relative to an announcement —
// the property that matters for forecasting.
const SOURCE_GROUPS = [
  {
    timing: "Leading",
    note: "Moves before anything is announced",
    tint: "bg-tint-blue",
    sources: [
      { name: "GitHub", detail: "Releases, pull requests, new repositories", color: "var(--color-source-github)" },
      { name: "Job boards", detail: "Greenhouse and Lever postings, as deltas", color: "var(--color-source-jobs)" },
      { name: "Their website", detail: "Homepage and product copy, diffed daily", color: "var(--color-source-website)" },
    ],
  },
  {
    timing: "Confirming",
    note: "Moves as the change goes public",
    tint: "bg-tint-lilac",
    sources: [
      { name: "Changelogs", detail: "RSS and Atom feeds, full text", color: "var(--color-source-changelog)" },
      { name: "Newsroom posts", detail: "Press and announcement feeds", color: "var(--color-source-postings)" },
      { name: "Pricing pages", detail: "Structured diffs against a baseline", color: "var(--color-source-pricing)" },
    ],
  },
  {
    timing: "Reacting",
    note: "Moves as the market responds",
    tint: "bg-tint-flare",
    sources: [
      { name: "Community forums", detail: "Their public Discourse forum", color: "var(--color-source-community)" },
      { name: "Hacker News", detail: "Weighted higher in pattern detection", color: "var(--color-source-hn)" },
      { name: "Reddit", detail: "Discovered subreddits per competitor", color: "var(--color-source-reddit)" },
    ],
  },
];

const RULES = [
  ["It cannot claim certainty", "Probabilities are bounded between 5% and 95% by the database itself."],
  ["No model grades its own work", "The verdict is plain code matching written criteria against collected evidence."],
  ["Silence is not failure", "A window that closes with no evidence is recorded as unresolved and never scored as a miss."],
];

const ASK_POINTS = [
  ["Answers from evidence", "Every claim cites the signals behind it. Thin evidence gets a refusal, not a guess."],
  ["Stays on topic", "Questions outside your competitive market are declined rather than improvised."],
  ["Asks before it acts", "Adding a competitor, starting a run or voiding a prediction waits for your approval."],
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
    q: "Can a competitor game it by planting text on their own site?",
    a: "Everything collected is treated as untrusted evidence. It reaches the model inside delimited blocks with an explicit rule never to follow instructions found there, and the resolution is decided by code, not by the model.",
  },
  {
    q: "What do I need to get started?",
    a: "A competitor's name and domain. Signal finds its GitHub organisation, job boards, changelog, pricing page, website and community on its own, and asks before it tracks anything it discovered.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-ground text-ink">
      {/* Announcement */}
      <a
        href="#sources"
        className="block bg-midnight px-4 py-2.5 text-center text-[13px] text-midnight-ink transition-colors hover:text-white"
      >
        <span className="mr-2 rounded-full bg-flare px-2 py-0.5 text-[11px] font-semibold text-midnight">New</span>
        Signal now reads competitors&rsquo; websites, forums and newsroom posts
        <span aria-hidden="true" className="ml-1.5 text-flare">
          →
        </span>
      </a>

      <SiteHeader />

      <main>
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="brand-glow absolute inset-0" />
          <div aria-hidden="true" className="grid-backdrop absolute inset-0" />

          <div className={`${CONTAINER} relative pt-20 text-center sm:pt-28`}>
            <p
              className="rise-in mx-auto inline-flex items-center gap-2 rounded-full bg-surface/80 px-3.5 py-1.5 text-[13px] font-medium text-ink-secondary shadow-[var(--shadow-card)] backdrop-blur"
              style={{ animationDelay: "40ms" }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-flare" />
              Competitive intelligence for teams that build developer tools
            </p>

            <h1
              className="rise-in mx-auto mt-8 max-w-5xl text-balance font-display text-[clamp(2.75rem,6.6vw,5.6rem)] leading-[0.95] font-semibold tracking-[-0.045em]"
              style={{ animationDelay: "120ms" }}
            >
              <TwoTone lead="See what competitors ship" rest="before they announce it." />
            </h1>

            <p
              className="rise-in mx-auto mt-7 max-w-2xl text-balance text-[18px] leading-relaxed text-ink-secondary sm:text-[19px]"
              style={{ animationDelay: "200ms" }}
            >
              Signal reads the public trail — pull requests, hiring, homepage rewrites — writes down what it expects
              next with a probability and a date, and scores itself when the date arrives.
            </p>

            <div
              className="rise-in mt-10 flex flex-wrap items-center justify-center gap-3"
              style={{ animationDelay: "280ms" }}
            >
              <Link
                href="/signup"
                className="inline-flex min-h-12 items-center rounded-xl bg-flare px-6 text-[15px] font-semibold text-midnight shadow-[0_14px_30px_-14px_rgba(249,110,49,0.9)] transition-colors hover:bg-flare-hover"
              >
                Track your first competitor
              </Link>
              <a
                href="#product"
                className="inline-flex min-h-12 items-center rounded-xl bg-surface px-6 text-[15px] font-medium text-ink shadow-[var(--shadow-card)] transition-colors hover:bg-surface-sunken"
              >
                Take the tour
              </a>
            </div>
          </div>

          <div className={`${CONTAINER} relative mt-16 pb-24 sm:mt-20 sm:pb-28`}>
            <div className="rise-in" style={{ animationDelay: "420ms" }}>
              <HeroProduct />
            </div>
            <p className="mt-4 text-center text-[12px] text-ink-muted">
              Illustrative product view · fictional companies and example figures
            </p>
          </div>
        </section>

        {/* ── The public trail ───────────────────────────────────────── */}
        <section aria-label="Sources Signal reads" className="border-y border-line bg-surface">
          <div className={`${CONTAINER} flex flex-col items-center gap-5 py-8 lg:flex-row lg:justify-between`}>
            <p className="shrink-0 text-[13px] font-medium text-ink-secondary">Reads the public trail from</p>
            <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-mono text-[13px] text-ink-muted">
              {TRAIL.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-line-strong" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────────────── */}
        <section id="how" className="scroll-mt-24 py-24 sm:py-32">
          <div className={CONTAINER}>
            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end">
              <h2 className={SECTION_TITLE}>
                <TwoTone lead="The launch post is the last signal." rest="Signal reads the first ones." />
              </h2>
              <p className="max-w-lg text-[16px] leading-relaxed text-ink-secondary lg:justify-self-end">
                A pull request, a job posting for a role that doesn&rsquo;t exist yet, a rewritten product page — all
                public, all weeks before the announcement. Signal lines them up, forecasts once enough independent
                evidence agrees, and checks itself on the date.
              </p>
            </div>

            <div className="mt-14">
              <LeadTimeline />
            </div>

            <div className="mt-6 grid overflow-hidden rounded-[22px] bg-surface shadow-[var(--shadow-card)] md:grid-cols-3">
              {LOOP.map((item, index) => (
                <div
                  key={item.title}
                  className={`p-7 sm:p-8 ${index > 0 ? "border-t border-line md:border-t-0 md:border-l" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[12px] text-flare-deep">{item.step}</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                  <h3 className="mt-5 font-display text-[24px] font-semibold text-ink">{item.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{item.body}</p>
                  <p className="mt-5 inline-block rounded-md bg-surface-sunken px-2 py-1 font-mono text-[12px] text-ink-secondary">
                    {item.spec}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Product tour ───────────────────────────────────────────── */}
        <section id="product" className="scroll-mt-24 border-t border-line bg-surface-sunken/60 py-24 sm:py-32">
          <div className={CONTAINER}>
            <h2 className={`${SECTION_TITLE} max-w-3xl`}>
              <TwoTone lead="Everything a competitive analyst does." rest="Including admitting when it was wrong." />
            </h2>
            <div className="mt-14">
              <ProductTour />
            </div>
          </div>
        </section>

        {/* ── Scorecard / honesty ─────────────────────────────────────── */}
        <section
          id="scorecard"
          className="relative scroll-mt-24 overflow-hidden bg-midnight py-24 text-midnight-ink sm:py-32"
        >
          <SignalTrace
            id="honesty-trace"
            tone="dark"
            className="pointer-events-none absolute inset-x-0 top-0 h-[420px] w-full opacity-40"
          />
          <div className={`${CONTAINER} relative grid gap-14 lg:grid-cols-[1fr_440px] lg:items-center`}>
            <div>
              <h2 className={`${SECTION_TITLE} text-white`}>
                Scored in public. <span className="text-midnight-muted">Starting from zero.</span>
              </h2>
              <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-midnight-muted">
                Every forecast carries a probability and a date. When the date arrives it is marked hit, miss or
                unresolved and Brier-scored against a coin flip. There is no accuracy number on this page because
                there isn&rsquo;t one yet — your workspace earns its own.
              </p>
              <ul className="mt-10 space-y-6">
                {RULES.map(([title, body]) => (
                  <li key={title} className="flex gap-4">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-flare shadow-[0_0_0_4px_rgba(249,110,49,0.18)]" />
                    <div>
                      <p className="text-[16px] font-semibold text-white">{title}</p>
                      <p className="mt-1 text-[14.5px] leading-relaxed text-midnight-muted">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <Calibration />
          </div>
        </section>

        {/* ── Sources ────────────────────────────────────────────────── */}
        <section id="sources" className="scroll-mt-24 py-24 sm:py-32">
          <div className={CONTAINER}>
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
              <h2 className={SECTION_TITLE}>
                <TwoTone lead="Nine sources." rest="Sorted by when they move." />
              </h2>
              <p className="max-w-lg text-[16px] leading-relaxed text-ink-secondary lg:justify-self-end">
                A changelog describes a change after it shipped. A pull request, a new job posting or a rewritten
                homepage is the change — timestamped, public, and usually weeks earlier. Discovery finds each source
                from a name and a domain.
              </p>
            </div>

            <div className="mt-14 grid gap-5 lg:grid-cols-3">
              {SOURCE_GROUPS.map((group) => (
                <div key={group.timing} className="overflow-hidden rounded-[22px] bg-surface shadow-[var(--shadow-card)]">
                  <div className={`${group.tint} px-6 py-5`}>
                    <p className="font-display text-[20px] font-semibold text-ink">{group.timing}</p>
                    <p className="mt-0.5 text-[13.5px] text-ink-secondary">{group.note}</p>
                  </div>
                  <ul>
                    {group.sources.map((source) => (
                      <li key={source.name} className="flex gap-3 border-t border-line px-6 py-4">
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: source.color }}
                        />
                        <div>
                          <p className="text-[15px] font-medium text-ink">{source.name}</p>
                          <p className="text-[13.5px] text-ink-secondary">{source.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Ask Signal ─────────────────────────────────────────────── */}
        <section id="ask" className="scroll-mt-24 border-t border-line bg-surface py-24 sm:py-32">
          <div className={`${CONTAINER} grid gap-14 lg:grid-cols-2 lg:items-center`}>
            <div>
              <h2 className={SECTION_TITLE}>
                <TwoTone lead="Ask it anything about a competitor." rest="It answers from evidence." />
              </h2>
              <ul className="mt-10 space-y-6">
                {ASK_POINTS.map(([title, body]) => (
                  <li key={title} className="flex gap-4">
                    <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                        <path
                          d="M3.5 8.5l3 3 6-7"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <div>
                      <p className="text-[16px] font-semibold text-ink">{title}</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-ink-secondary">{body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative overflow-hidden rounded-[22px] bg-tint-lilac p-5 ring-1 ring-line sm:p-8">
              <div className="dot-field pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
              <div className="relative space-y-3">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-midnight px-4 py-2.5 text-[14px] text-white">
                  Add Tidewater and tell me what they&rsquo;re hiring for.
                </div>
                <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink shadow-[var(--shadow-card)]">
                  I can start tracking Tidewater and run discovery on tidewater.dev. That writes to your workspace, so
                  I need your go-ahead first.
                </div>
                <div className="max-w-[92%] rounded-xl bg-surface p-4 shadow-[var(--shadow-card)] ring-1 ring-accent-line">
                  <p className="text-[12px] font-semibold text-accent">Needs your approval</p>
                  <p className="mt-1 text-[14px] text-ink">Create competitor “Tidewater” and start discovery</p>
                  <div className="mt-3 flex gap-2">
                    <span className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white">Approve</span>
                    <span className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary ring-1 ring-line">
                      Decline
                    </span>
                  </div>
                </div>
                <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-[14px] text-ink-secondary shadow-[var(--shadow-card)]">
                  What&rsquo;s the weather in Lisbon?
                  <p className="mt-2 text-ink">That&rsquo;s outside your competitive market, so I&rsquo;ll pass on it.</p>
                </div>
              </div>
              <p className="relative mt-5 text-center text-[11.5px] text-ink-muted">Illustrative conversation</p>
            </div>
          </div>
        </section>

        {/* ── Comparison ─────────────────────────────────────────────── */}
        <section className="py-24 sm:py-32">
          <div className={CONTAINER}>
            <h2 className={`${SECTION_TITLE} max-w-3xl`}>
              <TwoTone lead="Not another alert feed." rest="A different kind of product." />
            </h2>
            <div className="mt-12 overflow-x-auto rounded-[22px] bg-surface shadow-[var(--shadow-card)]">
              <table className="w-full min-w-[640px] border-collapse text-left text-[14.5px]">
                <thead>
                  <tr>
                    <th className="w-1/4 px-6 py-4" />
                    <th className="w-[37.5%] px-6 py-4 font-medium text-ink-muted">Typical alert feed</th>
                    <th className="w-[37.5%] bg-tint-blue px-6 py-4 font-semibold text-accent">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map(([aspect, feed, signal]) => (
                    <tr key={aspect} className="border-t border-line">
                      <th scope="row" className="px-6 py-4 font-medium text-ink">
                        {aspect}
                      </th>
                      <td className="px-6 py-4 text-ink-muted">{feed}</td>
                      <td className="bg-tint-blue/60 px-6 py-4 font-medium text-ink">{signal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────────── */}
        <section id="questions" className="scroll-mt-24 border-t border-line bg-surface py-24 sm:py-32">
          <div className={`${CONTAINER} grid gap-12 lg:grid-cols-[1fr_1.5fr]`}>
            <h2 className={SECTION_TITLE}>
              <TwoTone lead="Questions," rest="answered plainly." />
            </h2>
            <div className="divide-y divide-line border-y border-line">
              {QUESTIONS.map((item) => (
                <details key={item.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-medium text-ink">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-secondary transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-secondary">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────── */}
        <section className="py-20 sm:py-28">
          <div className={CONTAINER}>
            <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#2b61cc_0%,#0f2150_55%,#061436_100%)] px-6 py-20 text-center sm:px-12">
              <SignalTrace
                id="cta-trace"
                tone="dark"
                className="pointer-events-none absolute inset-x-0 top-1/2 h-[380px] w-full -translate-y-1/2 opacity-35"
              />
              <div className="relative">
                <h2 className="mx-auto max-w-3xl text-balance font-display text-[clamp(2.2rem,5vw,4rem)] leading-[1] font-semibold tracking-[-0.04em] text-white">
                  Read the signal before the launch post.
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-white/80">
                  Add a competitor by name and domain. Signal finds its sources and asks before it tracks anything it
                  discovered.
                </p>
                <div className="mt-9 flex flex-wrap justify-center gap-3">
                  <Link
                    href="/signup"
                    className="inline-flex min-h-12 items-center rounded-xl bg-flare px-6 text-[15px] font-semibold text-midnight transition-colors hover:bg-flare-hover"
                  >
                    Create a workspace
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex min-h-12 items-center rounded-xl bg-white/10 px-6 text-[15px] font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/15"
                  >
                    Sign in
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
