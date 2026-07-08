import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quiz',
  description: 'Adaptive quizzes powered by AI. Practice CBSE subjects with questions matched to your mastery level.',
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return children;
}
