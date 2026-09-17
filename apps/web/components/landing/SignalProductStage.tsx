const evidence = [
  {
    source: "Pricing page",
    detail: "Team plan moved from $39 to $49 per seat",
    time: "06:14",
  },
  {
    source: "Product changelog",
    detail: "Advanced permissions moved into the Team plan",
    time: "05:48",
  },
  {
    source: "Jobs board",
    detail: "Three new enterprise account roles opened",
    time: "03:22",
  },
];

function SourceTrailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
      <path
        d="M4.5 5.5h7m-7 4h11m-11 4h8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="14.5" cy="5.5" r="1.5" fill="currentColor" />
      <circle cx="3.5" cy="9.5" r="1.5" fill="currentColor" />
      <circle cx="13.5" cy="13.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path
        d="M6 14 14 6m-6 0h6v6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SignalProductStage() {
  return (
    <div className="studio-stage-enter relative w-full overflow-hidden rounded-4xl border border-white/80 bg-studio-paper shadow-[0_28px_70px_-32px_rgba(10,32,51,0.38)]">
      <div className="flex min-h-14 items-center justify-between border-b border-studio-line/80 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-studio-action" />
          <span className="text-xs font-semibold text-studio-ink sm:text-sm">
            Overnight briefing
          </span>
          <span className="hidden text-xs text-studio-muted sm:inline">
            Example workspace
          </span>
        </div>
        <div className="flex items-center gap-2 text-[0.7rem] font-medium text-studio-muted sm:text-xs">
          <span>Evidence current</span>
          <span className="h-1 w-1 rounded-full bg-studio-action" />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.08fr_0.92fr]">
        <div className="border-b border-studio-line/80 p-4 sm:p-6 lg:border-r lg:border-b-0">
          <div className="flex items-start justify-between gap-5">
            <div>
              <h2 className="max-w-lg font-display text-xl leading-tight font-bold tracking-[-0.035em] text-studio-ink sm:text-2xl">
                Northstar raised its Team plan and repositioned enterprise access
              </h2>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[0.65rem] font-semibold text-studio-muted uppercase">
                Signal score
              </p>
              <div className="mt-1 flex items-baseline justify-end gap-1.5">
                <span className="font-display text-3xl font-bold tracking-[-0.04em] text-studio-ink">
                  82
                </span>
                <span className="text-xs font-bold text-studio-action">+8</span>
              </div>
            </div>
          </div>

          <div className="relative mt-6">
            <div className="absolute top-[1.45rem] bottom-[1.45rem] left-[0.43rem] w-px bg-studio-line" />
            <div className="space-y-4">
              {evidence.map((item, index) => (
                <div
                  key={item.source}
                  className="relative grid grid-cols-[1rem_1fr_auto] items-start gap-3"
                >
                  <span className="relative z-10 mt-1 h-3.5 w-3.5 rounded-full border-[3px] border-studio-paper bg-studio-action shadow-[0_0_0_1px_#87bfe7]" />
                  <div>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <p className="text-xs font-bold text-studio-ink">{item.source}</p>
                      <span className="text-[0.68rem] text-studio-muted">Source {index + 1}</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-studio-muted sm:text-sm">
                      {item.detail}
                    </p>
                  </div>
                  <span className="font-mono text-[0.65rem] text-studio-muted tabular-nums">
                    {item.time}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-studio-line pt-5">
            <div className="flex items-center gap-2 text-studio-action">
              <SourceTrailIcon />
              <p className="text-xs font-bold">Strategic interpretation</p>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-studio-ink">
              The pricing move aligns with a visible push toward larger accounts. Treat this
              as a packaging shift, not an isolated price test: permissions changed on the
              same release cycle and enterprise hiring is increasing.
            </p>
          </div>
        </div>

        <div className="flex min-h-108 flex-col bg-studio-sky-soft">
          <div className="border-b border-studio-line/80 px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-studio-ink">Ask Signal</p>
                <p className="mt-0.5 text-[0.68rem] text-studio-muted">
                  Persistent research thread
                </p>
              </div>
              <span className="rounded-full border border-studio-line bg-studio-paper px-2.5 py-1 text-[0.65rem] font-bold text-studio-muted">
                3 sources
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-4 p-4 sm:p-6">
            <div className="ml-auto max-w-[85%] rounded-[1.2rem_1.2rem_0.35rem_1.2rem] bg-studio-ink px-4 py-3 text-xs leading-relaxed text-white sm:text-sm">
              Why does this movement matter for our mid-market position?
            </div>
            <div className="max-w-[94%] border-l border-studio-action pl-4">
              <p className="text-xs leading-relaxed text-studio-ink sm:text-sm">
                Northstar appears to be creating more separation between self-serve and
                enterprise buyers. The 26% Team-plan increase is supported by the packaging
                change <a href="#evidence-workflow" className="font-bold text-studio-action underline decoration-studio-line underline-offset-4">[1][2]</a>,
                while new account roles suggest the motion is being reinforced commercially{" "}
                <a href="#evidence-workflow" className="font-bold text-studio-action underline decoration-studio-line underline-offset-4">[3]</a>.
              </p>
              <p className="mt-3 text-[0.68rem] font-semibold text-studio-muted">
                Answered from this workspace&apos;s source trail
              </p>
            </div>
          </div>

          <div className="border-t border-studio-line/80 p-4 sm:px-6">
            <div className="flex min-h-11 items-center justify-between rounded-xl border border-studio-line bg-studio-paper px-3.5">
              <span className="text-xs text-studio-muted">Ask a follow-up about this movement</span>
              <span className="text-studio-action">
                <ArrowUpRightIcon />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="studio-evidence-pulse absolute top-[3.45rem] left-0 h-0.5 w-full bg-studio-action/70" />
    </div>
  );
}
