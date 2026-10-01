import type { Metadata } from "next";

import { Isobars } from "@/components/brand/Isobars";
import { Sig } from "@/components/brand/Sig";
import { DomainForm } from "@/components/landing/DomainForm";
import { EvidenceGraph } from "@/components/landing/EvidenceGraph";
import { ForecastBoard } from "@/components/landing/ForecastBoard";
import { HeroWindows } from "@/components/landing/HeroWindows";
import { ScoreLedger } from "@/components/landing/ScoreLedger";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SOURCE_COUNT, SourceMap } from "@/components/landing/SourceMap";
import { WhereYouWork } from "@/components/landing/WhereYouWork";

export const metadata: Metadata = {
  title: "Signal — the weather forecast for your competitors",
  description:
    "Signal reads competitors' code, hiring, docs and pricing, says what they will ship next with a probability and a date, and scores itself when the date arrives.",
};

// Signal v5 landing. Brand rules: DESIGN.md. No claim here is a number Signal
// has not measured — no customer counts, no accuracy figure — and every product
// view uses fictional companies under an "illustrative" label.
// test/app/landing-page.test.tsx pins those promises.

const CONTAINER = "mx-auto w-full max-w-[1200px] px-5 sm:px-8";
const H2 = "font-display text-balance text-[clamp(2rem,4vw,3.25rem)] leading-[1.02] font-semibold tracking-[-0.035em] text-ink";
const LEDE = "mt-4 max-w-[620px] text-[17px] leading-relaxed text-ink-secondary";

export default function LandingPage() {
  return (
    <div className="bg-surface text-ink">
      <div className="bg-sky">
        <SiteHeader />
      </div>

      <main>
        <section className="relative overflow-hidden bg-sky">
          <Isobars />
          <div className={`${CONTAINER} relative grid items-center gap-12 pt-10 pb-20 lg:grid-cols-[1fr_1.02fr] lg:pt-16 lg:pb-28`}>
            <div>
              <h1 className="font-display text-[clamp(2.6rem,5.6vw,4.2rem)] leading-[0.98] font-semibold tracking-[-0.04em] text-balance">
                The weather forecast for your <span className="sun-mark">competitors.</span>
              </h1>
              <p className="mt-6 max-w-[500px] text-[18px] leading-relaxed text-ink-secondary">
                Signal reads their commits, job posts, docs and pricing pages, then tells you what they&rsquo;ll ship
                next, with a probability and a date. When the date comes, it checks itself.
              </p>
              <div className="mt-8">
                <DomainForm note="Setup takes a minute. A first forecast needs a few days of evidence." />
              </div>
            </div>
            <div className="min-w-0">
              <HeroWindows />
              <p className="mt-6 text-center text-[12.5px] text-ink-muted lg:text-right">
                Illustrative. Kestrel and every company shown on this page are fictional.
              </p>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-8 py-24">
          <div className={CONTAINER}>
            <div className="mx-auto max-w-[720px] text-center">
              <h2 className={H2}>Every forecast shows its working.</h2>
              <p className={`${LEDE} mx-auto`}>
                A forecast only gets written when several independent sources point the same way. Below that bar Signal
                says nothing, which is most days for most competitors.
              </p>
            </div>
            <div className="mt-14">
              <EvidenceGraph />
            </div>
          </div>
        </section>

        <section className="bg-ground py-24">
          <div className={`${CONTAINER} grid items-center gap-14 lg:grid-cols-[0.8fr_1.2fr]`}>
            <div>
              <h2 className={H2}>One board for every competitor&rsquo;s next move.</h2>
              <p className={LEDE}>
                Each row is a dated claim with odds. When a job post, a docs page or a pricing change lands, the odds
                move and you see why.
              </p>
              <ul className="mt-7 space-y-3 text-[15.5px] text-ink-secondary">
                <li className="flex gap-3">
                  <Tick /> Morning briefing of what moved overnight, and what to do about it
                </li>
                <li className="flex gap-3">
                  <Tick /> A profile for every competitor: forecasts, hiring, pricing history
                </li>
                <li className="flex gap-3">
                  <Tick /> Discovery that suggests competitors you haven&rsquo;t added yet
                </li>
              </ul>
            </div>
            <div className="min-w-0">
              <ForecastBoard />
            </div>
          </div>
        </section>

        <section className="py-24">
          <div className={`${CONTAINER} grid items-center gap-14 lg:grid-cols-2`}>
            <div>
              <h2 className={H2}>It keeps score, including when it&rsquo;s wrong.</h2>
              <p className={LEDE}>
                On the date, plain code checks every forecast against the evidence collected: hit, miss, or unresolved.
                No model grades its own homework, and a miss stays on the record.
              </p>
            </div>
            <ScoreLedger />
          </div>
        </section>

        <section id="sources" className="scroll-mt-8 bg-ground py-24">
          <div className={CONTAINER}>
            <div className="max-w-[720px]">
              <h2 className={H2}>{SOURCE_COUNT} public sources, ordered by how early they move.</h2>
              <p className={LEDE}>
                Add a competitor by name and website. Signal finds their job boards, docs, feeds, forums and packages on
                its own, and asks before it watches anything new.
              </p>
            </div>
            <div className="mt-12">
              <SourceMap />
            </div>
          </div>
        </section>

        <section id="where" className="scroll-mt-8 py-24">
          <div className={CONTAINER}>
            <div className="max-w-[720px]">
              <h2 className={H2}>It comes to you.</h2>
              <p className={LEDE}>
                Most of the time nobody opens a dashboard. Signal posts to Slack, answers in your AI tools, and sits next
                to the roadmap it affects.
              </p>
            </div>
            <div className="mt-12">
              <WhereYouWork />
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-sky py-24">
          <Isobars variant="soft" />
          <div className={`${CONTAINER} relative flex flex-col items-center text-center`}>
            <Sig mood="happy" size={64} decorative />
            <h2 className={`${H2} mt-6 max-w-[760px]`}>Who should Signal watch first?</h2>
            <p className={`${LEDE} mx-auto`}>Type a competitor&rsquo;s website. Signal sets up the rest.</p>
            <div className="mt-8 flex w-full justify-center">
              <DomainForm cta="Start watching" />
            </div>
          </div>
        </section>

      </main>

      <SiteFooter />
    </div>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--color-sun)" />
      <path d="m6 10.3 2.6 2.6L14 7.6" fill="none" stroke="var(--color-ink)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
