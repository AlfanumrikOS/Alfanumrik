import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'STEM Centre — Alfanumrik',
  description: 'Explore physics, chemistry, biology, and math through guided experiments and interactive simulations. CBSE-aligned STEM learning.',
};

export default function SimulationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
