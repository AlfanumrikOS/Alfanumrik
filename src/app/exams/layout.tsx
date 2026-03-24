import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Exams — Alfanumrik',
  description: 'Set up and track your CBSE exams',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
