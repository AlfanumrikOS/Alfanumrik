import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Progress',
  description: 'Track your learning progress across subjects. View mastery levels, XP history, and study patterns.',
};

export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return children;
}
