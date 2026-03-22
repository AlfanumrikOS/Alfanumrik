import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Help & Support',
  description: 'Get help with Alfanumrik. FAQs, tutorials, and support for students, teachers, and parents.',
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
