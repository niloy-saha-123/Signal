import { LeftSidebar } from "@/components/LeftSidebar";
import { TopBar } from "@/components/TopBar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { AppCommandBar } from "../app-command-bar";

// Authenticated pages depend on per-request session and API data.
export const dynamic = "force-dynamic";

// Authenticated shell: three-column layout with nav, content, and chat
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Left navigation sidebar */}
      <LeftSidebar />
      
      {/* Top bar with profile button */}
      <TopBar />
      
      {/* Right chat sidebar */}
      <ChatSidebar />
      
      {/* Command palette */}
      <AppCommandBar />
      
      {/* Main content area - dynamic margins based on sidebar state */}
      <main className="mt-16 mr-12 ml-64 min-h-screen bg-studio-sky-soft px-8 py-10 text-studio-ink transition-all duration-300">
        {children}
      </main>
    </>
  );
}
