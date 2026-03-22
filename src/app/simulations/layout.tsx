import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Interactive Simulations',
  description: 'Explore physics, chemistry, and math concepts through interactive simulations. Hands-on learning for CBSE students.',
};

export default function SimulationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
