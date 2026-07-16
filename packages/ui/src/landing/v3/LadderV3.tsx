'use client';

import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import s from './welcome-v3.module.css';

/**
 * V3 "The Ladder" — three-step progression on the warm cream tint.
 * Step 03 (Competition Scale) is the page's ONLY purple accent — hard
 * contract from the approved design.
 */

interface Step {
  num: string;
  purple?: boolean;
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  tags: { en: string; hi: string }[];
}

const STEPS: Step[] = [
  {
    num: '01',
    titleEn: 'NCERT Foundation',
    titleHi: 'NCERT नींव',
    bodyEn:
      'Tonight’s homework, every exercise, every in-text question — explained from the book your child already has.',
    bodyHi:
      'आज का गृहकार्य, हर अभ्यास, हर इन-टेक्स्ट प्रश्न — उसी किताब से समझाया गया जो आपके बच्चे के पास पहले से है।',
    tags: [
      { en: 'Classes 6–12', hi: 'कक्षा 6–12' },
      { en: 'All NCERT chapters', hi: 'सभी NCERT पाठ' },
    ],
  },
  {
    num: '02',
    titleEn: 'Board Mastery',
    titleHi: 'बोर्ड महारत',
    bodyEn:
      'Board-pattern practice with mastery tracked per chapter — so revision targets weakness, not habit.',
    bodyHi:
      'बोर्ड-पैटर्न अभ्यास, हर अध्याय की महारत के साथ — ताकि दोहराव कमज़ोरी पर निशाना लगाए, आदत पर नहीं।',
    tags: [
      { en: 'Board-pattern MCQs', hi: 'बोर्ड-पैटर्न MCQ' },
      { en: 'Mastery %', hi: 'महारत %' },
    ],
  },
  {
    num: '03',
    purple: true,
    titleEn: 'Competition Scale',
    titleHi: 'प्रतियोगिता स्तर',
    bodyEn: 'The same chapters, pushed to competition depth with higher-order Bloom’s questions.',
    bodyHi: 'वही अध्याय, प्रतियोगिता की गहराई तक — उच्च-स्तरीय Bloom’s प्रश्नों के साथ।',
    tags: [
      { en: 'JEE Main', hi: 'JEE Main' },
      { en: 'JEE Advanced', hi: 'JEE Advanced' },
      { en: 'NEET', hi: 'NEET' },
      { en: 'Olympiad-grade Bloom’s', hi: 'Olympiad-स्तर Bloom’s' },
    ],
  },
];

export default function LadderV3() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(50);

  return (
    <section className={`${s.section} ${s.ladder}`} id="ladder" aria-labelledby="ladder-v3-title">
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          <span className={s.eyebrow}>{t('The ladder', 'सीढ़ी')}</span>
          <h2 id="ladder-v3-title">
            {t('Starts at NCERT. Doesn’t stop there.', 'शुरुआत NCERT से। रुकती वहाँ नहीं।')}
          </h2>
          <p>
            {t(
              'One system that grows with your child — no switching apps at Class 10.',
              'एक ही सिस्टम जो आपके बच्चे के साथ बढ़ता है — कक्षा 10 पर ऐप बदलने की ज़रूरत नहीं।',
            )}
          </p>
        </div>
        <div className={s.ladderGrid}>
          {STEPS.map((step) => (
            <div
              key={step.num}
              className={`${s.ladderStep} ${step.purple ? s.isPurple : ''} ${s.revealUp}`}
              data-reveal
            >
              <div className={s.num} aria-hidden="true">
                {step.num}
              </div>
              <h3>{isHi ? step.titleHi : step.titleEn}</h3>
              <p>{isHi ? step.bodyHi : step.bodyEn}</p>
              <div className={s.tags}>
                {step.tags.map((tag) => (
                  <span key={tag.en}>{t(tag.en, tag.hi)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
