import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Notifications',
  description: 'Stay updated with quiz results, achievements, streak milestones, and learning reminders.',
};

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
