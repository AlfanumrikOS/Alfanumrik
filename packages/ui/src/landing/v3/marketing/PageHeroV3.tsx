'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useWelcomeV2 } from '../../WelcomeV2Context';
import { useReveal } from '../../useReveal';
import { track } from '@alfanumrik/lib/posthog/client';
import { ThinkingGlyph } from '../MotionPrimitives';
import { V3_ACTIVE_ROLE } from '../NavV3';
import s from '../welcome-v3.module.css';

/**
 * PageHeroV3 — marketing-page hero: eyebrow · H1 · lede · optional CTA row.
 * Reuses the /pricing hero anatomy (s.phero / s.pheroH1 / s.pheroSub) from
 * welcome-v3.module.css — same fluid type, same reveal stagger.
 *
 * This renders the page's ONLY <h1> (single-H1 contract for every marketing
 * page). CTAs fire the house `landing_cta_click` event with the page-specific
 * `location` so funnels stay comparable with /welcome and /pricing.
 */

export interface PageHeroCta {
  href: string;
  en: string;
  hi: string;
  /** 'primary' (orange) or 'ghost' (hairline). Default 'primary'. */
  variant?: 'primary' | 'ghost';
}

export interface PageHeroV3Props {
  headingId: string;
  eyebrowEn: string;
  eyebrowHi: string;
  titleEn: ReactNode;
  titleHi: ReactNode;
  ledeEn: ReactNode;
  ledeHi: ReactNode;
  ctas?: PageHeroCta[];
  /** Analytics location, e.g. "for_parents_hero". */
  location: string;
}

export default function PageHeroV3({
  headingId,
  eyebrowEn,
  eyebrowHi,
  titleEn,
  titleHi,
  ledeEn,
  ledeHi,
  ctas,
  location,
}: PageHeroV3Props) {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(50);

  return (
    <section className={s.phero} aria-labelledby={headingId}>
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <span className={`${s.eyebrow} ${s.revealUp}`} data-reveal>
          <ThinkingGlyph />
          {t(eyebrowEn, eyebrowHi)}
        </span>
        <h1 id={headingId} className={`${s.pheroH1} ${s.revealUp}`} data-reveal>
          {isHi ? titleHi : titleEn}
        </h1>
        <p className={`${s.pheroSub} ${s.revealUp}`} data-reveal>
          {isHi ? ledeHi : ledeEn}
        </p>
        {ctas && ctas.length > 0 && (
          <div className={`${s.heroCtas} ${s.revealUp}`} data-reveal>
            {ctas.map((cta) => (
              <Link
                key={cta.href + cta.en}
                href={cta.href}
                className={`${s.btn} ${
                  cta.variant === 'ghost' ? s.btnGhost : s.btnPrimary
                }`}
                onClick={() =>
                  track('landing_cta_click', {
                    location,
                    destination: cta.href,
                    active_role: V3_ACTIVE_ROLE,
                    language: isHi ? 'hi' : 'en',
                  })
                }
              >
                {t(cta.en, cta.hi)}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
