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

      <div className="relative m-3 hidden overflow-hidden rounded-[28px] bg-[linear-gradient(150deg,#2b61cc_0%,#0f2150_52%,#061436_100%)] lg:block">
        <SignalTrace
          id="auth-trace"
          tone="dark"
          className="absolute inset-x-0 top-[42%] h-[520px] w-full -translate-y-1/2 opacity-80"
        />
        <div className="absolute inset-x-12 bottom-12">
          <p className="max-w-md font-display text-[30px] leading-[1.08] font-semibold tracking-[-0.03em] text-white">
            See what competitors ship <span className="text-midnight-muted">before they announce it.</span>
          </p>
          <p className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-white/75">
            Every prediction is dated, carries a probability, and is scored when it resolves &mdash; whether it was
            right or not.
          </p>
        </div>
      </div>
    </div>
  );
}
