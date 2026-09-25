// apps/web/app/onboarding/page.tsx
// Thin server shell around OnboardingForm — no data fetching, no session check (middleware
// already handles auth gating before a visitor reaches this route).
import { OnboardingForm } from "./onboarding-form";

export default function Page() {
  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="font-display text-[32px] leading-tight font-semibold tracking-[-0.03em] text-ink">Create your workspace</h1>
        <p className="mt-1.5 text-[14px] text-ink-secondary">Name it. You can add competitors next.</p>
      </div>
      <div className="rounded-2xl bg-surface p-6 shadow-[var(--shadow-float)]">
        <OnboardingForm />
      </div>
    </div>
  );
}
