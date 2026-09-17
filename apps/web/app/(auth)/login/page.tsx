// Thin server shell around LoginForm. Middleware handles access before this route renders.
import { Suspense } from "react";
import { LoginForm } from "../login-form";

export default function Page() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <div className="text-center">
        <span className="text-lg font-semibold text-studio-action">Signal</span>
        <h1 className="mt-2 text-xl font-semibold text-studio-ink">Log in</h1>
      </div>
      <div className="rounded-lg border border-studio-line bg-studio-paper p-6 shadow-sm">
        <Suspense
          fallback={
            <p role="status" className="py-12 text-center text-sm text-studio-muted">
              Preparing secure sign in…
            </p>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
