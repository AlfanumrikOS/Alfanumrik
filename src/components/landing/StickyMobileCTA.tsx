'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLang } from './LangToggle';

/**
 * Mobile-only sticky CTA bar.
 * Appears when hero CTA scrolls out of view.
 * Disappears when final CTA section enters view.
 * Uses IntersectionObserver (same pattern as Animations.tsx useInView).
 */
export function StickyMobileCTA() {
  const { t } = useLang();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const heroCTA = document.getElementById('hero-cta');
    const finalCTA = document.getElementById('final-cta');
    if (!heroCTA) return;

    let heroOut = false;
    let finalIn = false;

    const update = () => setVisible(heroOut && !finalIn);

    const heroObs = new IntersectionObserver(
      ([entry]) => { heroOut = !entry.isIntersecting; update(); },
      { threshold: 0 }
    );
    heroObs.observe(heroCTA);

    let finalObs: IntersectionObserver | undefined;
    if (finalCTA) {
      finalObs = new IntersectionObserver(
        ([entry]) => { finalIn = entry.isIntersecting; update(); },
        { threshold: 0 }
      );
      finalObs.observe(finalCTA);
    }

    return () => {
      heroObs.disconnect();
      finalObs?.disconnect();
    };
  }, []);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden flex items-center justify-center gap-3 px-4"
      style={{
        height: 56,
        background: 'rgba(251,248,244,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--border)',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s ease-out',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <Link
        href="/login"
        className="text-sm font-bold px-6 py-2.5 rounded-xl text-white"
        style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}
      >
        {t('Start Free', 'मुफ्त शुरू करें')}
      </Link>
      <Link
        href="/login?role=parent"
        className="text-xs font-semibold"
        style={{ color: '#16A34A' }}
      >
        {t('For Parents', 'माता-पिता के लिए')}
      </Link>
    </div>
  );
}