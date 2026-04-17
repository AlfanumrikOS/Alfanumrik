'use client';

import { LangProvider } from '@/components/landing/LangToggle';
import { Hero } from '@/components/landing/Hero';
import { ProblemSolution } from '@/components/landing/ProblemSolution';
import { ProductShowcase } from '@/components/landing/ProductShowcase';
import { CredibilityStrip } from '@/components/landing/CredibilityStrip';
import { FinalCTA } from '@/components/landing/FinalCTA';
import { Footer } from '@/components/landing/Footer';
import { StickyMobileCTA } from '@/components/landing/StickyMobileCTA';

export default function WelcomePage() {
  return (
    <LangProvider>
      <div style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
        <Hero />
        <ProblemSolution />
        <ProductShowcase />
        <CredibilityStrip />
        <FinalCTA />
        <Footer />
        <StickyMobileCTA />
      </div>
    </LangProvider>
  );
}
