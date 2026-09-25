// apps/web/app/signup/page.tsx
// Thin server shell around SignupForm — mirrors app/login/page.tsx.
import { Suspense } from "react";
import { SignupForm } from "./signup-form";

export default function Page() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <div className="text-center">
        <span className="text-lg font-semibold text-studio-action">Signal</span>
        <h1 className="mt-2 text-xl font-semibold text-studio-ink">Create an account</h1>
      </div>
      <div className="rounded-[10px] border border-studio-line bg-studio-paper p-6">
        <Suspense
          fallback={
            <p role="status" className="py-12 text-center text-sm text-studio-muted">
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
