import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Manage your Alfanumrik profile, preferences, and account settings.',
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
