import { AppSidebar } from "@/components/AppSidebar";
import { TopBar } from "@/components/TopBar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { AlertBanner } from "@/components/AlertBanner";
import { AppCommandBar } from "../app-command-bar";

// Authenticated pages depend on per-request session and API data.
export const dynamic = "force-dynamic";

// Authenticated shell. The sidebar is fixed on large screens and collapses
// below `lg`, where TopBar carries navigation instead — the content column is
// the priority at narrow widths, not the chrome.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppSidebar />
      <TopBar />
      <ChatSidebar />
      <AppCommandBar />
      <AlertBanner />
      <main className="min-h-screen bg-ground px-4 pt-20 pb-16 text-ink sm:px-6 lg:ml-60 lg:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </>
  );
}
