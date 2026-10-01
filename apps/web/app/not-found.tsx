import { Isobars } from "@/components/brand/Isobars";
import { Sig } from "@/components/brand/Sig";
import { LinkButton } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-sky px-4">
      <Isobars variant="soft" />
      <div className="relative flex max-w-md flex-col items-center text-center">
        <Sig mood="unsure" size={72} decorative />
        <h1 className="mt-5 font-display text-[34px] leading-tight font-semibold tracking-[-0.03em] text-ink">
          This page isn&apos;t on the map
        </h1>
        <p className="mt-3 text-[15px] text-ink-secondary">
          The link may be old, or the competitor or forecast it pointed to was removed.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <LinkButton href="/briefing" variant="primary">
            Go to Home
          </LinkButton>
          <LinkButton href="/">Signal&apos;s homepage</LinkButton>
        </div>
      </div>
    </main>
  );
}
