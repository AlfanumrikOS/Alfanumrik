import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// Keyword-hybrid title (SEO layer, 2026-07-16). Pinned substring preserved:
// e2e/public-pages.spec.ts requires /For Teachers/ in the title.
// Canonical + hreflang trio unchanged (builder emits the same pinned format).
export const metadata: Metadata = buildMarketingMetadata({
  path: '/for-teachers',
  title: 'For Teachers — CBSE Worksheet Generator & Class Analytics | Alfanumrik',
  description:
    "Generate CBSE worksheets in 90 seconds, see Bloom's-level class analytics and automate parent reports for Class 6–12. Free for teachers — start today.",
  ogVariant: 'teachers',
  bilingual: true,
});

export default function ForTeachersLayout({ children }: { children: ReactNode }) {
  return children;
}
