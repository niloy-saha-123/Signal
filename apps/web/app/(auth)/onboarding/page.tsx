// apps/web/app/onboarding/page.tsx
// Thin server shell around OnboardingForm — no data fetching, no session check (middleware
// already handles auth gating before a visitor reaches this route).
import { OnboardingForm } from "./onboarding-form";

export default function Page() {
  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-ink">Create your workspace</h1>
        <p className="mt-1.5 text-[14px] text-ink-secondary">Name it. You can add competitors next.</p>
      </div>
      <div className="rounded-xl border border-line bg-surface p-6 shadow-[0_20px_50px_-30px_rgba(11,59,56,0.3)]">
        <OnboardingForm />
      </div>
    </div>
  );
}
