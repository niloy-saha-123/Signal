import { LeftSidebar } from "@/components/LeftSidebar";
import { TopBar } from "@/components/TopBar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { AppCommandBar } from "../app-command-bar";

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
      <main className="ml-64 mr-96 mt-16 min-h-screen px-8 py-10 transition-all duration-300">
        {children}
      </main>
    </>
  );
}
