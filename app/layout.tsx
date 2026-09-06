import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

/**
 * Heebo, and its Hebrew subset declared explicitly.
 *
 * The subset list is the part that matters. A metric-matched fallback declared
 * with no unicode-range covers every script the real font does not — Hebrew
 * included — so Hebrew ends up rendering through a local Latin face wearing
 * override metrics that were measured on Latin, about one percent too wide,
 * silently, on the script this app is mostly read in. Naming the subsets makes
 * next/font emit a fallback scoped to the ranges the font actually has.
 */
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-heebo",
  fallback: ["Arial", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "שיעורי בית",
  description: "מצלמים דף עבודה, מקבלים רשימה, ורואים מה צריך לעשות היום.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#101014" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body>{children}</body>
    </html>
  );
}
