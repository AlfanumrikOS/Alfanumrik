import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Foxy',
  // CATALOGUE-CLAIM FIX (2026-08-12): read "across all CBSE subjects".
  // `subjects.is_active` is true for five codes only (math, science, physics,
  // chemistry, biology), so "all CBSE subjects" overstates the catalogue.
  // Metadata is scraped and cached off-site, so it outlives the page fix.
  description: 'Chat with Foxy, your personal tutor. Get help in Hindi and English with CBSE Mathematics and Science.',
};

export default function FoxyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
