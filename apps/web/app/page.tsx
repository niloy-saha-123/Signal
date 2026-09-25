import type { Metadata } from "next";
import Link from "next/link";

import { LandingWorkspace } from "@/components/landing/LandingWorkspace";
import { MobileSectionNav } from "@/components/landing/MobileSectionNav";
import { SignalMark } from "@/components/landing/SignalMark";
import { SignalProductStage } from "@/components/landing/SignalProductStage";
import { SiteFooter } from "@/components/landing/SiteFooter";

export const metadata: Metadata = {
  title: "Signal — See the competitor move before it becomes the story",
  description:
    "Signal monitors pricing, product, hiring, and community sources, then turns related changes into cited briefings for competitive-intelligence teams.",
};

const questions = [
  {
    q: "What does Signal actually watch?",
    a: "Pricing pages, product changelogs, hiring, community discussion, and company sources. Movements stay linked to those sources instead of collapsing into a generic summary.",
  },
  {
    q: "Is this a news feed with a chat box?",
    a: "No. Related changes become one event, with a score, an interpretation, and the evidence trail still open. Chat answers from that trail, and can refuse when the workspace does not have enough.",
  },
  {
    q: "What happens after I create a workspace?",
    a: "Add company context, confirm competitors, and start from the overnight briefing. Discovery suggests entities to track. Alerts surface movements that need a look.",
  },
  {
    q: "Can I control what gets tracked?",
    a: "Yes. Confirm or dismiss discovered entities, keep your own company profile, and ask follow-up questions in a persistent thread tied to the same workspace.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-studio-paper text-studio-ink">
      <header className="sticky top-0 z-50 border-b border-studio-line/80 bg-studio-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between px-5 sm:h-18 sm:px-8 lg:px-12">
          <Link href="/" aria-label="Signal home">
            <SignalMark />
          </Link>
          <nav aria-label="Main navigation" className="hidden items-center gap-8 xl:flex">
            <a href="#product" className="text-sm font-semibold text-studio-muted hover:text-studio-ink">
              Product
            </a>
            <a href="#workflow" className="text-sm font-semibold text-studio-muted hover:text-studio-ink">
              How it works
            </a>
            <a href="#research" className="text-sm font-semibold text-studio-muted hover:text-studio-ink">
              Research chat
            </a>
            <Link href="/briefing" className="text-sm font-semibold text-studio-muted hover:text-studio-ink">
              Workspace
            </Link>
          </nav>
          <MobileSectionNav />
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="hidden min-h-10 items-center rounded-full px-4 text-sm font-bold text-studio-ink hover:bg-studio-sky-soft sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex min-h-10 items-center rounded-full bg-studio-ink px-4 text-sm font-bold text-white hover:bg-[#071625] sm:px-5"
            >
              Start tracking
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section
          id="product"
          className="relative scroll-mt-16 overflow-hidden bg-studio-sky"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_80%_0%,#b9ddf7_0%,transparent_58%)]"
          />
          <div className="relative mx-auto grid max-w-[90rem] items-end gap-10 px-5 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-8 lg:px-12 lg:pt-10">
            <div className="relative z-10 max-w-xl pb-4 lg:pb-16">
              <h1 className="font-display text-[clamp(2.75rem,6vw,5.25rem)] leading-[0.92] font-extrabold tracking-[-0.045em] text-studio-ink">
                See the move before it becomes the story.
              </h1>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-studio-muted sm:text-xl">
                Signal watches the sources where competitors change first, groups related
                evidence, and puts a cited briefing on the desk in the morning.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/signup"
                  className="inline-flex min-h-12 items-center rounded-full bg-studio-ink px-6 text-base font-bold text-white shadow-[0_16px_32px_-18px_rgba(10,32,51,0.55)] hover:bg-[#071625]"
                >
                  Create a workspace
                </Link>
                <a
                  href="#workflow"
                  className="inline-flex min-h-12 items-center rounded-full px-4 text-sm font-bold text-studio-ink hover:bg-white/50"
                >
                  See how evidence moves
                </a>
              </div>
            </div>

            <div className="min-w-0 lg:translate-x-6 xl:translate-x-10">
              <SignalProductStage />
              <p className="mt-3 mb-8 px-1 text-right text-[0.7rem] font-medium text-studio-muted lg:mb-12">
                Illustrative view of Signal&apos;s briefing, evidence trail, and research chat
              </p>
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-16 bg-studio-paper py-20 sm:py-28">
          <div className="mx-auto max-w-[86rem] px-5 sm:px-8 lg:px-12">
            <div className="max-w-2xl">
              <h2 className="font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-5xl">
                One movement. Sources still attached.
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-studio-muted">
                Switch the view the way a team switches a board. The same event stays in
                front of you as sources, a scored movement, and an interpretation you can
                still challenge.
              </p>
            </div>
            <div id="evidence-workflow" className="mt-12">
              <LandingWorkspace />
            </div>
          </div>
        </section>

        <section className="bg-studio-sky-soft py-20 sm:py-28">
          <div className="mx-auto grid max-w-[86rem] items-center gap-14 px-5 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-12">
            <div className="overflow-hidden rounded-[2rem] border border-studio-line bg-studio-paper p-6 shadow-[0_24px_60px_-40px_rgba(10,32,51,0.4)] sm:p-8">
              <div className="flex items-start justify-between gap-6">
                <h3 className="max-w-md font-display text-2xl font-bold tracking-[-0.03em]">
                  A packaging change signals enterprise intent
                </h3>
                <p className="font-display text-4xl font-bold tabular-nums">82</p>
              </div>
              <p className="mt-6 max-w-lg text-sm leading-relaxed text-studio-muted">
                Related evidence shows the competitor separating self-serve from enterprise
                plans, with commercial hiring moving in the same direction.
              </p>
              <div className="mt-8 grid gap-3">
                {["Pricing evidence stays open", "Release context stays linked", "Hiring trajectory stays visible"].map(
                  (item) => (
                    <div key={item} className="flex items-center gap-3 rounded-[10px] bg-studio-sky-soft px-4 py-3">
                      <span className="h-2 w-2 rounded-full bg-studio-action" />
                      <span className="text-sm font-semibold">{item}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
            <div>
              <h2 className="font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-5xl">
                Get the interpretation. Keep the judgment.
              </h2>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-studio-muted">
                Signal groups evidence and scores movement so the morning review is shorter.
                The conclusion never replaces the sources or the team&apos;s market context.
              </p>
            </div>
          </div>
        </section>

        <section id="research" className="scroll-mt-16 bg-studio-paper py-20 sm:py-28">
          <div className="mx-auto grid max-w-[86rem] gap-12 px-5 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:px-12">
            <div>
              <h2 className="font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-5xl">
                Ask the next question without starting over.
              </h2>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-studio-muted">
                Persistent chat stays tied to company context and collected evidence.
                Answers cite the trail so an analyst can verify the reasoning.
              </p>
            </div>
            <div className="rounded-[2rem] bg-studio-sky p-5 sm:p-8">
              <div className="ml-auto max-w-[72%] rounded-[1.4rem_1.4rem_0.4rem_1.4rem] bg-studio-ink px-5 py-4 text-sm leading-relaxed text-white">
                Is this one pricing experiment, or part of a broader enterprise move?
              </div>
              <div className="mt-6 max-w-[90%] rounded-[1.4rem] bg-studio-paper px-5 py-5 sm:px-6">
                <p className="text-sm leading-relaxed text-studio-ink">
                  The evidence supports a broader move. Packaging changed alongside the plan
                  price, and enterprise account hiring increased in the same window. Keep
                  watching sales-led releases before treating the shift as complete.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["Pricing", "Changelog", "Jobs"].map((source) => (
                    <span
                      key={source}
                      className="rounded-full bg-studio-sky-soft px-3 py-1.5 text-xs font-bold text-studio-ink"
                    >
                      {source}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="questions" className="scroll-mt-16 bg-studio-sky-soft py-20 sm:py-28">
          <div className="mx-auto grid max-w-[86rem] gap-12 px-5 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:px-12">
            <h2 className="font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-5xl">
              Questions teams ask before they start tracking.
            </h2>
            <div className="divide-y divide-studio-line rounded-[2rem] border border-studio-line bg-studio-paper px-2">
              {questions.map((item) => (
                <details key={item.q} className="group px-4 py-2 sm:px-6">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-display text-lg font-bold tracking-[-0.02em] [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-studio-sky-soft text-studio-muted group-open:bg-studio-ink group-open:text-white">
                      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
                        <path
                          d="M3 8h10M8 3v10"
                          className="stroke-current group-open:hidden"
                          fill="none"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                        <path
                          d="M3 8h10"
                          className="hidden stroke-current group-open:block"
                          fill="none"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                  </summary>
                  <p className="max-w-2xl pb-5 text-sm leading-relaxed text-studio-muted">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-studio-sky px-5 py-20 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-4xl leading-[1.02] font-bold tracking-[-0.04em] sm:text-6xl">
              Start with the market you need to understand.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-studio-muted">
              Create a workspace, add company context, and begin tracking the competitors
              and sources that matter to your team.
            </p>
            <Link
              href="/signup"
              className="mt-8 inline-flex min-h-12 items-center rounded-full bg-studio-ink px-7 text-base font-bold text-white hover:bg-[#071625]"
            >
              Create your workspace
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
