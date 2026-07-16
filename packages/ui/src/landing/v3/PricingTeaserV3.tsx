'use client';

import Link from 'next/link';
import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import { track } from '@alfanumrik/lib/posthog/client';
import { PRICING, formatINR } from '@alfanumrik/lib/plans';
import { V3_ACTIVE_ROLE } from './NavV3';
import s from './welcome-v3.module.css';

/**
 * V3 pricing teaser — Tailark pricing anatomy: 4 cards (Explorer free,
 * Starter, Pro featured, Unlimited) on the warm cream tint.
 *
 * P11-adjacent copy rule: every rupee figure comes from
 * `@alfanumrik/lib/plans` PRICING — zero hardcoded price literals here.
 */

const CHECK = (
  <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

interface TeaserPlan {
  nameEn: string;
  nameHi: string;
  monthly: number | null; // null = free
  yearly: number | null;
  featured?: boolean;
  ctaEn: string;
  ctaHi: string;
  ctaStyle: 'soft' | 'neutral' | 'primary';
  features: { en: string; hi: string }[];
}

const TEASER_PLANS: TeaserPlan[] = [
  {
    nameEn: 'Explorer',
    nameHi: 'एक्सप्लोरर',
    monthly: null,
    yearly: null,
    ctaEn: 'Start free',
    ctaHi: 'मुफ्त शुरू करें',
    ctaStyle: 'soft',
    features: [
      { en: '5 Foxy chats / day', hi: 'प्रतिदिन 5 फ़ॉक्सी चैट' },
      { en: '5 quizzes / day', hi: 'प्रतिदिन 5 क्विज़' },
      { en: '2 subjects', hi: '2 विषय' },
    ],
  },
  {
    nameEn: 'Starter',
    nameHi: 'स्टार्टर',
    monthly: PRICING.starter.monthly,
    yearly: PRICING.starter.yearly,
    ctaEn: 'Get started',
    ctaHi: 'शुरू करें',
    ctaStyle: 'neutral',
    features: [
      { en: '30 Foxy chats / day', hi: 'प्रतिदिन 30 फ़ॉक्सी चैट' },
      { en: '20 quizzes / day', hi: 'प्रतिदिन 20 क्विज़' },
      { en: '4 subjects + STEM Lab', hi: '4 विषय + STEM लैब' },
    ],
  },
  {
    nameEn: 'Pro',
    nameHi: 'प्रो',
    monthly: PRICING.pro.monthly,
    yearly: PRICING.pro.yearly,
    featured: true,
    ctaEn: 'Get started',
    ctaHi: 'शुरू करें',
    ctaStyle: 'primary',
    features: [
      { en: '100 Foxy chats / day', hi: 'प्रतिदिन 100 फ़ॉक्सी चैट' },
      { en: 'Unlimited quizzes', hi: 'असीमित क्विज़' },
      { en: 'All subjects + STEM Lab', hi: 'सभी विषय + STEM लैब' },
    ],
  },
  {
    nameEn: 'Unlimited',
    nameHi: 'अनलिमिटेड',
    monthly: PRICING.unlimited.monthly,
    yearly: PRICING.unlimited.yearly,
    ctaEn: 'Get started',
    ctaHi: 'शुरू करें',
    ctaStyle: 'neutral',
    features: [
      { en: 'Unlimited Foxy chats', hi: 'असीमित फ़ॉक्सी चैट' },
      { en: 'Unlimited quizzes', hi: 'असीमित क्विज़' },
      { en: 'All subjects + STEM Lab', hi: 'सभी विषय + STEM लैब' },
    ],
  },
];

const CTA_CLASS: Record<TeaserPlan['ctaStyle'], string> = {
  soft: s.btnSoft,
  neutral: s.btnNeutral,
  primary: s.btnPrimary,
};

export default function PricingTeaserV3() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(60);

  return (
    <section
      className={`${s.section} ${s.pricing}`}
      id="pricing"
      aria-labelledby="pricing-v3-title"
    >
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          <span className={s.eyebrow}>{t('Pricing', 'मूल्य')}</span>
          <h2 id="pricing-v3-title">
            {t(
              'Less than a single tuition class a month.',
              'महीने की एक ट्यूशन क्लास से भी कम।',
            )}
          </h2>
          <p>
            {t(
              'Start free. Upgrade when it earns it.',
              'मुफ्त शुरू करें। जब यह लायक़ साबित हो, तभी अपग्रेड करें।',
            )}
          </p>
        </div>
        <div className={s.pricingGrid}>
          {TEASER_PLANS.map((plan) => (
            <article
              key={plan.nameEn}
              className={`${s.priceCard} ${plan.featured ? s.priceFeatured : ''} ${s.revealUp}`}
              data-reveal
              aria-label={t(plan.nameEn, plan.nameHi)}
            >
              {plan.featured ? (
                <div className={s.priceBadge}>{t('Most popular', 'सबसे लोकप्रिय')}</div>
              ) : null}
              <div className={s.priceHead}>
                <h3>{t(plan.nameEn, plan.nameHi)}</h3>
                {plan.monthly === null ? (
                  <>
                    <span className={s.amount}>{formatINR(0)}</span>
                    <div className={s.per}>{t('Free forever', 'हमेशा के लिए मुफ्त')}</div>
                  </>
                ) : (
                  <>
                    <span className={s.amount}>
                      {formatINR(plan.monthly)}
                      <small>{t('/mo', '/माह')}</small>
                    </span>
                    <div className={s.per}>
                      {t(
                        `or ${formatINR(plan.yearly ?? 0)} billed yearly`,
                        `या ${formatINR(plan.yearly ?? 0)} वार्षिक`,
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className={s.priceCta}>
                <Link
                  href="/login"
                  className={`${s.btn} ${CTA_CLASS[plan.ctaStyle]}`}
                  onClick={() =>
                    track('landing_cta_click', {
                      location: 'pricing_teaser',
                      destination: '/login',
                      active_role: V3_ACTIVE_ROLE,
                      language: isHi ? 'hi' : 'en',
                    })
                  }
                >
                  {t(plan.ctaEn, plan.ctaHi)}
                </Link>
              </div>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature.en}>
                    {CHECK}
                    {t(feature.en, feature.hi)}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <p className={`${s.pricingNote} ${s.revealUp}`} data-reveal>
          {t(
            'Save ~33% billed yearly · Start free — no card. Cancel anytime.',
            'वार्षिक बिलिंग पर ~33% बचत · मुफ्त शुरू करें — कोई कार्ड नहीं। कभी भी रद्द करें।',
          )}{' '}
          <Link
            href="/pricing"
            onClick={() =>
              track('landing_nav_click', {
                source: 'pricing_teaser',
                destination: '/pricing',
                label: t('See full plan details', 'पूरी योजना देखें'),
                active_role: V3_ACTIVE_ROLE,
              })
            }
          >
            {t('See full plan details →', 'पूरी योजना देखें →')}
          </Link>
        </p>
      </div>
    </section>
  );
}
