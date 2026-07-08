import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Study Plan',
  description: 'AI-generated personalized study plan. Get daily recommendations based on your mastery and goals.',
};

export default function StudyPlanLayout({ children }: { children: React.ReactNode }) {
  return children;
}
