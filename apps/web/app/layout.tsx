import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// Two families, both doing real work. Public Sans carries the UI; the mono
// carries every number that means something — probabilities, Brier scores,
// dates, counts. In a product whose content is measurements, the numerals are
// the interface, so they get a typeface chosen for them rather than whatever
// the body font happens to do with digits.
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Signal — Competitive Intelligence",
  description:
    "Signal predicts what your competitors will ship, writes it down, and scores itself when the date arrives.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf9f7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-ground font-sans text-[15px] leading-normal text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
