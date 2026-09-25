// A reliability diagram with nothing in it yet — on purpose. The axes, the
// "perfectly calibrated" diagonal and ten empty confidence bands show how the
// scorecard reads; no bar is drawn because no prediction has resolved, and
// inventing bars would be the one lie this product cannot tell.
export function Calibration() {
  const size = 260;
  const pad = 34;
  const inner = size - pad * 1.4;
  const band = inner / 10;

  return (
    <div className="rounded-[22px] border border-midnight-line bg-midnight-raised p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-white">Scorecard</p>
        <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-midnight-muted">
          0 resolved
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/[0.06] px-3.5 py-3">
          <div className="font-mono text-[28px] leading-none text-white">—</div>
          <div className="mt-1.5 text-[12px] text-midnight-muted">Brier score</div>
        </div>
        <div className="rounded-xl bg-white/[0.06] px-3.5 py-3">
          <div className="font-mono text-[28px] leading-none text-white">0.25</div>
          <div className="mt-1.5 text-[12px] text-midnight-muted">Coin-flip baseline</div>
        </div>
      </div>

      <svg viewBox={`0 0 ${size} ${size}`} className="mt-5 h-auto w-full" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => {
          const x = pad + i * band + 2;
          const h = ((i + 0.5) / 10) * inner;
          return (
            <rect
              key={i}
              x={x}
              y={pad * 0.4 + inner - h}
              width={band - 4}
              height={h}
              rx="3"
              fill="none"
              stroke="#9aa7c4"
              strokeOpacity="0.35"
              strokeDasharray="3 3"
            />
          );
        })}
        <line
          x1={pad}
          y1={pad * 0.4 + inner}
          x2={pad + inner}
          y2={pad * 0.4}
          stroke="var(--color-flare)"
          strokeWidth="1.6"
          strokeDasharray="5 4"
        />
        <line x1={pad} y1={pad * 0.4} x2={pad} y2={pad * 0.4 + inner} stroke="#22335f" />
        <line x1={pad} y1={pad * 0.4 + inner} x2={pad + inner} y2={pad * 0.4 + inner} stroke="#22335f" />
        <text x={pad + inner - 2} y={pad * 0.4 + 14} textAnchor="end" fontSize="10" fill="#f96e31" fontFamily="var(--font-mono)">
          perfectly calibrated
        </text>
        <text x={pad + inner / 2} y={size - 4} textAnchor="middle" fontSize="10" fill="#9aa7c4" fontFamily="var(--font-mono)">
          stated probability
        </text>
        <text
          x="10"
          y={pad * 0.4 + inner / 2}
          textAnchor="middle"
          fontSize="10"
          fill="#9aa7c4"
          fontFamily="var(--font-mono)"
          transform={`rotate(-90 10 ${pad * 0.4 + inner / 2})`}
        >
          how often it happened
        </text>
      </svg>

      <p className="mt-3 text-[12.5px] leading-relaxed text-midnight-muted">
        Bars fill in as your predictions resolve. Until then the score reads “—”, never zero — zero would claim a
        perfect record.
      </p>
    </div>
  );
}
