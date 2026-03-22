import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Review',
  description: 'Spaced repetition review cards. Strengthen your memory with scientifically-timed practice.',
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
