"use client";

import { useState } from "react";

const VIEWS = [
  {
    id: "sources",
    label: "Sources",
    title: "Pricing, changelog, and hiring stay attached to one movement.",
  },
  {
    id: "movement",
    label: "Movement",
    title: "Related changes collapse into a single event worth reviewing.",
  },
  {
    id: "meaning",
    label: "Meaning",
    title: "The interpretation stays next to the evidence that produced it.",
  },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

function SourcesView() {
  return (
    <div className="grid gap-3">
      {[
        ["Pricing page", "Team plan $39 → $49 / seat", "06:14"],
        ["Product changelog", "Advanced permissions moved into Team", "05:48"],
        ["Jobs board", "Three enterprise account roles opened", "03:22"],
      ].map(([source, detail, time], index) => (
        <div
          key={source}
          className={`grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-[10px] px-4 py-3.5 ${
            index === 0 ? "bg-studio-ink text-white" : "bg-studio-sky-soft text-studio-ink"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              index === 0 ? "bg-studio-sky-deep" : "bg-studio-action"
            }`}
          />
          <div>
            <p className="text-sm font-bold">{source}</p>
            <p
              className={`mt-0.5 text-xs leading-relaxed ${
                index === 0 ? "text-studio-sky-deep" : "text-studio-muted"
              }`}
            >
              {detail}
            </p>
          </div>
          <span
            className={`font-mono text-[0.7rem] tabular-nums ${
              index === 0 ? "text-studio-sky-deep" : "text-studio-muted"
            }`}
          >
            {time}
          </span>
        </div>
      ))}
    </div>
  );
}

function MovementView() {
  return (
    <div className="rounded-[1.6rem] bg-studio-sky-soft p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-studio-muted">Northstar · overnight</p>
          <h3 className="mt-2 max-w-md font-display text-xl font-bold tracking-[-0.03em] text-studio-ink sm:text-2xl">
            Team plan raised and enterprise access repositioned
          </h3>
        </div>
        <p className="font-display text-3xl font-bold tabular-nums text-studio-ink">82</p>
      </div>
      <div className="mt-6 flex h-24 items-end gap-2">
        {[38, 44, 41, 49, 53, 58, 86].map((height, index) => (
          <div
            key={index}
            className={`w-full rounded-t-md ${
              index === 6 ? "bg-studio-action" : "bg-studio-sky-deep"
            }`}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      <p className="mt-4 text-xs font-semibold text-studio-muted">
        Mention volume · last 7 days · current window highlighted
      </p>
    </div>
  );
}

function MeaningView() {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <p className="text-sm leading-relaxed text-studio-ink">
          The price change landed with a packaging shift and commercial hiring in the same
          window. Treat it as a move toward larger accounts, not a one-off test.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {["Pricing evidence", "Release context", "Hiring trajectory"].map((item) => (
            <span
              key={item}
              className="rounded-full border border-studio-line bg-studio-paper px-3 py-1.5 text-xs font-bold text-studio-ink"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="rounded-[1.4rem] bg-studio-ink px-5 py-5 text-white">
        <p className="text-xs font-semibold text-studio-sky-deep">Analyst still decides</p>
        <p className="mt-2 text-sm leading-relaxed">
          Open every source, confirm discovered entities, and choose whether this becomes
          an alert.
        </p>
      </div>
    </div>
  );
}

export function LandingWorkspace() {
  const [active, setActive] = useState<ViewId>("sources");
  const current = VIEWS.find((view) => view.id === active) ?? VIEWS[0];

  return (
    <div className="overflow-hidden rounded-[2rem] border border-studio-line bg-studio-paper shadow-[0_28px_70px_-38px_rgba(10,32,51,0.35)]">
      <div className="flex flex-col gap-5 border-b border-studio-line px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <p className="max-w-xl font-display text-xl font-bold tracking-[-0.03em] text-studio-ink sm:text-2xl">
          {current.title}
        </p>
        <div className="flex w-fit gap-1 rounded-full bg-studio-sky-soft p-1">
          {VIEWS.map((view) => {
            const isActive = view.id === active;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => setActive(view.id)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  isActive
                    ? "bg-studio-ink text-white"
                    : "text-studio-muted hover:text-studio-ink"
                }`}
              >
                {view.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="p-5 sm:p-7">
        {active === "sources" && <SourcesView />}
        {active === "movement" && <MovementView />}
        {active === "meaning" && <MeaningView />}
      </div>
    </div>
  );
}
