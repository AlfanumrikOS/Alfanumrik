'use client';

import React, { useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import LandingNav from './LandingNav';
import HeroSection from './HeroSection';

/* ─── Lazy-load below-fold sections ─── */
const ProductShowcase = lazy(() => import('./ProductShowcase'));
const FeaturesSection = lazy(() => import('./FeaturesSection'));
const HowItWorks = lazy(() => import('./HowItWorks'));
const SocialProof = lazy(() => import('./SocialProof'));
const CTASection = lazy(() => import('./CTASection'));
const LandingFooter = lazy(() => import('./LandingFooter'));

interface LandingPageProps {
  onGetStarted?: () => void;
}

/* ─── Scroll-reveal observer hook ─── */
function useScrollReveal() {
  const observerRef = useRef<IntersectionObserver | null>(null);

  const initObserver = useCallback((container: HTMLElement | null) => {
    if (!container) return;
    // Respect prefers-reduced-motion
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Just make everything visible immediately
      container.querySelectorAll<HTMLElement>('.scroll-reveal').forEach((el) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
      return;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.style.transition = 'opacity 0.7s ease-out, transform 0.7s ease-out';
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
            observerRef.current?.unobserve(el);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    );

    container.querySelectorAll<HTMLElement>('.scroll-reveal').forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(30px)';
      observerRef.current!.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, []);

  return initObserver;
}

/* ─── Lazy section wrapper with minimal loading fallback ─── */
function LazySection({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      }
    >
      {children}
    </Suspense>
  );
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initObserver = useScrollReveal();

  useEffect(() => {
    const cleanup = initObserver(containerRef.current);
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, [initObserver]);

  const handleGetStarted = useCallback(() => {
    if (onGetStarted) {
      onGetStarted();
    } else {
      // Default: navigate to signup
      window.location.href = '/signup';
    }
  }, [onGetStarted]);

  return (
    <div ref={containerRef} style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <LandingNav onGetStarted={handleGetStarted} />
      <HeroSection onGetStarted={handleGetStarted} />

      <LazySection>
        <ProductShowcase />
      </LazySection>

      <LazySection>
        <FeaturesSection />
      </LazySection>

      <LazySection>
        <HowItWorks />
      </LazySection>

      <LazySection>
        <div id="testimonials">
          <SocialProof />
        </div>
      </LazySection>

      <LazySection>
        <CTASection onGetStarted={handleGetStarted} />
      </LazySection>

      <LazySection>
        <LandingFooter />
      </LazySection>
    </div>
  );
}
