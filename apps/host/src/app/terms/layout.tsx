import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// SEO layer, 2026-07-16: adopted the marketing metadata builder — adds the
// previously-missing canonical URL + complete openGraph (incl. og:image).
export const metadata: Metadata = buildMarketingMetadata({
  path: '/terms',
  title: 'Terms of Service — Alfanumrik',
  description:
    "The terms and conditions for using Alfanumrik's CBSE learning platform (Class 6–12) — subscriptions, acceptable use, and your rights as a user in India.",
});

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
