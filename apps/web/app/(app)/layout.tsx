import { AppSidebar } from "@/components/AppSidebar";
import { TopBar } from "@/components/TopBar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { AlertBanner } from "@/components/AlertBanner";
import { AppCommandBar } from "../app-command-bar";
import Link from "next/link";
import { getOptionalAccessToken } from "@/lib/supabase-server";

// Authenticated pages depend on per-request session and API data.
export const dynamic = "force-dynamic";

// Authenticated shell. The sidebar is fixed on large screens and collapses
// below `lg`, where TopBar carries navigation instead — the content column is
// the priority at narrow widths, not the chrome.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // No session only happens in the dev preview, where pages render fictional
  // example data. Say so, or those figures read as a real workspace.
  const isPreview = !(await getOptionalAccessToken());
  return (
    <>
      <AppSidebar />
      <TopBar />
      <ChatSidebar />
      <AppCommandBar />
      <AlertBanner />
      <main className="min-h-screen bg-ground px-4 pt-20 pb-16 text-ink sm:px-6 lg:ml-60 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {isPreview && (
            <p
              role="status"
              className="mb-6 rounded-lg border border-line bg-[var(--color-tint-flare)] px-4 py-2.5 text-[13px] text-ink-secondary"
            >
              Preview &mdash; example data with fictional companies.{" "}
              <Link href="/login" className="font-medium text-accent hover:underline">
                Sign in
              </Link>{" "}
              to see your workspace.
            </p>
          )}
          {children}
        </div>
      </main>
    </>
  );
}
