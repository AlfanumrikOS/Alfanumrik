'use client';

import Link from 'next/link';
import { useWelcomeV2 } from '../WelcomeV2Context';
import { track } from '@alfanumrik/lib/posthog/client';
import FoxyMascot from './FoxyMascot';
import { V3_ACTIVE_ROLE } from './NavV3';
import s from './welcome-v3.module.css';

/**
 * V3 final CTA — Launch UI cta-with-glow anatomy on the ink #1A1D21 block:
 * two radial glows, the waving Foxy (one-time wave on intersection), a short
 * promise, one primary button.
 */
export default function FinalCtaV3() {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={s.finalCta} aria-labelledby="final-cta-v3-title">
      <div className={s.finalGlow} aria-hidden="true"></div>
      <div className={s.finalGlowInner} aria-hidden="true"></div>
      <div className={`${s.wrap} ${s.finalInner}`}>
        <FoxyMascot className={s.finalFox} waveOnView />
        <h2 id="final-cta-v3-title" lang={isHi ? 'hi' : undefined}>
          {t('Tonight’s homework can be different.', 'आज का गृहकार्य अलग हो सकता है।')}
        </h2>
        <p>
          {t(
            'Start on the free plan in two minutes. Your first Sunday letter arrives this week.',
            'दो मिनट में मुफ्त प्लान पर शुरू करें। आपका पहला रविवार-पत्र इसी सप्ताह आएगा।',
          )}
        </p>
        <Link
          href="/login"
          className={`${s.btn} ${s.btnPrimary}`}
          onClick={() =>
            track('landing_cta_click', {
              location: 'final_cta',
              destination: '/login',
              active_role: V3_ACTIVE_ROLE,
              language: isHi ? 'hi' : 'en',
            })
          }
        >
          {t('Start free', 'मुफ्त शुरू करें')}
        </Link>
      </div>
    </section>
  );
}
