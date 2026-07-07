import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your personalized learning dashboard. Track XP, streaks, mastery progress, and study recommendations.',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
