import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Mukta, JetBrains_Mono } from 'next/font/google';
import JsonLd from '@alfanumrik/ui/JsonLd';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

/* ────────────────────────────────────────────────────────────────
   Self-hosted Google Fonts via next/font.
   These are only loaded for the /welcome route — the root layout
   uses Sora + Plus Jakarta Sans for the rest of the app.
   `display: 'swap'` keeps text visible during load.
   ──────────────────────────────────────────────────────────────── */

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-inter',
  display: 'swap',
});

// Newsreader removed (Alfa Momentum Wave 1): the landing display serif is now
// Fraunces, self-hosted via the root layout (--font-serif). The welcome CSS
// module's --display token references --font-serif and every former direct
// var(--font-newsreader) use was repointed to var(--display), so Newsreader has
// zero consumers on /welcome. Dropping the loader trims one self-hosted font
// family (multiple weights + italics) from the landing route — a P10 win.

// Mukta has the Devanagari subset (Mukta Vaani exists too, but next/font's
// Mukta_Vaani type only exposes latin/gujarati subsets). Mukta is the same
// family lineage from Ek Type and matches the editorial intent of the design
// spec; its Devanagari weight 700 carries the hero numeral cleanly.
const mukta = Mukta({
  subsets: ['latin', 'devanagari'],
  weight: ['500', '700'],
  variable: '--font-mukta',
  display: 'swap',
  preload: true, // hero numeral uses 700 — preload it for LCP
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

// Keyword-hybrid title (SEO layer, 2026-07-16). Pinned substrings preserved:
// e2e/public-pages.spec.ts requires /Alfanumrik/ in the title and
// landing-seo.spec.ts requires 'Alfanumrik' in og:title. hreflang trio +
// canonical + complete openGraph (incl. og:image) come from the builder.
export const metadata: Metadata = buildMarketingMetadata({
  path: '/welcome',
  title: 'AI Tutor for CBSE Students (Class 6–12) — Alfanumrik',
  description:
    'Alfanumrik is an AI-powered adaptive learning app for CBSE students in Class 6–12. NCERT-grounded tutoring in Hindi & English. Start free — no card needed.',
  bilingual: true,
});

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  // Compose the font CSS-variable classes on a wrapper so child components
  // can resolve var(--font-inter) / var(--font-mukta) / var(--font-jetbrains).
  // (The display serif now comes from the root layout's --font-serif/Fraunces.)
  const fontVars = [
    inter.variable,
    mukta.variable,
    jetbrains.variable,
  ].join(' ');

  return (
    <div className={fontVars}>
      <JsonLd />
      {children}
    </div>
  );
}
