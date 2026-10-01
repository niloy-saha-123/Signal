import Link from "next/link";
import { AlertBanner } from "@/components/AlertBanner";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { TopBar } from "@/components/TopBar";
import { Toaster } from "@/components/ui/toast";
import { getOptionalAccessToken } from "@/lib/supabase-server";
import { AppCommandBar } from "../app-command-bar";

// Authenticated pages depend on per-request session and API data.
export const dynamic = "force-dynamic";

// Authenticated shell. The sidebar is fixed on large screens and collapses below
// `lg`, where TopBar carries navigation instead.
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
      <Toaster />
      <main className="min-h-screen bg-ground px-4 pt-24 pb-24 text-ink sm:px-6 lg:ml-[248px] lg:px-10">
        <div className="mx-auto max-w-[1120px]">
          {isPreview && (
            <p
              role="status"
              className="mb-6 flex flex-wrap items-center gap-x-2 rounded-[12px] bg-tint-sun px-4 py-2.5 text-[14px] text-ink"
            >
              <span className="font-semibold">Preview.</span> Example data with fictional companies.
              <Link href="/login" className="font-semibold text-accent underline-offset-2 hover:underline">
                Sign in to see your workspace
              </Link>
            </p>
          )}
          {children}
        </div>
      </main>
    </>
  );
}
