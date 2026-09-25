"use client";

import { useState, type ReactNode } from "react";

// Five surfaces, one at a time. Each panel sits on its own light tint so the
// section has colour without any saturated fill competing with the product.
// All companies are fictional; the section is labelled illustrative.

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-ink-secondary ring-1 ring-line"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone }} />
      {children}
    </span>
  );
}

function Briefing() {
  const rows = [
    ["Kestrel", "Splits self-serve and enterprise pricing", "var(--color-source-pricing)", "pricing"],
    ["Halcyon", "Three enterprise account roles in two weeks", "var(--color-source-jobs)", "jobs"],
    ["Parallax", "Homepage now leads with data residency", "var(--color-source-website)", "website"],
  ] as const;
  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-ink-muted">Friday · overnight</p>
      <p className="font-display text-[20px] font-semibold text-ink">Three movements worth reading</p>
      {rows.map(([company, text, color, source]) => (
        <div key={company} className="rounded-xl bg-surface p-3 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink">{company}</span>
            <Chip tone={color}>{source}</Chip>
          </div>
          <p className="mt-1 text-[13px] text-ink-secondary">{text}</p>
        </div>
      ))}
    </div>
  );
}

function Predictions() {
  const rows = [
    ["Kestrel", "Managed Postgres adapter", "72%", "Open", "bg-accent-tint text-accent ring-accent-line"],
    ["Tidewater", "Retires the free tier", "64%", "Hit", "bg-[#e6f5ec] text-[var(--color-outcome-hit)] ring-[#b5dfc5]"],
    ["Parallax", "EU data region", "55%", "Miss", "bg-[#fdecef] text-[var(--color-outcome-miss)] ring-[#f3c0ca]"],
    ["Halcyon", "Usage pricing on team plan", "40%", "Unresolved", "bg-surface-sunken text-ink-muted ring-line"],
  ] as const;
  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-card)]">
      {rows.map(([company, claim, p, status, cls]) => (
        <div key={company} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink">{company}</p>
            <p className="truncate text-[12.5px] text-ink-secondary">{claim}</p>
          </div>
          <span className="font-mono text-[13px] text-ink tabular">{p}</span>
          <span className={`w-[84px] rounded-md px-1.5 py-0.5 text-center text-[11px] font-medium ring-1 ${cls}`}>
            {status}
          </span>
        </div>
      ))}
    </div>
  );
}

function Scorecard() {
  return (
    <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-tint-lilac px-3 py-2.5">
          <div className="font-mono text-[26px] text-ink">—</div>
          <div className="text-[11.5px] text-ink-muted">Brier score</div>
        </div>
        <div className="rounded-lg bg-tint-flare px-3 py-2.5">
          <div className="font-mono text-[26px] text-ink">0.25</div>
          <div className="text-[11.5px] text-ink-muted">Coin-flip baseline</div>
        </div>
      </div>
      <div className="mt-4 flex h-24 items-end gap-1.5" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-md border border-dashed border-line-strong"
            style={{ height: `${(i + 1) * 10}%` }}
          />
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-ink-secondary">
        One bar per confidence band. They fill in as predictions resolve — until then the score reads “—”,
        never zero.
      </p>
    </div>
  );
}

function AskSignal() {
  return (
    <div className="space-y-2.5">
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-midnight px-3.5 py-2 text-[13px] text-white">
        What is Kestrel likely to ship next?
      </div>
      <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink shadow-[var(--shadow-card)]">
        A managed Postgres adapter looks likely — 72%. A flagged driver merged in their engine repo{" "}
        <span className="font-mono text-accent">[1]</span>, two database roles opened{" "}
        <span className="font-mono text-accent">[2]</span>, and the product page changed its copy{" "}
        <span className="font-mono text-accent">[3]</span>.
      </div>
      <div className="rounded-xl bg-surface p-3 shadow-[var(--shadow-card)] ring-1 ring-accent-line">
        <p className="text-[12.5px] text-ink">
          Start tracking <span className="font-semibold">Tidewater</span> and run discovery?
        </p>
        <div className="mt-2 flex gap-2">
          <span className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white">Approve</span>
          <span className="rounded-md px-2.5 py-1 text-[12px] text-ink-secondary ring-1 ring-line">Decline</span>
        </div>
      </div>
    </div>
  );
}

function Slack() {
  return (
    <div className="rounded-xl bg-surface p-3.5 shadow-[var(--shadow-card)]">
      <p className="text-[12px] font-semibold text-ink-muted"># competitive</p>
      {[
        ["Prediction resolved", "Tidewater retired its free tier — hit. Stated 64%."],
        ["New forecast", "Kestrel · managed Postgres adapter · 72% · resolves Dec 15"],
      ].map(([title, body]) => (
        <div key={title} className="mt-3 flex gap-2.5">
          <span className="mt-0.5 h-7 w-7 shrink-0 rounded-lg bg-[linear-gradient(135deg,#2b61cc,#061436)]" />
          <div>
            <p className="text-[12.5px]">
              <span className="font-semibold text-ink">Signal</span>{" "}
              <span className="rounded bg-surface-sunken px-1 text-[10px] text-ink-muted">APP</span>
            </p>
            <p className="text-[12.5px] font-medium text-ink">{title}</p>
            <p className="text-[12.5px] text-ink-secondary">{body}</p>
          </div>
        </div>
      ))}
      <div className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-[12.5px] text-ink-muted">
        @Signal why did Halcyon go quiet?
      </div>
    </div>
  );
}

const TABS = [
  { id: "briefing", title: "Briefing", body: "What moved overnight, ranked by how much it matters.", tint: "bg-tint-mist", Panel: Briefing },
  { id: "predictions", title: "Predictions", body: "Dated claims with a probability and the evidence behind them.", tint: "bg-tint-blue", Panel: Predictions },
  { id: "scorecard", title: "Scorecard", body: "Every resolved forecast, Brier-scored against a coin flip.", tint: "bg-tint-lilac", Panel: Scorecard },
  { id: "ask", title: "Ask Signal", body: "Questions answered from collected evidence, with citations.", tint: "bg-tint-flare", Panel: AskSignal },
  { id: "slack", title: "Slack", body: "Forecasts and resolutions where your team already talks.", tint: "bg-tint-sage", Panel: Slack },
] as const;

export function ProductTour() {
  const [active, setActive] = useState<(typeof TABS)[number]["id"]>("predictions");
  const tab = TABS.find((item) => item.id === active) ?? TABS[0];
  const Panel = tab.Panel;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr] lg:gap-10">
      <div role="tablist" aria-label="Product surfaces" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {TABS.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="tour-panel"
              onClick={() => setActive(item.id)}
              className={`relative shrink-0 rounded-xl px-4 py-3 text-left transition-colors lg:w-full ${
                selected
                  ? "bg-surface shadow-[var(--shadow-card)] before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r before:bg-flare"
                  : "hover:bg-surface/60"
              }`}
            >
              <span className={`block text-[15px] font-semibold ${selected ? "text-ink" : "text-ink-secondary"}`}>
                {item.title}
              </span>
              <span className="mt-0.5 hidden text-[13px] leading-snug text-ink-muted lg:block">{item.body}</span>
            </button>
          );
        })}
      </div>

      <div
        id="tour-panel"
        role="tabpanel"
        aria-label={tab.title}
        className={`relative overflow-hidden rounded-[22px] ${tab.tint} p-5 ring-1 ring-line sm:p-8`}
      >
        <div className="dot-field pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
        <div key={tab.id} className="rise-in relative mx-auto max-w-[520px]" style={{ animationDuration: "380ms" }}>
          <Panel />
        </div>
        <p className="relative mt-5 text-center text-[11.5px] text-ink-muted">Illustrative · fictional companies</p>
      </div>
    </div>
  );
}
