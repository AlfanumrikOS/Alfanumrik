'use client';

import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import s from './welcome-v3.module.css';

/**
 * /pricing V3 — compact cream ladder strip: the one-liner version of
 * LadderV3's NCERT → Board → Competition message. Design source of truth:
 * design-previews/marketing-page-ultra.html (.ladder-strip).
 *
 * V3 color contract: purple appears EXACTLY once per page — on the
 * Competition Scale marker (step 03).
 */

interface StripStep {
  num: string;
  purple?: boolean;
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
}

const STEPS: StripStep[] = [
  {
    num: '01',
    titleEn: 'NCERT Foundation',
    titleHi: 'NCERT नींव',
    bodyEn: 'Tonight’s homework, explained from the book your child already has.',
    bodyHi: 'आज का गृहकार्य, उसी किताब से समझाया गया जो आपके बच्चे के पास पहले से है।',
  },
  {
    num: '02',
    titleEn: 'Board Mastery',
    titleHi: 'बोर्ड महारत',
    bodyEn: 'Board-pattern practice, mastery tracked per chapter.',
    bodyHi: 'बोर्ड-पैटर्न अभ्यास, हर अध्याय की महारत के साथ।',
  },
  {
    num: '03',
    purple: true,
    titleEn: 'Competition Scale',
    titleHi: 'प्रतियोगिता स्तर',
    bodyEn: 'JEE Main · JEE Advanced · NEET · Olympiad-grade Bloom’s.',
    bodyHi: 'JEE Main · JEE Advanced · NEET · Olympiad-स्तर Bloom’s।',
  },
];

export default function LadderStripV3() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(50);

  return (
    <section className={s.ladderStrip} aria-labelledby="ladder-strip-title">
      <h2 id="ladder-strip-title" className={s.srOnly}>
        {t('The ladder', 'सीढ़ी')}
      </h2>
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={s.stripGrid}>
          {STEPS.map((step) => (
            <div
              key={step.num}
              className={`${s.stripStep} ${step.purple ? s.isPurple : ''} ${s.revealUp}`}
              data-reveal
            >
              <div className={s.num} aria-hidden="true">
                {step.num}
              </div>
              <div>
                <h3>{isHi ? step.titleHi : step.titleEn}</h3>
                <p>{isHi ? step.bodyHi : step.bodyEn}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
