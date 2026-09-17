import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { LeftSidebar } from "@/components/LeftSidebar";
import { TopBar } from "@/components/TopBar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { AppCommandBar } from "./app-command-bar";
import "./globals.css";

// Load Manrope font for the entire app
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Signal — Competitive Intelligence",
  description: "Autonomous competitive strategy intelligence engine",
};

// Every page fetches live data from the API at request time; the API isn't reachable
// during `next build` (CI, local build), so static prerendering must be off app-wide.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        {/* Three-column layout: nav | content | chat (responsive with collapse) */}
        <LeftSidebar />
        <TopBar />
        <ChatSidebar />
        <AppCommandBar />
        
        {/* Main content area - dynamic margins based on sidebar state */}
        <main className="ml-64 mr-96 mt-16 min-h-screen px-8 py-10 transition-all duration-300">
          {children}
        </main>
      </body>
    </html>
  );
}
