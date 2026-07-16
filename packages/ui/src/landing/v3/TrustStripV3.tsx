'use client';

import { useWelcomeV2 } from '../WelcomeV2Context';
import s from './welcome-v3.module.css';

/**
 * V3 social-proof strip — subject/coverage chips between the hero panel and
 * the features grid. Pure content, no interaction.
 */

const CHIPS = [
  { en: 'Maths', hi: 'गणित' },
  { en: 'Science', hi: 'विज्ञान' },
  { en: 'SST', hi: 'सामाजिक विज्ञान' },
  { en: 'English', hi: 'अंग्रेज़ी' },
  // हिंदी stays Devanagari in both languages (it names the subject itself).
  { en: 'हिंदी', hi: 'हिंदी', alwaysHi: true },
  { en: 'Classes 6–12', hi: 'कक्षा 6–12' },
  { en: 'CBSE', hi: 'CBSE' },
  { en: 'NCERT', hi: 'NCERT' },
  { en: 'JEE/NEET-tagged practice', hi: 'JEE/NEET-टैग्ड अभ्यास' },
] as const;

export default function TrustStripV3() {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={s.proof} aria-label={t('Coverage', 'कवरेज')}>
      <div className={s.wrap}>
        <ul>
          {CHIPS.map((chip) => (
            <li
              key={chip.en}
              lang={'alwaysHi' in chip && chip.alwaysHi ? 'hi' : isHi ? 'hi' : undefined}
            >
              {t(chip.en, chip.hi)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
