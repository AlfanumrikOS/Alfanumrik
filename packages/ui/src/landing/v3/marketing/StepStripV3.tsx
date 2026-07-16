'use client';

import type { ReactNode } from 'react';
import { useWelcomeV2 } from '../../WelcomeV2Context';
import { useReveal } from '../../useReveal';
import s from '../welcome-v3.module.css';
import m from './marketing-v3.module.css';

/**
 * StepStripV3 — numbered how-it-works strip on the LadderStripV3 anatomy
 * (big saffron-tint numeral · h3 · one-liner) for 3 or 4 sequential steps.
 * Rendered as an <ol> — the numbering is semantic, not decorative.
 * No purple variant here: purple stays exclusive to the Competition Scale
 * marker in LadderStripV3.
 */

export interface StepStripItem {
  titleEn: ReactNode;
  titleHi: ReactNode;
  bodyEn: ReactNode;
  bodyHi: ReactNode;
}

export interface StepStripV3Props {
  headingId: string;
  eyebrowEn?: string;
  eyebrowHi?: string;
  titleEn: ReactNode;
  titleHi: ReactNode;
  steps: StepStripItem[];
  /** Cream band tint (default true — matches the ladder strip). */
  tint?: boolean;
}

export default function StepStripV3({
  headingId,
  eyebrowEn,
  eyebrowHi,
  titleEn,
  titleHi,
  steps,
  tint = true,
}: StepStripV3Props) {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(50);

  return (
    <section
      className={`${s.section} ${tint ? m.tintCream : ''}`.trim()}
      aria-labelledby={headingId}
    >
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          {eyebrowEn && eyebrowHi && (
            <span className={s.eyebrow}>{t(eyebrowEn, eyebrowHi)}</span>
          )}
          <h2 id={headingId}>{isHi ? titleHi : titleEn}</h2>
        </div>
        <ol
          className={steps.length > 3 ? m.stripGrid4 : s.stripGrid}
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {steps.map((step, i) => (
            <li key={i} className={`${s.stripStep} ${s.revealUp}`} data-reveal>
              <div className={s.num} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div>
                <h3>{isHi ? step.titleHi : step.titleEn}</h3>
                <p>{isHi ? step.bodyHi : step.bodyEn}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
