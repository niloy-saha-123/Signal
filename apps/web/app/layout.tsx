import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import "./globals.css";

// Keep the existing variable name so authenticated surfaces retain their font contract.
const onest = Onest({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Signal — Competitive Intelligence",
  description: "Autonomous competitive strategy intelligence engine",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3faff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={onest.variable}>
      <body className="min-h-screen bg-studio-sky-soft font-sans text-studio-ink antialiased">
        {children}
      </body>
    </html>
  );
}
