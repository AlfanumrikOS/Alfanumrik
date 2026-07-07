import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Alfanumrik terms of service. Terms and conditions for using our platform.',
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
