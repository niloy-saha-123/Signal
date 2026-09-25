// Capabilities as a bento grid: cards of different sizes, each carrying a small
// rendering of the actual feature instead of an icon and a sentence. Varied
// spans are deliberate — a row of identical cards is the single most
// recognisable template layout, and it flattens features of very different
// weight into the same visual importance.
//
// All companies, repositories and people shown are fictional.
import type { ReactNode } from "react";

function Card({
  className,
  tint,
  title,
  body,
  children,
}: {
  className?: string;
  tint: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl border border-line ${className ?? ""}`}
      style={{ backgroundColor: tint }}
    >
      <div className="p-6 pb-4">
        <h3 className="text-[17px] leading-snug font-semibold tracking-[-0.015em] text-ink">{title}</h3>
        <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-secondary">{body}</p>
      </div>
      <div className="mt-auto px-6 pb-6" aria-hidden="true">
        {children}
      </div>
    </article>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-3 shadow-[0_8px_24px_-16px_rgba(11,59,56,0.25)] ${className ?? ""}`}>
      {children}
    </div>
  );
}

function LedgerMini() {
  const rows = [
    { c: "Kestrel", s: "Managed Postgres adapter", p: 72, tag: "Open", tone: "open" },
    { c: "Parallax", s: "Retires the free tier", p: 64, tag: "Hit", tone: "hit" },
    { c: "Tidewater", s: "Opens an EU region", p: 55, tag: "Miss", tone: "miss" },
  ] as const;
  const tones = {
    open: "border-[var(--color-accent-line)] bg-accent-tint text-accent",
    hit: "border-[#b7e0b7] bg-[#eef8ee] text-[var(--color-outcome-hit)]",
    miss: "border-[#f0c4c4] bg-[#fdeeee] text-[var(--color-outcome-miss)]",
  };
  return (
    <Panel>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.c} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <span className="w-16 shrink-0 text-[12px] font-semibold text-ink">{r.c}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary">{r.s}</span>
            <span className={`rounded-sm border px-1.5 py-px text-[10px] font-medium ${tones[r.tone]}`}>
              {r.tag}
            </span>
            <span className="w-9 text-right font-mono text-[12px] tabular-nums text-ink">{r.p}%</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CalibrationMini() {
  // Bars only, no figures: this is the shape of the scorecard, not a claim
  // about how well Signal has done.
  const bands = [
    { said: 0.35, happened: 0.3 },
    { said: 0.55, happened: 0.6 },
    { said: 0.75, happened: 0.7 },
  ];
  return (
    <Panel>
      <div className="space-y-2.5">
        {bands.map((b, i) => (
          <div key={i} className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div className="h-full rounded-full bg-ink-muted" style={{ width: `${b.said * 100}%` }} />
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div className="h-full rounded-full bg-accent" style={{ width: `${b.happened * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-3 text-[10px] text-ink-muted">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-full bg-ink-muted" /> said
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-3 rounded-full bg-accent" /> happened
        </span>
      </div>
    </Panel>
  );
}

function GithubMini() {
  const prs = [
    { t: "feat: pg driver behind a flag", k: "open" },
    { t: "docs: postgres adapter guide (draft)", k: "draft" },
    { t: "release v4.2.0-rc.1", k: "release" },
  ];
  return (
    <Panel>
      <div className="mb-2 font-mono text-[10px] text-ink-muted">kestrel/engine</div>
      <ul className="space-y-1.5">
        {prs.map((pr) => (
          <li key={pr.t} className="flex items-center gap-2">
            <span
              className={
                pr.k === "release"
                  ? "h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  : "h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-trace-b)]"
              }
            />
            <span className="truncate font-mono text-[11px] text-ink">{pr.t}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ChatMini() {
  return (
    <div className="space-y-2">
      <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-ink px-3 py-2 text-[12px] text-ink-inverse">
        Start tracking Kestrel
      </div>
      <Panel>
        <p className="text-[12px] text-ink">Create competitor &ldquo;Kestrel&rdquo; and start discovery?</p>
        <div className="mt-2 flex gap-1.5">
          <span className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white">Approve</span>
          <span className="rounded-md border border-line-strong px-2.5 py-1 text-[11px] font-medium text-ink">
            Decline
          </span>
        </div>
      </Panel>
    </div>
  );
}

function SlackMini() {
  return (
    <Panel>
      <div className="flex gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink">
          <svg viewBox="0 0 32 32" className="h-4 w-4">
            <path
              d="M6 19h3.6l2-6 3.5 11 2.4-7.7h4"
              fill="none"
              stroke="#faf9f7"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-ink">
            Signal <span className="font-normal text-ink-muted">· #competitive</span>
          </div>
          <p className="mt-0.5 text-[12px] text-ink">
            <span className="font-semibold">Parallax</span> — prediction resolved:{" "}
            <span className="font-semibold text-[var(--color-outcome-hit)]">Hit</span>
          </p>
          <p className="text-[11px] text-ink-muted">Misses are posted just as plainly.</p>
        </div>
      </div>
    </Panel>
  );
}

function ActivityMini() {
  const runs = [
    ["Kestrel", "analysis", "completed"],
    ["Halcyon", "collection", "completed"],
    ["Tidewater", "analysis", "running"],
  ];
  return (
    <Panel>
      <ul className="space-y-1.5">
        {runs.map(([c, kind, status]) => (
          <li key={c} className="flex items-center gap-2 text-[11px]">
            <span
              className={
                status === "running"
                  ? "h-1.5 w-1.5 rounded-full bg-[var(--color-trace-b)]"
                  : "h-1.5 w-1.5 rounded-full bg-[var(--color-outcome-hit)]"
              }
            />
            <span className="w-16 font-semibold text-ink">{c}</span>
            <span className="text-ink-muted">{kind}</span>
            <span className="ml-auto text-ink-secondary">{status}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full w-1/3 rounded-full bg-accent" />
      </div>
      <div className="mt-1 text-[10px] text-ink-muted">within today&rsquo;s model budget</div>
    </Panel>
  );
}

function RefusalMini() {
  return (
    <Panel>
      <p className="text-[12px] text-ink">I don&rsquo;t have enough evidence to answer that.</p>
      <p className="mt-1 text-[11px] text-ink-muted italic">
        Only two signals mention the EU region, both unconfirmed community posts.
      </p>
    </Panel>
  );
}

export function Bento() {
  return (
    <div className="grid gap-4 md:grid-cols-6">
      <Card
        className="md:col-span-4"
        tint="var(--color-tint-teal)"
        title="A ledger, not a feed"
        body="Every forward-looking claim is written down with a probability, a date, and the evidence behind it — then marked hit, miss, or unresolved when the date arrives."
      >
        <LedgerMini />
      </Card>
      <Card
        className="md:col-span-2"
        tint="var(--color-tint-sky)"
        title="Graded in the open"
        body="What it said against what happened, by confidence band."
      >
        <CalibrationMini />
      </Card>
      <Card
        className="md:col-span-2"
        tint="var(--color-tint-sand)"
        title="Lead time from code"
        body="Pull requests and release candidates, read before the launch post exists."
      >
        <GithubMini />
      </Card>
      <Card
        className="md:col-span-2"
        tint="var(--color-tint-sage)"
        title="Talk to it, and it acts"
        body="Ask a question or give an instruction. Anything that writes or spends waits for your approval."
      >
        <ChatMini />
      </Card>
      <Card
        className="md:col-span-2"
        tint="var(--color-tint-clay)"
        title="Lives in your Slack"
        body="Predictions and resolutions posted where your team already works."
      >
        <SlackMini />
      </Card>
      <Card
        className="md:col-span-3"
        tint="var(--color-tint-stone)"
        title="Autonomy you can watch"
        body="Every run, what it decided, what it spent, and whether anything it depends on is down."
      >
        <ActivityMini />
      </Card>
      <Card
        className="md:col-span-3"
        tint="var(--color-tint-sky)"
        title="Declines instead of guessing"
        body="When the evidence is thin it says so, with the reason — rather than a fluent answer that happens to be invented."
      >
        <RefusalMini />
      </Card>
    </div>
  );
}
