import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'High Performance Card',
  description: 'Your NEP 2020 compliant High Performance Card. View holistic learning profile across competencies.',
};

export default function HpcLayout({ children }: { children: React.ReactNode }) {
  return children;
}
