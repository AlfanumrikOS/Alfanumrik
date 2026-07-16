import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// Keyword-hybrid title (SEO layer, 2026-07-16). Pinned substring preserved:
// e2e/public-pages.spec.ts requires /For Schools/ in the title.
// Canonical unchanged; hreflang trio ADDED (bilingual marketing page — the
// page body ships Hindi copy via ?lang=hi like the other for-* pages).
export const metadata: Metadata = buildMarketingMetadata({
  path: '/for-schools',
  title: 'For Schools — School Intelligence OS for CBSE | Alfanumrik',
  description:
    'Adaptive learning for CBSE schools: real-time mastery analytics, NEP-aligned reporting and ISO 27001 data security for 30–3,000 seats. Book a demo today.',
  ogVariant: 'schools',
  bilingual: true,
});

export default function ForSchoolsLayout({ children }: { children: ReactNode }) {
  return children;
}
