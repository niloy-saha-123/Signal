import Link from "next/link";

import { Isobars } from "@/components/brand/Isobars";
import { Sig } from "@/components/brand/Sig";
import { Wordmark } from "@/components/brand/Wordmark";

// Split layout for login, signup and onboarding. The form column is the only
// thing that has to work; the right-hand panel is atmosphere, hidden below `lg`
// so a phone gets the form and nothing competing with it. No testimonial: there
// are no customers to quote, and an invented one is exactly the claim this
// product refuses to make.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-5 py-7 sm:px-10">
        <Link href="/" aria-label="Signal home" className="w-fit">
          <Wordmark size={28} />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>
        <p className="text-[13px] text-ink-muted">Probabilities, never certainties.</p>
      </div>

      <div className="relative hidden overflow-hidden bg-sky lg:flex lg:flex-col lg:justify-center lg:px-16">
        <Isobars />
        <div className="relative max-w-[440px]">
          <Sig mood="happy" size={64} decorative />
          <p className="mt-6 font-display text-[40px] leading-[1.02] font-semibold tracking-[-0.035em] text-ink">
            The weather forecast for your <span className="sun-mark">competitors.</span>
          </p>
          <div className="mt-8 rounded-[20px] bg-surface p-5 shadow-[var(--shadow-window)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold text-ink-muted">Kestrel · forecast</p>
                <p className="mt-1 text-[16px] font-semibold text-ink">Ships a managed Postgres adapter by Dec 15</p>
              </div>
              <span className="metric text-[40px]">72%</span>
            </div>
            <p className="mt-3 text-[13px] text-ink-secondary">
              Six independent sources. Scored automatically when the date arrives.
            </p>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-muted">Illustrative, with a fictional company.</p>
        </div>
      </div>
    </div>
  );
}
