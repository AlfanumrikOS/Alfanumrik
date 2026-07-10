import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Foxy AI Tutor',
  description: 'Chat with Foxy, your personal AI tutor. Get help in Hindi and English across all CBSE subjects.',
};

export default function FoxyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
