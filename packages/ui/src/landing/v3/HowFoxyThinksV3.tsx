'use client';

import { Fragment } from 'react';
import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import { ThinkingGlyph } from './MotionPrimitives';
import s from './welcome-v3.module.css';

/**
 * HowFoxyThinksV3 — the "intelligence made visible" pipeline section
 * (2026-07-17 CEO directive). Sits between the features grid (#how) and the
 * ladder (#ladder) on /welcome.
 *
 * Four V3 cards — [Your question] → [Reads your NCERT chapter] →
 * [Checks your Bloom's level] → [Answers at YOUR level] — joined by dashed
 * connectors along which small dots travel continuously; each node pulses as
 * a dot arrives (CSS transform/opacity keyframes only, timing shared via the
 * --pipe-cycle custom property). Vertical stack on mobile, horizontal row at
 * >=1024px. Reduced motion: dots and pulses collapse, cards render static.
 *
 * No CTAs → no analytics events (the landing event-shape contract stays
 * untouched). No <h1>, no <details> → the welcome-root structural pins hold.
 */

interface PipeNode {
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  icon: React.ReactNode;
}

const NODES: PipeNode[] = [
  {
    titleEn: 'Your question',
    titleHi: 'आपका सवाल',
    bodyEn: 'Typed, spoken or snapped — straight from tonight’s homework.',
    bodyHi: 'लिखकर, बोलकर या फ़ोटो से — सीधे आज के गृहकार्य से।',
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z" />
        <path d="M9.6 9.5a2.5 2.5 0 0 1 4.9.7c0 1.6-2.5 2.3-2.5 2.3" />
        <path d="M12 15.8h.01" />
      </svg>
    ),
  },
  {
    titleEn: 'Reads your NCERT chapter',
    titleHi: 'आपका NCERT पाठ पढ़ता है',
    bodyEn: 'Finds the exact page and example in the book your child already has.',
    bodyHi: 'उसी किताब में ठीक वही पृष्ठ और उदाहरण खोजता है जो बच्चे के पास है।',
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7v14" />
        <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
        <path d="M5.5 8h3" />
        <path d="M5.5 12h3" />
      </svg>
    ),
  },
  {
    titleEn: 'Checks your Bloom’s level',
    titleHi: 'आपका Bloom’s स्तर जाँचता है',
    bodyEn: 'Recall, apply or analyse — it knows which rung your child stands on.',
    bodyHi: 'Recall, apply या analyse — यह जानता है कि बच्चा किस पायदान पर है।',
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 21v-6" />
        <path d="M12 21V10" />
        <path d="M19 21V4" />
        <path d="m14 6 5-2 2 5" />
      </svg>
    ),
  },
  {
    titleEn: 'Answers at YOUR level',
    titleHi: 'आपके स्तर पर जवाब देता है',
    bodyEn: 'Not a generic paragraph — an explanation pitched one step above where they are.',
    bodyHi: 'कोई रटा-रटाया जवाब नहीं — समझ से ठीक एक क़दम ऊपर की व्याख्या।',
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <path d="m9.8 12.2 1.6 1.6 2.8-3.2" />
      </svg>
    ),
  },
];

export default function HowFoxyThinksV3() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(60);

  return (
    <section
      className={`${s.section} ${s.pipe}`}
      id="how-foxy-thinks"
      aria-labelledby="how-foxy-thinks-title"
    >
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          <span className={s.eyebrow}>
            <ThinkingGlyph />
            {t('How Foxy thinks', 'फ़ॉक्सी कैसे सोचता है')}
          </span>
          <h2 id="how-foxy-thinks-title">
            {t('Intelligence you can watch working', 'बुद्धिमत्ता, जिसे काम करते देख सकें')}
          </h2>
          <p>
            {t(
              'Every answer travels the same path — grounded in NCERT, matched to your child’s level.',
              'हर जवाब एक ही रास्ते से आता है — NCERT में जड़ा हुआ, आपके बच्चे के स्तर से मेल खाता।',
            )}
          </p>
        </div>
        <div className={s.pipeFlow}>
          {NODES.map((node, i) => (
            <Fragment key={node.titleEn}>
              <div
                className={`${s.pipeNode} ${s.revealUp}`}
                data-reveal
                style={{ '--pulse-delay': `${i * 0.55}s` } as React.CSSProperties}
              >
                <div className={s.iconTile}>{node.icon}</div>
                <h3>{isHi ? node.titleHi : node.titleEn}</h3>
                <p>{isHi ? node.bodyHi : node.bodyEn}</p>
              </div>
              {i < NODES.length - 1 && (
                <div
                  className={s.pipeLink}
                  aria-hidden="true"
                  style={{ '--pipe-delay': `${i * 0.55}s` } as React.CSSProperties}
                >
                  <i className={s.pipeDot}></i>
                  <i className={s.pipeDot}></i>
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
