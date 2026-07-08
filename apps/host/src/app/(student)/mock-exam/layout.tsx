import type { ReactNode } from 'react';

export const metadata = {
  title: 'Mock Exam | Alfanumrik',
  description: 'Full-length CBSE mock exams with official marking scheme',
};

export default function MockExamLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
