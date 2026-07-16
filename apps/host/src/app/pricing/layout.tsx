import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// Keyword-hybrid title (SEO layer, 2026-07-16). Pinned substring preserved:
// e2e/public-pages.spec.ts + landing-seo.spec.ts require 'Pricing' in the
// title/og:title. Canonical URL unchanged (https://alfanumrik.com/pricing).
export const metadata: Metadata = buildMarketingMetadata({
  path: '/pricing',
  title: 'Pricing — CBSE Learning App, Free & Paid Plans',
  description:
    'Transparent pricing for Alfanumrik’s CBSE learning app (Class 6–12). Start free with Foxy, upgrade for unlimited AI tutoring, quizzes & NCERT practice.',
  ogVariant: 'pricing',
  bilingual: true,
});

export default function PricingLayout({ children }: { children: ReactNode }) {
  return children;
}
