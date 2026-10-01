// Thin server shell around SignupForm — mirrors login/page.tsx.
import { Suspense } from "react";
import { SignupForm } from "./signup-form";

export default function Page() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink">
          Create your workspace
        </h1>
        <p className="mt-1.5 text-[15px] text-ink-secondary">A minute to set up. Signal does the watching after that.</p>
      </div>
      <Suspense fallback={<p role="status" className="py-12 text-center text-[14px] text-ink-muted">Preparing account creation…</p>}>
        <SignupForm />
      </Suspense>
    </div>
  );
}
