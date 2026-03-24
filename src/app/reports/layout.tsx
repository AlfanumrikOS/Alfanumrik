import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Monthly Reports — Alfanumrik',
  description: 'Download monthly learning reports',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
