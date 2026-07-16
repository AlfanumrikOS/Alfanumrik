import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// SEO layer, 2026-07-16: adopted the marketing metadata builder — adds the
// previously-missing canonical URL + complete openGraph (incl. og:image).
export const metadata: Metadata = buildMarketingMetadata({
  path: '/privacy',
  title: 'Privacy Policy — Alfanumrik',
  description:
    'How Alfanumrik collects, uses and protects student data for CBSE learners in Class 6–12 — DPDPA-compliant, India-hosted, with parental consent controls.',
});

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
