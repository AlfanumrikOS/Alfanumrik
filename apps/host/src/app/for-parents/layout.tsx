import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// Keyword-hybrid title (SEO layer, 2026-07-16). Pinned substring preserved:
// e2e/public-pages.spec.ts requires /For Parents/ in the title.
// Canonical + hreflang trio unchanged (builder emits the same pinned format).
export const metadata: Metadata = buildMarketingMetadata({
  path: '/for-parents',
  title: "For Parents — Track Your Child's CBSE Progress | Alfanumrik",
  description:
    'Know exactly how your child is learning. Weekly progress letters, subject-wise CBSE mastery tracking for Class 6–12, in Hindi & English. Start free today.',
  ogVariant: 'parents',
  bilingual: true,
});

export default function ForParentsLayout({ children }: { children: ReactNode }) {
  return children;
}
