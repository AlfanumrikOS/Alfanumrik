import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Scan & Learn — Alfanumrik',
  description: 'Upload images of assignments, question papers, or notes and get instant learning insights',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
