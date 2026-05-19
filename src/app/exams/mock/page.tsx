import type { Metadata } from 'next';
import MockTestCatalog from './MockTestCatalog';

export const metadata: Metadata = {
  title: 'Mock Tests · Alfanumrik',
  description:
    'Practice with JEE, NEET, Olympiad, and CBSE Board mock papers. Real-pattern timing, real-pattern marking.',
};

export default function MockTestLandingPage() {
  return <MockTestCatalog />;
}
