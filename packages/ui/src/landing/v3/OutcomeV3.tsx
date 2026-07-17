'use client';

import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import { CountUp, MasteryRing, ThinkingGlyph } from './MotionPrimitives';
import s from './welcome-v3.module.css';

/**
 * V3 outcome band — "You'll know every Sunday." copy beside a sample Sunday
 * parent-letter card. Carries id="results" (nav anchor).
 *
 * 2026-07-17 intelligence layer: the letter's mastery evidence is now LIVE —
 * a self-drawing mastery ring (stroke-dashoffset on reveal) with a count-up
 * percentage beside it. Values mirror the first letter bullet (62% → 78%,
 * Combustion & Flame). Reduced motion renders both at their final state.
 */
export default function OutcomeV3() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(80);

  return (
    <section className={s.section} id="results" aria-labelledby="outcome-v3-title">
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={s.outcomeGrid}>
          <div className={`${s.outcomeCopy} ${s.revealUp}`} data-reveal>
            <span className={s.eyebrow}>
              <ThinkingGlyph />
              {t('The outcome', 'परिणाम')}
            </span>
            <h2 id="outcome-v3-title">
              {t('You’ll know every Sunday.', 'हर रविवार आपको पता होगा।')}
            </h2>
            <p>
              {t(
                'No dashboards to decode. One short letter, in your language, every week — what your child mastered, what slipped, and the one thing to revise next.',
                'कोई उलझा डैशबोर्ड नहीं। हर सप्ताह आपकी भाषा में एक छोटा पत्र — बच्चे ने किसमें महारत पाई, क्या छूटा, और अगला एक काम।',
              )}
            </p>
            <p className={s.strongLine}>
              {t(
                'Measured in mastery %, not promised marks.',
                'महारत % में मापा गया — वादा किए गए अंकों में नहीं।',
              )}
            </p>
          </div>
          <div
            className={`${s.letter} ${s.revealUp}`}
            data-reveal
            aria-label={t('Sample Sunday letter', 'नमूना रविवार-पत्र')}
          >
            <div className={s.letterDate}>
              {t('Sunday, 12 July 2026', 'रविवार, 12 जुलाई 2026')}
            </div>
            <h3>{t('This week, Aarav…', 'इस सप्ताह, आरव…')}</h3>
            <div className={s.letterMastery}>
              <MasteryRing value={78} size={56} />
              <div>
                <div className={s.letterMasteryValue}>
                  <CountUp to={78} suffix="%" />
                </div>
                <div className={s.letterMasteryLabel}>
                  {t(
                    'Combustion & Flame — mastery now',
                    'दहन और ज्वाला — अब महारत',
                  )}
                </div>
              </div>
            </div>
            <ul>
              <li>
                <span className={`${s.mark} ${s.markOk}`} aria-hidden="true">
                  ✓
                </span>
                <span>
                  {isHi ? (
                    <>
                      विज्ञान — दहन और ज्वाला <strong>62% → 78%</strong> महारत।
                    </>
                  ) : (
                    <>
                      Science — Combustion &amp; Flame moved <strong>62% → 78%</strong> mastery.
                    </>
                  )}
                </span>
              </li>
              <li>
                <span className={`${s.mark} ${s.markOk}`} aria-hidden="true">
                  ✓
                </span>
                <span>
                  {t(
                    'Maths — got 4 of 5 Linear Equations practice sets right on the first try.',
                    'गणित — रैखिक समीकरण के 5 में से 4 अभ्यास सेट पहली बार में सही।',
                  )}
                </span>
              </li>
              <li>
                <span className={`${s.mark} ${s.markWatch}`} aria-hidden="true">
                  △
                </span>
                <span>
                  {t(
                    'Science — Photosynthesis: the light reaction steps are still shaky (54%).',
                    'विज्ञान — प्रकाश-संश्लेषण: प्रकाश अभिक्रिया के चरण अभी कच्चे हैं (54%)।',
                  )}
                </span>
              </li>
            </ul>
            <div className={s.letterAction}>
              {t('This week: revise light reaction.', 'इस सप्ताह: प्रकाश अभिक्रिया दोहराएँ।')}
            </div>
            <div className={s.letterSign}>— Foxy 🦊</div>
          </div>
        </div>
      </div>
    </section>
  );
}
