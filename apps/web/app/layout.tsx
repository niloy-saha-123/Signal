import type { Metadata, Viewport } from "next";
import { Funnel_Display, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Funnel Display carries headlines and the big probabilities; Hanken Grotesk
// carries everything else, with tabular figures wherever numbers line up.
const funnel = Funnel_Display({
  subsets: ["latin"],
  variable: "--font-funnel",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Signal — the weather forecast for your competitors",
  description:
    "Signal reads competitors' code, hiring, pricing and docs, says what they will ship next with a probability and a date, and scores itself when the date arrives.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#eef5fa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${funnel.variable} ${hanken.variable}`}>
      <body className="min-h-screen bg-ground font-sans text-[15px] leading-normal text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
