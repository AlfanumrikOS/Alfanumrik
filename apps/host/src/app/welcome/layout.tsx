import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localInter from 'next/font/local';
import JsonLd from '@alfanumrik/ui/JsonLd';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

/* ────────────────────────────────────────────────────────────────
   Self-hosted Google Fonts via next/font/local.
   Inter is loaded from public/fonts/Inter-latin.woff2 (downloaded
   from Google Fonts at `fonts.googleapis.com`, which is already in the
   CSP allowlist per next.config.js).
   `display: 'swap'` keeps text visible during load.
   ──────────────────────────────────────────────────────────────── */

const inter = localInter({
  src: [
    {
      path: './public/fonts/Inter-latin.woff2',
      weight: '400 600',
      style: 'normal',
    },
  ],
  variable: '--font-inter',
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
  // Compose the font CSS-variable class on a wrapper so child components
  // can resolve var(--font-inter). (The display serif comes from the root
  // layout's --font-serif/Fraunces.)
  const fontVars = [
    inter.variable,
  ].join(' ');

  return (
    <div className={fontVars}>
      <JsonLd />
      {children}
    </div>
  );
}
