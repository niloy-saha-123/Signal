import { Sig } from "@/components/brand/Sig";

// The hero's right side: Signal arriving where a product team already works —
// a Slack channel, its own cited chat, and an AI coding tool over MCP. Windows
// rise in once, staggered (CSS only; static under reduced motion). Companies
// are fictional; the strip under the stage says so.

function WindowBar({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
      <span className="text-[13px] font-bold text-ink">{title}</span>
      <span className="ml-auto text-[12px] text-ink-muted">{meta}</span>
    </div>
  );
}

function Cursor({ name, color, className }: { name: string; color: string; className: string }) {
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute hidden items-start gap-0.5 lg:flex ${className}`}>
      <svg width="14" height="16" viewBox="0 0 14 16" className="mt-[-2px]">
        <path d="M1 1l11 6.2-4.8 1.3L5 13.6 1 1Z" fill={color} stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-white" style={{ backgroundColor: color }}>
        {name}
      </span>
    </span>
  );
}

const WINDOW = "window-in rounded-[18px] bg-surface shadow-[var(--shadow-window)]";

export function HeroWindows() {
  return (
    <div className="relative min-w-0">
      <div className="flex flex-col gap-4 lg:block lg:h-[600px]">
        {/* Slack */}
        <section
          aria-label="A forecast posted to Slack"
          className={`${WINDOW} lg:absolute lg:top-0 lg:left-0 lg:w-[392px]`}
          style={{ animationDelay: "120ms" }}
        >
          <WindowBar title="# product-roadmap" meta="Slack" />
          <div className="flex gap-3 px-4 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-sky">
              <Sig size={28} decorative />
            </span>
            <div className="min-w-0 text-[14px]">
              <p>
                <span className="font-bold text-ink">Signal</span>{" "}
                <span className="text-[12px] text-ink-muted">9:02 AM</span>
              </p>
              <div className="mt-1.5 rounded-[10px] bg-sky px-3 py-2.5">
                <p className="font-semibold text-ink">Kestrel: Postgres adapter by Dec 15</p>
                <p className="mt-0.5 text-ink-secondary">
                  Now <span className="tnum font-bold text-ink">72%</span>, up from 63%. Two database roles were
                  posted overnight.
                </p>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <span className="rounded-[8px] border border-line-strong px-2.5 py-1 text-[12.5px] font-semibold text-ink">
                  Show evidence
                </span>
                <span className="rounded-[8px] border border-line-strong px-2.5 py-1 text-[12.5px] font-semibold text-ink">
                  Link to roadmap
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Ask Signal */}
        <section
          aria-label="A question answered by Signal with citations"
          className={`${WINDOW} lg:absolute lg:top-[238px] lg:right-0 lg:w-[340px]`}
          style={{ animationDelay: "380ms" }}
        >
          <WindowBar title="Ask Signal" meta="cites every claim" />
          <div className="space-y-3 px-4 py-3.5 text-[14px]">
            <p className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-[4px] bg-ink px-3 py-2 text-white">
              Is Kestrel coming for our Postgres users?
            </p>
            <div className="flex gap-2.5">
              <Sig size={26} decorative className="mt-0.5 shrink-0" />
              <p className="leading-relaxed text-ink-secondary">
                Probably this quarter. They merged a pg driver behind a flag
                <Cite n={1} />, posted two database roles
                <Cite n={2} /> and changed their product copy
                <Cite n={3} />.
              </p>
            </div>
          </div>
        </section>

        {/* MCP */}
        <section
          aria-label="Signal queried from an AI coding tool over MCP"
          className={`${WINDOW} overflow-hidden lg:absolute lg:bottom-0 lg:left-8 lg:w-[372px]`}
          style={{ animationDelay: "640ms" }}
        >
          <WindowBar title="signal · MCP" meta="Claude · Cursor" />
          <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-ink-secondary">
            <span className="text-ink-muted">{"// tool call"}</span>
            {"\n"}
            <span className="font-semibold text-[#4a3aa7]">list_forecasts</span>
            {"({ competitor: "}
            <span className="text-[#0a7a4b]">&quot;kestrel&quot;</span>
            {" })\n"}
            <span className="text-ink-muted">{"→ 3 open · top: postgres adapter 0.72"}</span>
          </pre>
        </section>

        <Cursor name="Priya, PM" color="#d63c55" className="top-[214px] left-[236px]" />
        <Cursor name="Dev, eng lead" color="#1f6fd1" className="right-[40px] bottom-[96px]" />
      </div>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 rounded-[4px] bg-accent-tint px-1 text-[10px] font-bold text-accent">{n}</sup>
  );
}
