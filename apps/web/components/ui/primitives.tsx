// Signal v5 primitives — the design system expressed as components (DESIGN.md).
//
// Rules enforced here rather than left to discipline:
//   - Static containers get a border, never a shadow. Floating things use
//     shadow-window / shadow-popover.
//   - Primary actions are solid ink. Sun is a fill under ink, never text.
//   - Numbers render with tabular figures so columns align and values that
//     update do not shift.
import Link from "next/link";
import type { ReactNode } from "react";
import { Sig, type SigMood } from "@/components/brand/Sig";
import { sourceColor, sourceLabel } from "@/lib/chart-colors";

export function cx(...parts: Array<string | false | null | undefined>): string {
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
    <Tag className={cx("rounded-[14px] border border-line bg-surface", className)}>{children}</Tag>
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
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-ink-secondary">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* --- Page scaffolding --------------------------------------------------- */

// Every page answers one question; `description` is that question's answer in
// one sentence, not marketing.
export function PageHeader({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[38px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-[15px] text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex max-w-full flex-wrap gap-2">{action}</div> : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </header>
  );
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[14px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

/* --- Numbers ------------------------------------------------------------ */

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
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "default" | "muted" | "hit" | "miss";
}) {
  const sizes = { sm: "text-[22px]", md: "text-[34px]", lg: "text-[48px]", xl: "text-[72px]" } as const;
  const tones = {
    default: "text-ink",
    muted: "text-ink-muted",
    hit: "text-outcome-hit",
    miss: "text-outcome-miss",
  } as const;

  return (
    <div>
      <div className={cx("metric", sizes[size], tones[tone])}>
        {value}
        {unit ? <span className="ml-1 text-[0.4em] font-normal text-ink-muted">{unit}</span> : null}
      </div>
      {label ? <div className="mt-2 text-[12.5px] font-medium text-ink-muted">{label}</div> : null}
    </div>
  );
}

export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("tnum", className)}>{children}</span>;
}

// A probability is the product. Big display numeral, optional meter.
export function Probability({
  value,
  size = "md",
  meter = false,
}: {
  value: number;
  size?: "sm" | "md" | "lg";
  meter?: boolean;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const sizes = { sm: "text-[20px]", md: "text-[30px]", lg: "text-[64px]" } as const;
  return (
    <div className="inline-flex flex-col items-end gap-1.5" aria-label={`${pct} percent likely`} role="img">
      <span className={cx("metric", sizes[size])} aria-hidden="true">
        {pct}%
      </span>
      {meter ? (
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
          <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(3, pct)}%` }} />
        </span>
      ) : null}
    </div>
  );
}

// Compact meter + number for dense rows.
export function ProbabilityBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={`${pct} percent likely`}
      >
        <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <span className="tnum text-[13px] font-semibold text-ink">{pct}%</span>
    </div>
  );
}

/* --- Controls ----------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "sun";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-[#1d3047] disabled:bg-ink-muted",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-sunken disabled:text-ink-muted",
  ghost: "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
  danger: "border border-line-strong bg-surface text-status-critical hover:bg-tint-rose",
  sun: "bg-sun text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)] hover:bg-[#ffdb63]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-[14px]",
  lg: "h-12 px-5 text-[15px]",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  type = "button",
  disabled,
  className,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

// Segmented tabs. Buttons when `onChange` is given, links when items carry href.
export function Tabs<T extends string>({
  items,
  active,
  onChange,
  label,
}: {
  items: Array<{ value: T; label: ReactNode; href?: string; count?: number }>;
  active: T;
  onChange?: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-[12px] bg-surface-sunken p-1">
      {items.map((item) => {
        const selected = item.value === active;
        const cls = cx(
          "inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold transition-colors",
          selected ? "bg-surface text-ink shadow-[0_1px_2px_rgba(15,29,43,0.12)]" : "text-ink-secondary hover:text-ink"
        );
        const content = (
          <>
            {item.label}
            {item.count !== undefined ? (
              <span className={cx("tnum text-[12px]", selected ? "text-ink-muted" : "text-ink-muted")}>
                {item.count}
              </span>
            ) : null}
          </>
        );
        return item.href ? (
          <Link key={item.value} href={item.href} role="tab" aria-selected={selected} className={cls}>
            {content}
          </Link>
        ) : (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange?.(item.value)}
            className={cls}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

export function TextInput({
  label,
  hideLabel = false,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean }) {
  return (
    <label className={cx("block", className)}>
      <span className={hideLabel ? "sr-only" : "mb-1.5 block text-[13px] font-semibold text-ink"}>{label}</span>
      <input
        {...props}
        className="h-11 w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />
    </label>
  );
}

// A native select, styled. Native keeps keyboard, mobile and screen-reader
// behaviour for free.
export function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] font-semibold text-ink focus:border-ink focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

/* --- Labels ------------------------------------------------------------- */

type BadgeTone = "neutral" | "accent" | "hit" | "miss" | "unresolved" | "open" | "sun";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-surface-sunken text-ink-secondary",
    accent: "bg-accent-tint text-accent",
    hit: "bg-tint-mint text-outcome-hit",
    miss: "bg-tint-rose text-outcome-miss",
    // Neutral on purpose: an unresolved window is not a failure.
    unresolved: "bg-surface-sunken text-ink-muted",
    open: "bg-accent-tint text-accent",
    sun: "bg-sun text-ink",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

// Source identity: dot carries colour, the name carries meaning.
export function SourceChip({ source, className }: { source: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[12px] font-semibold text-ink-secondary",
        className
      )}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sourceColor(source) }} aria-hidden="true" />
      {sourceLabel(source)}
    </span>
  );
}

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

/* --- States ------------------------------------------------------------- */

// Designed, not omitted: says why it is empty and offers the next action.
export function EmptyState({
  title,
  note,
  action,
  mood = "idle",
  compact = false,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  mood?: SigMood;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-[14px] border border-dashed border-line-strong bg-surface text-center",
        compact ? "px-5 py-8" : "px-6 py-12"
      )}
    >
      <Sig mood={mood} size={compact ? 36 : 48} decorative />
      <p className="mt-3 text-[16px] font-semibold text-ink">{title}</p>
      {note ? <p className="mt-1.5 max-w-md text-[14px] text-ink-secondary">{note}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-[14px] border border-line bg-surface" />
      ))}
    </div>
  );
}

// A bounded failure path: a spinner that never resolves looks like working software.
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-4 rounded-[14px] border border-[#f3c0ca] bg-tint-rose px-5 py-4">
      <Sig mood="unsure" size={36} decorative />
      <div>
        <p className="text-[14px] font-semibold text-status-critical">Couldn&rsquo;t load this</p>
        <p className="mt-1 text-[13px] text-ink-secondary">{message}</p>
        {onRetry ? (
          <div className="mt-3">
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
