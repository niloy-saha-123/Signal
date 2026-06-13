// Root layout wrapping all pages with global styles and metadata for the Signal application.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Signal — Competitive Intelligence",
  description: "Autonomous competitive strategy intelligence engine",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem" }}>
        <nav style={{ marginBottom: "2rem", display: "flex", gap: "1rem" }}>
          <a href="/">Competitors</a>
          <a href="/chat">Chat</a>
          <a href="/alerts">Alerts</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
