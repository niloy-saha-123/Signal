// Signal v3 primitives — the design direction expressed as components.
//
// Surfaces compose these rather than re-deriving spacing, borders and type each
// time. That is the mechanism that stops the interface drifting back toward
// "every container rounded-[10px] + + 1px border", which is how the
// previous iteration ended up looking like every other SaaS dashboard.
//
// Two rules are enforced here rather than left to discipline:
//   - A static container gets a border, never a shadow.
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
        "rounded-[10px] border border-line bg-surface",
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
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
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
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-[14px] text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-[12px] font-semibold tracking-[0.01em] text-ink-muted">{children}</h2>
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

// Solid ink for the primary action, not a tinted accent pill. The accent marks
// what is interactive; ink marks what is chosen.
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
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const variants = {
    primary: "bg-ink text-ink-inverse hover:bg-[#33322e] disabled:bg-ink-muted",
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
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed",
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
    hit: "border-[#b7e0b7] bg-[#eef8ee] text-[var(--color-outcome-hit)]",
    miss: "border-[#f0c4c4] bg-[#fdeeee] text-[var(--color-outcome-miss)]",
    // Neutral on purpose. An unresolved window is not a failure, and colouring
    // it like one would make the ledger overstate how often Signal was wrong.
    unresolved: "border-line bg-surface-sunken text-ink-muted",
    open: "border-[var(--color-accent-line)] bg-accent-tint text-accent",
  } as const;

  return (
    <span
      className={cx(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-medium",
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
    <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <p className="text-[15px] font-medium text-ink">{title}</p>
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
        <div key={i} className="h-16 animate-pulse rounded-[10px] border border-line bg-surface" />
      ))}
    </div>
  );
}

// Every data surface needs a bounded failure path — a spinner that never
// resolves is the worst state a dashboard can be in, because it looks like
// working software.
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-[10px] border border-[#f0c4c4] bg-[#fdeeee] px-5 py-4">
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
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <span className="font-mono tabular text-[13px] font-medium text-ink">{pct}%</span>
    </div>
  );
}
