import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// Keyword-hybrid title (SEO layer, 2026-07-16). Pinned substring preserved:
// landing-seo.spec.ts requires 'Product' in og:title.
// Canonical URL unchanged (https://alfanumrik.com/product).
export const metadata: Metadata = buildMarketingMetadata({
  path: '/product',
  title: 'Product — Alfanumrik AI Learning Platform for CBSE (Class 6–12)',
  description:
    'See how Alfanumrik works: NCERT-grounded AI tutoring, adaptive quizzes, teacher dashboards and parent reports for CBSE Class 6–12. Explore the platform.',
  ogVariant: 'product',
  bilingual: true,
});

export default function ProductLayout({ children }: { children: ReactNode }) {
  return children;
}
