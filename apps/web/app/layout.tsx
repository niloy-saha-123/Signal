import type { Metadata } from "next";
import { Manrope } from "next/font/google";
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
        {children}
      </body>
    </html>
  );
}
