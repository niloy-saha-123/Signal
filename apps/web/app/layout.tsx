import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { AlertBanner } from "@/components/AlertBanner";
import { AppCommandBar } from "./app-command-bar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal — Competitive Intelligence",
  description: "Autonomous competitive strategy intelligence engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <SiteNav />
        <AppCommandBar />
        <AlertBanner />
        <main className="mx-auto max-w-6xl px-8 py-10">{children}</main>
      </body>
    </html>
  );
}
