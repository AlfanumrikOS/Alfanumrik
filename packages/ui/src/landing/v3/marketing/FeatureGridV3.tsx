'use client';

import type { ReactNode } from 'react';
import { useWelcomeV2 } from '../../WelcomeV2Context';
import { useReveal } from '../../useReveal';
import s from '../welcome-v3.module.css';
import m from './marketing-v3.module.css';

/**
 * FeatureGridV3 — marketing feature grid on the Tailark features-1 card
 * anatomy (cream icon tile · h3 · body). 2- or 3-column. Icons are inline
 * lucide-style stroke SVGs (see MarketingIcons.tsx) — never emoji, per the
 * v3 style contract.
 *
 * Optional `kicker` per item renders the teacher-page before → after line
 * (struck-through pain → orange outcome) between the tile and the title.
 */

export interface FeatureGridKicker {
  /**
   * The struck-through pain, e.g. "Grading takes hours". Renders as
   * "<struck was> →" above the h3 — the card TITLE is the "after" state,
   * so the pair reads pain → outcome without duplicating the heading.
   */
  wasEn: string;
  wasHi: string;
}

export interface FeatureGridItem {
  icon: ReactNode;
  titleEn: ReactNode;
  titleHi: ReactNode;
  bodyEn: ReactNode;
  bodyHi: ReactNode;
  /** Optional before→after kicker (teacher pain-point anatomy). */
  kicker?: FeatureGridKicker;
}

export interface FeatureGridV3Props {
  headingId: string;
  /** Optional section anchor id. */
  id?: string;
  eyebrowEn?: string;
  eyebrowHi?: string;
  titleEn: ReactNode;
  titleHi: ReactNode;
  ledeEn?: ReactNode;
  ledeHi?: ReactNode;
  /** 2 or 3 columns at desktop. Default 3. */
  columns?: 2 | 3;
  /** Cream section tint (alternating band rhythm). */
  tint?: boolean;
  items: FeatureGridItem[];
}

export default function FeatureGridV3({
  headingId,
  id,
  eyebrowEn,
  eyebrowHi,
  titleEn,
  titleHi,
  ledeEn,
  ledeHi,
  columns = 3,
  tint = false,
  items,
}: FeatureGridV3Props) {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(50);

  return (
    <section
      className={`${s.section} ${tint ? m.tintCream : ''}`.trim()}
      id={id}
      aria-labelledby={headingId}
    >
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          {eyebrowEn && eyebrowHi && (
            <span className={s.eyebrow}>{t(eyebrowEn, eyebrowHi)}</span>
          )}
          <h2 id={headingId}>{isHi ? titleHi : titleEn}</h2>
          {ledeEn != null && ledeHi != null && <p>{isHi ? ledeHi : ledeEn}</p>}
        </div>
        <div className={columns === 2 ? m.grid2 : s.featuresGrid}>
          {items.map((item, i) => (
            <div key={i} className={`${s.featureCard} ${s.revealUp}`} data-reveal>
              <div className={s.iconTile}>{item.icon}</div>
              {item.kicker && (
                <div className={m.kicker}>
                  <span className={m.was}>
                    {t(item.kicker.wasEn, item.kicker.wasHi)}
                  </span>
                  <span className={m.arrow} aria-hidden="true">
                    →
                  </span>
                </div>
              )}
              <h3>{isHi ? item.titleHi : item.titleEn}</h3>
              <p>{isHi ? item.bodyHi : item.bodyEn}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
