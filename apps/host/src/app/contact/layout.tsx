import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// SEO layer, 2026-07-16 — NEW: /contact previously shipped NO metadata at all
// (page.tsx is a 'use client' component and cannot export metadata, so this
// layout carries it). Adds title, description, canonical, complete openGraph.
export const metadata: Metadata = buildMarketingMetadata({
  path: '/contact',
  title: 'Contact Alfanumrik — Support & Sales',
  description:
    'Contact the Alfanumrik team — product support, school partnerships and sales for our CBSE learning platform (Class 6–12). We reply within one working day.',
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
