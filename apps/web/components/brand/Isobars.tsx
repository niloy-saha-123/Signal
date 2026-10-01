// Isobar line art — the forecast map behind Signal's surfaces. Decorative only:
// hidden from assistive tech, never interactive, stretched to its container.
export function Isobars({
  className = "",
  variant = "hero",
}: {
  className?: string;
  variant?: "hero" | "soft";
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 700"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      fill="none"
      stroke="var(--color-isobar, #c9dceb)"
      strokeWidth={variant === "hero" ? 1.2 : 1}
      opacity={variant === "hero" ? 1 : 0.7}
    >
      <path d="M-20 560C200 460 380 640 620 520S980 420 1240 510" />
      <path d="M-20 600C220 510 400 680 640 560S990 470 1240 560" />
      <path d="M-20 640C240 560 420 720 660 600S1000 520 1240 610" />
      <path d="M720 -20C780 120 1000 90 1020 200S1190 260 1240 220" />
      <path d="M670 -20C740 160 980 140 990 250S1180 320 1240 290" />
      <path d="M620 -20C700 200 960 190 960 300S1170 380 1240 360" />
      {variant === "hero" ? (
        <>
          <ellipse cx="1070" cy="130" rx="74" ry="42" />
          <ellipse cx="1070" cy="130" rx="36" ry="19" />
          <path d="M-20 120C120 90 220 170 340 140S520 60 600 90" />
        </>
      ) : null}
    </svg>
  );
}
