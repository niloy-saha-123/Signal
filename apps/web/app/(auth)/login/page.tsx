// Thin server shell around LoginForm. Middleware handles access before this route renders.
import { Suspense } from "react";
import { LoginForm } from "../login-form";

export default function Page() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink">Welcome back</h1>
        <p className="mt-1.5 text-[15px] text-ink-secondary">Log in to see what moved.</p>
      </div>
      <Suspense fallback={<p role="status" className="py-12 text-center text-[14px] text-ink-muted">Preparing secure sign in…</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
