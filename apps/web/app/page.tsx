import Link from "next/link";
import { SignalMark } from "@/components/landing/SignalMark";
import { SignalProductStage } from "@/components/landing/SignalProductStage";

const workflow = [
  {
    label: "Source",
    title: "Signal watches the places change appears first.",
    body: "Pricing pages, product changelogs, hiring, community, and company sources remain connected to the movement they reveal.",
  },
  {
    label: "Movement",
    title: "Related changes become one legible event.",
    body: "A pricing edit, packaging release, and hiring pattern can be reviewed together instead of scattered across separate feeds.",
  },
  {
    label: "Meaning",
    title: "Interpretation stays attached to evidence.",
    body: "Signal explains the strategic pattern, assigns a score, and keeps the underlying source trail open for analyst review.",
  },
  {
    label: "Briefing",
    title: "The right movement reaches the morning brief.",
    body: "Alerts and briefings organize what changed so analysts can investigate, share context, and decide what deserves action.",
  },
];

function DirectionArrow() {
  return (
    <svg aria-hidden="true" className="h-5 w-9" viewBox="0 0 36 20" fill="none">
      <path
        d="M1 10h31m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-studio-paper text-studio-ink">
      <header className="relative z-50 border-b border-studio-line/70 bg-studio-paper">
        <div className="mx-auto flex h-18 max-w-368 items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/" aria-label="Signal home">
            <SignalMark />
          </Link>
          <nav aria-label="Main navigation" className="hidden items-center gap-7 md:flex">
            <a
              href="#workflow"
              className="text-sm font-semibold text-studio-muted transition-colors hover:text-studio-ink"
            >
              How it works
            </a>
            <a
              href="#product"
              className="text-sm font-semibold text-studio-muted transition-colors hover:text-studio-ink"
            >
              Product
            </a>
            <a
              href="#research"
              className="text-sm font-semibold text-studio-muted transition-colors hover:text-studio-ink"
            >
              Research chat
            </a>
          </nav>
          <details className="group relative ml-auto md:hidden">
            <summary
              aria-label="Open section navigation"
              className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-studio-line text-studio-ink transition-colors hover:bg-studio-sky-soft [&::-webkit-details-marker]:hidden"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <path
                  d="M5 7.5h14M5 12h14M5 16.5h14"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </summary>
            <nav
              aria-label="Mobile section navigation"
              className="absolute top-13 right-0 z-50 w-52 overflow-hidden rounded-2xl border border-studio-line bg-studio-paper p-2 shadow-[0_18px_42px_-24px_rgba(10,32,51,0.45)]"
            >
              {[
                ["#workflow", "How it works"],
                ["#product", "Product"],
                ["#research", "Research chat"],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="block rounded-xl px-4 py-3 text-sm font-semibold text-studio-muted transition-colors hover:bg-studio-sky-soft hover:text-studio-ink"
                >
                  {label}
                </a>
              ))}
            </nav>
          </details>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link
              href="/login"
              className="hidden rounded-full px-3 py-2.5 text-sm font-bold text-studio-ink transition-colors hover:bg-studio-sky-soft sm:inline-flex sm:px-4"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-studio-ink px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-studio-action sm:px-5"
            >
              Start tracking
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative bg-studio-sky">
          <div className="mx-auto grid min-h-[calc(100svh-4.5rem)] max-w-368 items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.72fr_1.28fr] lg:gap-8 lg:px-12 lg:py-16">
            <div className="relative z-10 max-w-156">
              <h1 className="text-balance font-display text-[clamp(3.25rem,6.3vw,6rem)] leading-[0.94] font-extrabold tracking-[-0.04em] text-studio-ink">
                See the competitor move before it becomes the story.
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-relaxed text-studio-muted sm:text-xl">
                Signal continuously connects market changes to their sources, explains why
                they matter, and brings the movements worth acting on into one calm workspace.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Link
                  href="/signup"
                  className="inline-flex min-h-12 items-center justify-center rounded-full bg-studio-action px-6 text-base font-bold text-white shadow-[0_14px_30px_-18px_rgba(8,118,207,0.95)] transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-studio-action-hover"
                >
                  Track your market
                </Link>
                <a
                  href="#evidence-workflow"
                  className="inline-flex min-h-12 items-center gap-2 px-2 text-sm font-bold text-studio-ink underline decoration-studio-action/40 underline-offset-4 hover:decoration-studio-action"
                >
                  Follow the evidence
                  <DirectionArrow />
                </a>
              </div>
              <p className="mt-5 text-xs leading-relaxed text-studio-muted">
                Built for competitive-intelligence and strategy teams. No invented answers;
                source citations stay in view.
              </p>
            </div>

            <div className="relative lg:w-[min(62rem,72vw)] lg:translate-x-4 xl:translate-x-10">
              <div className="absolute -top-8 -left-7 hidden h-24 w-24 rounded-full border border-studio-action/25 lg:block" />
              <SignalProductStage />
              <p className="mt-3 px-3 text-right text-[0.68rem] font-medium text-studio-muted">
                Illustrative product view using Signal&apos;s implemented workflow
              </p>
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-8 bg-studio-paper py-24 sm:py-32">
          <div className="mx-auto max-w-344 px-5 sm:px-8 lg:px-12">
            <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
              <h2 className="max-w-xl font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-5xl">
                Evidence moves forward without losing its trail.
              </h2>
              <p className="max-w-2xl text-lg leading-relaxed text-studio-muted lg:pt-2">
                Most monitoring tools leave the analyst to connect tabs, feeds, and summaries.
                Signal preserves the relationship between what changed, where it came from,
                and what the movement may mean.
              </p>
            </div>

            <div
              id="evidence-workflow"
              className="mt-16 border-y border-studio-line lg:grid lg:grid-cols-[0.82fr_1.2fr_1fr_0.92fr]"
            >
              {workflow.map((step, index) => (
                <article
                  key={step.label}
                  className={`relative py-8 lg:min-h-88 lg:px-7 lg:py-9 ${
                    index !== workflow.length - 1
                      ? "border-b border-studio-line lg:border-r lg:border-b-0"
                      : ""
                  } ${index === 1 ? "lg:pt-20" : ""} ${index === 2 ? "lg:pt-12" : ""}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-bold tracking-[0.12em] text-studio-action uppercase">
                      {step.label}
                    </p>
                    {index !== workflow.length - 1 && (
                      <span className="text-studio-action lg:absolute lg:top-8 lg:-right-5 lg:z-10 lg:bg-studio-paper lg:px-2">
                        <DirectionArrow />
                      </span>
                    )}
                  </div>
                  <h3 className="mt-5 max-w-sm font-display text-2xl leading-tight font-bold tracking-[-0.03em]">
                    {step.title}
                  </h3>
                  <p className="mt-4 max-w-sm text-sm leading-relaxed text-studio-muted">
                    {step.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-8 bg-studio-ink py-24 text-white sm:py-32">
          <div className="mx-auto max-w-344 px-5 sm:px-8 lg:px-12">
            <div className="grid items-start gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
              <div className="lg:sticky lg:top-12">
                <h2 className="max-w-xl font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-6xl">
                  Keep watch without living in the feed.
                </h2>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-studio-sky-deep">
                  Signal monitors product, pricing, hiring, community, and company sources
                  continuously. Discovery and alerts help analysts decide what belongs in
                  their tracked landscape.
                </p>
              </div>

              <div className="overflow-hidden rounded-4xl border border-studio-muted bg-[#102b43]">
                <div className="flex items-center justify-between border-b border-studio-muted px-5 py-4 sm:px-7">
                  <div>
                    <p className="text-sm font-bold">Movement queue</p>
                    <p className="mt-1 text-xs text-studio-sky-deep">
                      Review changes by competitor and source
                    </p>
                  </div>
                  <span className="rounded-full bg-studio-action px-3 py-1.5 text-xs font-bold">
                    Monitoring
                  </span>
                </div>
                <div className="divide-y divide-studio-muted">
                  {[
                    ["Pricing", "Plan packaging changed", "Evidence captured"],
                    ["Product", "New admin controls released", "Changelog linked"],
                    ["Hiring", "Enterprise roles increased", "Jobs source linked"],
                    ["Discovery", "Adjacent competitor found", "Awaiting confirmation"],
                  ].map(([source, movement, state], index) => (
                    <div
                      key={movement}
                      className={`grid gap-3 px-5 py-6 sm:grid-cols-[6rem_1fr_auto] sm:items-center sm:px-7 ${
                        index === 1 ? "bg-studio-action/15" : ""
                      }`}
                    >
                      <p className="text-xs font-bold tracking-[0.08em] text-studio-sky-deep uppercase">
                        {source}
                      </p>
                      <p className="font-semibold text-white">{movement}</p>
                      <p className="text-xs text-studio-sky-deep">{state}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-studio-sky-soft py-24 sm:py-32">
          <div className="mx-auto grid max-w-344 items-center gap-16 px-5 sm:px-8 lg:grid-cols-[1.12fr_0.88fr] lg:px-12">
            <div className="relative min-h-128 overflow-hidden rounded-[2.2rem] border border-studio-line bg-studio-paper p-6 shadow-[0_26px_70px_-42px_rgba(10,32,51,0.45)] sm:p-9">
              <div className="flex items-start justify-between gap-6 border-b border-studio-line pb-6">
                <div>
                  <p className="text-xs font-bold text-studio-action">Strategic interpretation</p>
                  <h3 className="mt-2 max-w-lg text-xl font-bold tracking-tight">
                    A packaging change with enterprise intent
                  </h3>
                </div>
                <div className="text-right">
                  <p className="text-[0.65rem] font-bold text-studio-muted uppercase">
                    Score
                  </p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">82</p>
                </div>
              </div>
              <div className="grid gap-8 pt-7 sm:grid-cols-[1fr_0.72fr]">
                <div>
                  <p className="text-sm leading-relaxed text-studio-ink">
                    Related evidence indicates the competitor is increasing separation
                    between self-serve and enterprise plans, with commercial hiring moving in
                    the same direction.
                  </p>
                  <div className="mt-8 space-y-5">
                    {["Pricing evidence", "Release context", "Hiring trajectory"].map(
                      (item, index) => (
                        <div key={item} className="flex items-center gap-3">
                          <span className="grid h-7 w-7 place-items-center rounded-full bg-studio-action text-xs font-bold text-white">
                            {index + 1}
                          </span>
                          <span className="text-sm font-semibold">{item}</span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
                <div className="border-t border-studio-line pt-6 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-7">
                  <p className="text-xs font-bold text-studio-muted uppercase">
                    Analyst control
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-studio-muted">
                    Open every source, adjust company context, review discovered entities,
                    and decide which movement should become an alert.
                  </p>
                </div>
              </div>
              <div className="absolute right-8 bottom-8 left-8 h-px bg-studio-line">
                <span className="absolute -top-1.5 left-[68%] h-3 w-3 rounded-full bg-studio-action shadow-[0_0_0_5px_#d5edff]" />
              </div>
            </div>

            <div>
              <h2 className="max-w-xl font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-5xl">
                Get the interpretation. Keep the judgment.
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-studio-muted">
                Signal groups relevant evidence, explains the pattern, and scores movement
                so analysts can focus their attention. The conclusion never replaces the
                sources or the team&apos;s own market context.
              </p>
              <p className="mt-8 max-w-lg border-t border-studio-line pt-6 text-sm leading-relaxed text-studio-ink">
                Briefings, score board, alerts, and company context stay connected to the
                same research workflow.
              </p>
            </div>
          </div>
        </section>

        <section id="research" className="scroll-mt-8 bg-studio-paper py-24 sm:py-32">
          <div className="mx-auto max-w-344 px-5 sm:px-8 lg:px-12">
            <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-24">
              <div>
                <h2 className="max-w-lg font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-5xl">
                  Ask the next question without starting over.
                </h2>
                <p className="mt-6 max-w-lg text-lg leading-relaxed text-studio-muted">
                  Persistent chat keeps the investigation tied to company context and the
                  evidence already collected. Answers cite their source trail so the analyst
                  can verify the reasoning.
                </p>
              </div>
              <div className="relative overflow-hidden rounded-4xl bg-studio-sky p-5 sm:p-8">
                <div className="ml-auto max-w-[70%] rounded-[1.3rem_1.3rem_0.35rem_1.3rem] bg-studio-ink px-5 py-4 text-sm leading-relaxed text-white">
                  Is this one pricing experiment, or part of a broader enterprise move?
                </div>
                <div className="mt-7 max-w-[88%] border-l border-studio-action bg-studio-paper px-5 py-5 sm:px-7">
                  <p className="text-sm leading-relaxed text-studio-ink">
                    The evidence supports a broader move. Packaging changed alongside the
                    plan price <strong className="text-studio-action">[1][2]</strong>, and
                    enterprise account hiring increased in the same review window{" "}
                    <strong className="text-studio-action">[3]</strong>. I would keep watching
                    sales-led releases before treating the shift as complete.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {["[1] Pricing", "[2] Changelog", "[3] Jobs"].map((source) => (
                      <span
                        key={source}
                        className="rounded-full border border-studio-line px-3 py-1.5 text-xs font-bold text-studio-muted"
                      >
                        {source}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="mt-5 text-right text-xs font-semibold text-studio-muted">
                  Example cited response
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-studio-sky px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-296 rounded-[2.5rem] bg-studio-ink px-6 py-14 text-center text-white shadow-[0_28px_60px_-36px_rgba(10,32,51,0.65)] sm:px-12 sm:py-20">
            <h2 className="mx-auto max-w-3xl text-balance font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-6xl">
              Start with the market you need to understand.
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-studio-sky-deep sm:text-lg">
              Create a Signal workspace, add your company context, and begin tracking the
              competitors and sources that matter to your team.
            </p>
            <Link
              href="/signup"
              className="mt-9 inline-flex min-h-12 items-center justify-center rounded-full bg-studio-paper px-7 font-bold text-studio-ink transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-studio-action-soft"
            >
              Create your workspace
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-studio-line bg-studio-paper">
        <div className="mx-auto flex max-w-344 flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <SignalMark compact />
          <p className="text-xs leading-relaxed text-studio-muted">
            Signal turns competitor evidence into early warnings and research-backed answers.
          </p>
          <div className="flex items-center gap-5 text-xs font-bold">
            <Link href="/login" className="hover:text-studio-action">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-studio-action">
              Start tracking
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
