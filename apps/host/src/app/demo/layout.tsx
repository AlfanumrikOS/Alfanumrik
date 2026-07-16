import type { Metadata } from 'next';
import { buildMarketingMetadata } from '@/lib/marketing-metadata';

// SEO layer, 2026-07-16 — NEW: /demo previously shipped NO metadata at all
// (page.tsx is a 'use client' component and cannot export metadata, so this
// layout carries it). Adds title, description, canonical, complete openGraph.
export const metadata: Metadata = buildMarketingMetadata({
  path: '/demo',
  title: 'Book a Demo — Alfanumrik for Schools',
  description:
    'Book a live demo of Alfanumrik for schools — adaptive CBSE learning, teacher analytics and NEP-aligned reporting for Class 6–12. Free 30-minute walkthrough.',
  ogVariant: 'schools',
});

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
