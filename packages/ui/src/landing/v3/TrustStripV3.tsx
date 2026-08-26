'use client';

import { useWelcomeV2 } from '../WelcomeV2Context';
import s from './welcome-v3.module.css';

/**
 * V3 social-proof strip — subject/coverage chips between the hero panel and
 * the features grid. Pure content, no interaction.
 */

// CATALOGUE-CLAIM FIX (2026-08-12): this strip carried SST, English and हिंदी
// chips. Production `subjects.is_active` is true for exactly five codes —
// math, science, physics, chemistry, biology — so under an aria-label reading
// "Coverage" those three chips claimed subjects we do not teach. Replaced with
// the real catalogue: Maths and Science, with Physics/Chemistry/Biology named
// as the 11–12 Science group (see docs/alfabot/knowledge-base.md,
// product-features). The `alwaysHi` escape hatch went with the हिंदी chip; it
// had no other user.
const CHIPS = [
  { en: 'Maths', hi: 'गणित' },
  { en: 'Science', hi: 'विज्ञान' },
  { en: 'Physics · Chemistry · Biology (11–12)', hi: 'भौतिकी · रसायन · जीवविज्ञान (11–12)' },
  { en: 'Classes 6–12', hi: 'कक्षा 6–12' },
  { en: 'CBSE', hi: 'CBSE' },
  { en: 'NCERT', hi: 'NCERT' },
  { en: 'JEE/NEET-tagged practice', hi: 'JEE/NEET-टैग्ड अभ्यास' },
] as const;

export function TrustStripV3() {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={s.proof} aria-label={t('Coverage', 'कवरेज')}>
      <div className={s.wrap}>
        <ul>
          {CHIPS.map((chip) => (
            <li key={chip.en} lang={isHi ? 'hi' : undefined}>
              {t(chip.en, chip.hi)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Stats bar — animated counters below the coverage chips */
const STATS = [
  { value: '12,000+', labelEn: 'Students', labelHi: 'विद्यार्थी', icon: '🎓' },
  { value: '500K+', labelEn: 'Questions answered', labelHi: 'सवालों के जवाब', icon: '📝' },
  { value: '2.5M+', labelEn: 'Foxy conversations', labelHi: 'Foxy बातचीत', icon: '💬' },
  { value: '4.8★', labelEn: 'Average rating', labelHi: 'औसत रेटिंग', icon: '⭐' },
] as const;

const BADGES = [
  { en: 'DPDPA compliant', hi: 'DPDPA-अनुरूप', icon: '🛡️' },
  { en: 'NCERT-aligned', hi: 'NCERT-आधारित', icon: '📚' },
  { en: 'Made in India', hi: 'भारत में निर्मित', icon: '🇮🇳' },
  { en: 'Ad-free', hi: 'विज्ञापन-मुक्त', icon: '🚫' },
] as const;

export function TrustStats() {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={s.trustStats} aria-label={t('Platform stats', 'प्लेटफ़ॉर्म आँकड़े')}>
      <div className={s.wrap}>
        <div className={s.statsGrid}>
          {STATS.map((stat) => (
            <div key={stat.labelEn} className={s.statItem}>
              <span className={s.statIcon} aria-hidden="true">{stat.icon}</span>
              <span className={s.statValue}>{stat.value}</span>
              <span className={s.statLabel}>{t(stat.labelEn, stat.labelHi)}</span>
            </div>
          ))}
        </div>
        <div className={s.badgesRow}>
          {BADGES.map((badge) => (
            <span key={badge.en} className={s.badge}>
              <span aria-hidden="true">{badge.icon}</span>
              {t(badge.en, badge.hi)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export default TrustStripV3;
