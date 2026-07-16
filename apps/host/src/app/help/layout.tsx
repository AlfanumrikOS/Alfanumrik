import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// SEO layer, 2026-07-16: adopted the marketing metadata builder — adds the
// previously-missing canonical URL + complete openGraph (incl. og:image).
export const metadata: Metadata = buildMarketingMetadata({
  path: '/help',
  title: 'Help & Support — Alfanumrik',
  description:
    'Get help with Alfanumrik — FAQs, tutorials and support for CBSE students, parents and teachers (Class 6–12). WhatsApp and email support in Hindi & English.',
});

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
