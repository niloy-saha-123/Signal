import type { Metadata, Viewport } from "next";
import { Funnel_Display, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Three faces, each with one job. Funnel Display sets headlines: geometric
// and confident, rare enough on B2B sites to be recognisable. Geist sets the
// interface, built for dense product text. Geist Mono sets every number that
// means something, so probabilities and dates read as measurements.
const funnelDisplay = Funnel_Display({
  subsets: ["latin"],
  variable: "--font-funnel-display",
  display: "swap",
  weight: ["500", "600", "700"],
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Signal — Competitive Intelligence",
  description:
    "Signal predicts what your competitors will ship, writes it down, and scores itself when the date arrives.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f9fafd",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${funnelDisplay.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-ground font-sans text-[15px] leading-normal text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
