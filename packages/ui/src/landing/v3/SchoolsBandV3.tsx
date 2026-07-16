'use client';

import Link from 'next/link';
import { useWelcomeV2 } from '../WelcomeV2Context';
import { track } from '@alfanumrik/lib/posthog/client';
import { SCHOOL_PER_SEAT_MARKETING_LABEL } from '@alfanumrik/lib/pricing';
import { V3_ACTIVE_ROLE } from './NavV3';
import s from './welcome-v3.module.css';

/**
 * /pricing V3 — "For Schools" ink band on the Launch UI cta-with-glow
 * anatomy (one orange glow). Design source of truth:
 * design-previews/marketing-page-ultra.html (.schools).
 *
 * P11-adjacent copy rule (REG-65 family / REG-154): the "from ₹99" anchor
 * price renders `SCHOOL_PER_SEAT_MARKETING_LABEL` from the pricing SoT
 * (`@alfanumrik/lib/pricing`) — never a hardcoded literal, so the public
 * per-seat claim can't drift from the billed basic tier.
 */
export default function SchoolsBandV3() {
  const { isHi, t } = useWelcomeV2();

  const trackCta = (destination: string) =>
    track('landing_cta_click', {
      location: 'pricing_schools',
      destination,
      active_role: V3_ACTIVE_ROLE,
      language: isHi ? 'hi' : 'en',
    });

  return (
    <section className={s.schools} aria-labelledby="schools-band-title">
      <div className={s.schoolsGlow} aria-hidden="true"></div>
      <div className={`${s.wrap} ${s.schoolsInner}`}>
        <span className={s.eyebrow}>{t('For schools', 'विद्यालयों के लिए')}</span>
        <h2 id="schools-band-title" lang={isHi ? 'hi' : undefined}>
          {t(
            'Every Sunday, proof — for every classroom.',
            'हर रविवार, प्रमाण — हर कक्षा के लिए।',
          )}
        </h2>
        <p>
          {t(
            'School-wide mastery analytics, teacher Monday briefs, and a parent letter for every family — deployed across your school with training and support.',
            'विद्यालय-व्यापी महारत एनालिटिक्स, शिक्षकों के लिए सोमवार ब्रीफ़, और हर परिवार के लिए अभिभावक पत्र — प्रशिक्षण और सहायता के साथ आपके पूरे विद्यालय में लागू।',
          )}
        </p>
        <div className={s.anchorPrice}>
          {t('from ', '')}
          {SCHOOL_PER_SEAT_MARKETING_LABEL}
          <small>{t('/student/mo', '/छात्र/माह से')}</small>
        </div>
        <div className={s.schoolsActions}>
          <Link
            href="/contact"
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={() => trackCta('/contact')}
          >
            {t('Contact sales', 'सेल्स से संपर्क करें')}
          </Link>
          <Link
            href="/demo"
            className={`${s.btn} ${s.btnGhostDark}`}
            onClick={() => trackCta('/demo')}
          >
            {t('Book a school demo', 'स्कूल डेमो बुक करें')}
          </Link>
        </div>
      </div>
    </section>
  );
}
