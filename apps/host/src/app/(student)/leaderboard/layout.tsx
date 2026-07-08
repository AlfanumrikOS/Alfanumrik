import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'See top students by XP, streaks, and mastery. Compete with classmates and climb the ranks.',
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
