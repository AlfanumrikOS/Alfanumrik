import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Foxy',
  description: 'Chat with Foxy, your personal tutor. Get help in Hindi and English across all CBSE subjects.',
};

export default function FoxyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
