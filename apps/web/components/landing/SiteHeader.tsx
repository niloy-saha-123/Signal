import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";

export function SiteHeader() {
  return (
    <header className="relative z-10 mx-auto flex h-20 w-full max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
      <Link href="/" aria-label="Signal home">
        <Wordmark size={30} />
      </Link>
      <nav aria-label="Site" className="hidden items-center gap-7 text-[15px] text-ink-secondary md:flex">
        <a href="#how" className="hover:text-ink">
          How it works
        </a>
        <a href="#sources" className="hover:text-ink">
          Sources
        </a>
        <a href="#where" className="hover:text-ink">
          Integrations
        </a>
      </nav>
      <div className="flex items-center gap-2">
        <Link href="/login" className="h-10 rounded-[10px] px-3 text-[15px] leading-10 font-semibold text-ink hover:bg-surface/70">
          Log in
        </Link>
        <Link
          href="/signup"
          className="h-10 rounded-[10px] bg-ink px-4 text-[15px] leading-10 font-semibold text-white transition-colors hover:bg-[#1d3047]"
        >
          Start free
        </Link>
      </div>
    </header>
  );
}
