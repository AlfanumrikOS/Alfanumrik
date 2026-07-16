'use client';

import Link from 'next/link';
import { useWelcomeV2 } from '../../WelcomeV2Context';
import { track } from '@alfanumrik/lib/posthog/client';
import FoxyMascot from '../FoxyMascot';
import { V3_ACTIVE_ROLE } from '../NavV3';
import s from '../welcome-v3.module.css';

/**
 * CtaBandV3 — ink #1A1D21 closing band on the Launch UI cta-with-glow
 * anatomy (same double radial glow + waving FoxyMascot as FinalCtaV3 /
 * SchoolsBandV3). One primary orange button; optional ghost-dark secondary.
 *
 * The wave (and every mascot animation) collapses under
 * prefers-reduced-motion — handled inside FoxyMascot + welcome-v3.module.css.
 */

export interface CtaBandLink {
  href: string;
  en: string;
  hi: string;
}

export interface CtaBandV3Props {
  headingId: string;
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  primary: CtaBandLink;
  secondary?: CtaBandLink;
  /** Analytics location, e.g. "for_parents_cta_band". */
  location: string;
  /** Waving Foxy above the heading (default true). */
  showFoxy?: boolean;
}

export default function CtaBandV3({
  headingId,
  titleEn,
  titleHi,
  bodyEn,
  bodyHi,
  primary,
  secondary,
  location,
  showFoxy = true,
}: CtaBandV3Props) {
  const { isHi, t } = useWelcomeV2();

  const trackCta = (destination: string) =>
    track('landing_cta_click', {
      location,
      destination,
      active_role: V3_ACTIVE_ROLE,
      language: isHi ? 'hi' : 'en',
    });

  return (
    <section className={s.finalCta} aria-labelledby={headingId}>
      <div className={s.finalGlow} aria-hidden="true"></div>
      <div className={s.finalGlowInner} aria-hidden="true"></div>
      <div className={`${s.wrap} ${s.finalInner}`}>
        {showFoxy && <FoxyMascot className={s.finalFox} waveOnView />}
        <h2 id={headingId} lang={isHi ? 'hi' : undefined}>
          {t(titleEn, titleHi)}
        </h2>
        <p>{t(bodyEn, bodyHi)}</p>
        <div className={s.schoolsActions}>
          <Link
            href={primary.href}
            className={`${s.btn} ${s.btnPrimary}`}
            data-testid="cta-band-primary"
            onClick={() => trackCta(primary.href)}
          >
            {t(primary.en, primary.hi)}
          </Link>
          {secondary && (
            <Link
              href={secondary.href}
              className={`${s.btn} ${s.btnGhostDark}`}
              onClick={() => trackCta(secondary.href)}
            >
              {t(secondary.en, secondary.hi)}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
