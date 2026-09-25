// Signal v4 primitives — the design system expressed as components (DESIGN.md).
//
// Two rules are enforced here rather than left to discipline:
//   - Depth is a hairline plus an ink-tinted shadow, never a grey drop shadow.
//   - Numbers render in tabular mono, so columns align and a value that changes
//     does not shift horizontally.
import type { ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* --- Surfaces ----------------------------------------------------------- */

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <Tag
      className={cx(
        "rounded-xl bg-surface shadow-[var(--shadow-card)]",
        className
      )}
    >
      {children}
    </Tag>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("p-5", className)}>{children}</div>;
}

export function CardHeader({
  title,
  action,
  description,
}: {
  title: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="font-sans text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-[13px] text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* --- Page scaffolding --------------------------------------------------- */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="font-display text-[32px] leading-tight font-semibold text-ink">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[14.5px] leading-relaxed text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 font-sans text-[12px] font-semibold tracking-normal text-ink-muted">{children}</h2>
  );
}

/* --- The signature ------------------------------------------------------ */

// The one place this interface raises its voice. `unit` stays small and muted
// so the number itself reads as the content.
export function Metric({
  value,
  unit,
  label,
  size = "lg",
  tone = "default",
}: {
  value: string;
  unit?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "muted" | "hit" | "miss";
}) {
  const sizes = {
    sm: "text-[20px]",
    md: "text-[32px]",
    lg: "text-[44px]",
  } as const;
  const tones = {
    default: "text-ink",
    muted: "text-ink-muted",
    hit: "text-[var(--color-outcome-hit)]",
    miss: "text-[var(--color-outcome-miss)]",
  } as const;

  return (
    <div>
      <div className={cx("metric", sizes[size], tones[tone])}>
        {value}
        {unit ? (
          <span className="ml-1 align-baseline text-[0.45em] font-normal text-ink-muted">
            {unit}
          </span>
        ) : null}
      </div>
      {label ? (
        <div className="mt-1.5 text-[12px] font-medium text-ink-muted">{label}</div>
      ) : null}
    </div>
  );
}

// Inline numeric text — dates, counts, ids. Same tabular treatment at body size.
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono tabular text-[13px]", className)}>{children}</span>;
}

/* --- Controls ----------------------------------------------------------- */

// Primary is Signal blue — the interactive colour. Flare is reserved for the
// brand's commitment moments (start tracking, create a workspace) and always
// carries midnight text: white on orange fails AA.
export function Button({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "flare" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const variants = {
    primary: "bg-accent text-white shadow-[0_1px_2px_rgba(14,29,58,0.12)] hover:bg-accent-hover disabled:bg-ink-muted",
    flare: "bg-flare text-midnight hover:bg-flare-hover disabled:opacity-60",
    secondary:
      "border border-line-strong bg-surface text-ink hover:bg-surface-sunken disabled:text-ink-muted",
    ghost: "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
    danger:
      "border border-line-strong bg-surface text-[var(--color-status-critical)] hover:bg-surface-sunken",
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "hit" | "miss" | "unresolved" | "open";
}) {
  const tones = {
    neutral: "border-line bg-surface-sunken text-ink-secondary",
    accent: "border-[var(--color-accent-line)] bg-accent-tint text-accent",
    hit: "border-[#b5dfc5] bg-[#e6f5ec] text-[var(--color-outcome-hit)]",
    miss: "border-[#f3c0ca] bg-[#fdecef] text-[var(--color-outcome-miss)]",
    // Neutral on purpose. An unresolved window is not a failure, and colouring
    // it like one would make the ledger overstate how often Signal was wrong.
    unresolved: "border-line bg-surface-sunken text-ink-muted",
    open: "border-[var(--color-accent-line)] bg-accent-tint text-accent",
  } as const;

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

/* --- States ------------------------------------------------------------- */

// Designed, not omitted. `note` is where a surface explains why it is empty,
// which is the difference between "nothing here" and "here is what has to
// happen before something appears".
export function EmptyState({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-tint-blue),var(--color-tint-lilac))] ring-1 ring-line">
        <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
          <path d="M6 19h3.6l2-6 3.5 11 2.4-7.7" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="23.6" cy="16.3" r="2.6" fill="var(--color-flare)" />
        </svg>
      </span>
      <p className="font-display text-[17px] font-semibold text-ink">{title}</p>
      {note ? <p className="mt-1.5 max-w-md text-[13px] text-ink-secondary">{note}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-surface shadow-[var(--shadow-card)]" />
      ))}
    </div>
  );
}

// Every data surface needs a bounded failure path — a spinner that never
// resolves is the worst state a dashboard can be in, because it looks like
// working software.
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-[#f3c0ca] bg-[#fdecef] px-5 py-4">
      <p className="text-[14px] font-medium text-[var(--color-status-critical)]">
        Couldn&rsquo;t load this
      </p>
      <p className="mt-1 text-[13px] text-ink-secondary">{message}</p>
      {onRetry ? (
        <div className="mt-3">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </div>
  );
}

/* --- Data --------------------------------------------------------------- */

export function StatusDot({ color, label }: { color: string; label?: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}

// A horizontal probability meter. Reads faster than a number alone at a glance,
// and keeps the number alongside it so the precise value is never lost.
export function ProbabilityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={`${pct} percent likely`}
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-trace-b),var(--color-accent))]"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <span className="font-mono tabular text-[13px] font-medium text-ink">{pct}%</span>
    </div>
  );
}
