import Link from "next/link";

import { SignalMark } from "@/components/landing/SignalMark";
import { SignalTrace } from "@/components/landing/SignalTrace";

// Split layout for login, signup and onboarding. The form column is the only
// thing that has to work; the right-hand panel is atmosphere, hidden below
// `lg` so a phone gets the form and nothing competing with it.
//
// No testimonial or customer quote on the panel — there are no customers to
// quote, and an invented one on a sign-in page is exactly the kind of claim
// this product refuses to make.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-ground lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" aria-label="Signal home" className="w-fit">
          <SignalMark />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-[12px] text-ink-muted">Probabilities, never certainties.</p>
      </div>

      <div className="relative hidden overflow-hidden border-l border-line bg-[var(--color-tint-teal)] lg:block">
        <div aria-hidden="true" className="grid-backdrop absolute inset-0" />
        <SignalTrace className="absolute inset-x-0 top-1/2 h-[520px] w-full -translate-y-1/2" />
        <div className="absolute inset-x-12 bottom-12">
          <p className="max-w-md text-[26px] leading-tight font-semibold tracking-[-0.025em] text-ink">
            Know what your competitors ship{" "}
            <span className="text-ink-muted">before they announce it.</span>
          </p>
          <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-ink-secondary">
            Every prediction is dated, carries a probability, and is scored when it resolves
            &mdash; whether it was right or not.
          </p>
        </div>
      </div>
    </div>
  );
}
