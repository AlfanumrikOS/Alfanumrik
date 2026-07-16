import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';
import AboutContent from './AboutContent';

// SEO layer, 2026-07-16 — METADATA EXPORT ONLY (the page body below is owned
// by the concurrent marketing-copy rewrite; do not conflate the two changes).
// Canonical URL unchanged; builder adds complete openGraph incl. og:image.
export const metadata: Metadata = buildMarketingMetadata({
  path: '/about',
  title: 'About Alfanumrik — Cusiosense Learning India',
  description:
    "Meet the team building India's adaptive learning OS for CBSE Class 6–12 — NCERT-grounded AI tutoring in Hindi & English. Read our vision and founder note.",
});

// Landing-v3 makeover 2026-07-16 (page BODY): the interactive bilingual
// body lives in ./AboutContent.tsx ('use client'). This file stays a
// Server Component so the metadata export above keeps working.
export default function AboutPage() {
  return <AboutContent />;
}
