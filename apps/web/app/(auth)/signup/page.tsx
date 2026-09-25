// apps/web/app/signup/page.tsx
// Thin server shell around SignupForm — mirrors app/login/page.tsx.
import { Suspense } from "react";
import { SignupForm } from "./signup-form";

export default function Page() {
  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-ink">Create an account</h1>
        <p className="mt-1.5 text-[14px] text-ink-secondary">Start tracking your first competitor in a few minutes.</p>
      </div>
      <div className="rounded-xl border border-line bg-surface p-6 shadow-[0_20px_50px_-30px_rgba(11,59,56,0.3)]">
        <Suspense
          fallback={
            <p role="status" className="py-12 text-center text-[13px] text-ink-muted">
              Preparing account creation…
            </p>
          }
        >
          <SignupForm />
        </Suspense>
      </div>
    </div>
  );
}
