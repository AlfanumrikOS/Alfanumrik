'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import { track } from '@alfanumrik/lib/posthog/client';
import { PRICING, formatINR, yearlyPerMonth } from '@alfanumrik/lib/plans';
import { useCheckout } from '@alfanumrik/lib/hooks/useCheckout';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { SubscriptionConfirm } from '../../SubscriptionConfirm';
import { V3_ACTIVE_ROLE } from './NavV3';
import type { BillingCycle } from './PricingHeroV3';
import s from './welcome-v3.module.css';

/**
 * /pricing V3 — four FULL plan cards on the Tailark pricing anatomy
 * (header → bordered CTA band → feature list). Design source of truth:
 * design-previews/marketing-page-ultra.html (.plans).
 *
 * P11-adjacent copy rule: every rupee figure in card rendering comes from
 * `@alfanumrik/lib/plans` PRICING (+ `yearlyPerMonth` for the ≈/mo
 * equivalent) — ZERO hardcoded price literals here.
 *
 * Behavior carried over from the legacy PricingCards.tsx (not in the static
 * preview): logged-in visitors get the SubscriptionConfirm → useCheckout
 * Razorpay flow instead of a /login link. Feature lists (incl. Explorer's
 * excluded STEM Lab) are the REAL lists lifted verbatim from PricingCards.
 */

const CHECK = (
  <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const DASH = (
  <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14" />
  </svg>
);

type PaidPlanCode = 'starter' | 'pro' | 'unlimited';

interface PlanDef {
  nameEn: string;
  nameHi: string;
  /** null = the free Explorer plan */
  code: PaidPlanCode | null;
  taglineEn: string;
  taglineHi: string;
  featured?: boolean;
  ctaEn: string;
  ctaHi: string;
  ctaStyle: 'soft' | 'neutral' | 'primary';
  features: { en: string; hi: string; included: boolean }[];
}

/** Feature lists lifted verbatim from the legacy PricingCards.tsx. */
const PLANS: PlanDef[] = [
  {
    nameEn: 'Explorer',
    nameHi: 'एक्सप्लोरर',
    code: null,
    taglineEn: 'Get started with Foxy for free',
    taglineHi: 'Foxy के साथ मुफ़्त शुरू करें',
    ctaEn: 'Start free',
    ctaHi: 'मुफ़्त शुरू करें',
    ctaStyle: 'soft',
    features: [
      { en: '5 Foxy chats / day', hi: '5 Foxy चैट / दिन', included: true },
      { en: '5 quizzes / day', hi: '5 क्विज़ / दिन', included: true },
      { en: '2 subjects', hi: '2 विषय', included: true },
      { en: 'Progress reports', hi: 'प्रगति रिपोर्ट', included: true },
      { en: 'Spaced repetition', hi: 'स्पेस्ड रिपीटिशन', included: true },
      { en: 'STEM Lab', hi: 'STEM लैब', included: false },
    ],
  },
  {
    nameEn: 'Starter',
    nameHi: 'स्टार्टर',
    code: 'starter',
    taglineEn: 'More chats, more subjects',
    taglineHi: 'ज़्यादा चैट, ज़्यादा विषय',
    ctaEn: 'Get started',
    ctaHi: 'शुरू करें',
    ctaStyle: 'neutral',
    features: [
      { en: '30 Foxy chats / day', hi: '30 Foxy चैट / दिन', included: true },
      { en: '20 quizzes / day', hi: '20 क्विज़ / दिन', included: true },
      { en: '4 subjects', hi: '4 विषय', included: true },
      { en: 'Progress reports', hi: 'प्रगति रिपोर्ट', included: true },
      { en: 'Spaced repetition', hi: 'स्पेस्ड रिपीटिशन', included: true },
      { en: 'STEM Lab', hi: 'STEM लैब', included: true },
    ],
  },
  {
    nameEn: 'Pro',
    nameHi: 'प्रो',
    code: 'pro',
    taglineEn: 'The complete learning experience',
    taglineHi: 'संपूर्ण सीखने का अनुभव',
    featured: true,
    ctaEn: 'Get started',
    ctaHi: 'शुरू करें',
    ctaStyle: 'primary',
    features: [
      { en: '100 Foxy chats / day', hi: '100 Foxy चैट / दिन', included: true },
      { en: 'Unlimited quizzes', hi: 'असीमित क्विज़', included: true },
      { en: 'All subjects', hi: 'सभी विषय', included: true },
      { en: 'Progress reports', hi: 'प्रगति रिपोर्ट', included: true },
      { en: 'Spaced repetition', hi: 'स्पेस्ड रिपीटिशन', included: true },
      { en: 'STEM Lab', hi: 'STEM लैब', included: true },
    ],
  },
  {
    nameEn: 'Unlimited',
    nameHi: 'अनलिमिटेड',
    code: 'unlimited',
    taglineEn: 'No limits, maximum results',
    taglineHi: 'कोई सीमा नहीं, अधिकतम परिणाम',
    ctaEn: 'Get started',
    ctaHi: 'शुरू करें',
    ctaStyle: 'neutral',
    features: [
      { en: 'Unlimited Foxy chats', hi: 'असीमित Foxy चैट', included: true },
      { en: 'Unlimited quizzes', hi: 'असीमित क्विज़', included: true },
      { en: 'All subjects', hi: 'सभी विषय', included: true },
      { en: 'Progress reports', hi: 'प्रगति रिपोर्ट', included: true },
      { en: 'Spaced repetition', hi: 'स्पेस्ड रिपीटिशन', included: true },
      { en: 'STEM Lab', hi: 'STEM लैब', included: true },
    ],
  },
];

const CTA_CLASS: Record<PlanDef['ctaStyle'], string> = {
  soft: s.btnSoft,
  neutral: s.btnNeutral,
  primary: s.btnPrimary,
};

export default function PricingPlansV3({ cycle }: { cycle: BillingCycle }) {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(60);
  const { isLoggedIn } = useAuth();
  const { checkout, loading: checkoutLoading } = useCheckout();
  const [confirmPlan, setConfirmPlan] = useState<PlanDef | null>(null);
  const [successPlan, setSuccessPlan] = useState<string | null>(null);

  const yearly = cycle === 'yearly';

  const trackCta = (destination: string) =>
    track('landing_cta_click', {
      location: 'pricing_plans',
      destination,
      active_role: V3_ACTIVE_ROLE,
      language: isHi ? 'hi' : 'en',
    });

  return (
    <section className={s.plansSection} id="plans" aria-labelledby="pricing-plans-title">
      <h2 id="pricing-plans-title" className={s.srOnly}>
        {t('Plans', 'योजनाएँ')}
      </h2>
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={s.pricingGrid}>
          {PLANS.map((plan) => {
            const price = plan.code ? PRICING[plan.code] : null;
            return (
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
                  <div className={s.priceTagline}>{t(plan.taglineEn, plan.taglineHi)}</div>
                  {price === null ? (
                    <>
                      <span className={s.amount}>{formatINR(0)}</span>
                      <div className={s.pricePer}>
                        {t('Free forever · no card', 'हमेशा मुफ़्त · कोई कार्ड नहीं')}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className={s.amount}>
                        {yearly ? formatINR(price.yearly) : formatINR(price.monthly)}
                        <small>{yearly ? t('/yr', '/वर्ष') : t('/mo', '/माह')}</small>
                      </span>
                      <div className={s.pricePer}>
                        {yearly
                          ? t(
                              `≈ ${formatINR(yearlyPerMonth(price.yearly))}/mo, billed yearly`,
                              `≈ ${formatINR(yearlyPerMonth(price.yearly))}/माह, वार्षिक बिलिंग`,
                            )
                          : t(
                              `or ${formatINR(price.yearly)} billed yearly`,
                              `या ${formatINR(price.yearly)} वार्षिक बिलिंग`,
                            )}
                      </div>
                    </>
                  )}
                </div>

                <div className={s.priceCta}>
                  {plan.code === null || !isLoggedIn ? (
                    <Link
                      href="/login"
                      className={`${s.btn} ${CTA_CLASS[plan.ctaStyle]}`}
                      onClick={() => trackCta('/login')}
                    >
                      {t(plan.ctaEn, plan.ctaHi)}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={`${s.btn} ${CTA_CLASS[plan.ctaStyle]}`}
                      disabled={checkoutLoading}
                      onClick={() => {
                        trackCta('checkout');
                        setConfirmPlan(plan);
                      }}
                    >
                      {successPlan === plan.nameEn.toLowerCase()
                        ? t('Upgraded!', 'अपग्रेड हो गया!')
                        : checkoutLoading
                          ? t('Processing…', 'प्रोसेसिंग…')
                          : t(plan.ctaEn, plan.ctaHi)}
                    </button>
                  )}
                </div>

                <ul>
                  {plan.features.map((feature) => (
                    <li
                      key={feature.en}
                      className={feature.included ? undefined : s.liExcluded}
                    >
                      {feature.included ? CHECK : DASH}
                      {feature.included ? (
                        t(feature.en, feature.hi)
                      ) : (
                        <>
                          <span className={s.srOnly}>
                            {t('Not included:', 'शामिल नहीं:')}{' '}
                          </span>
                          {t(feature.en, feature.hi)}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
        <p className={`${s.pricingNote} ${s.revealUp}`} data-reveal>
          {t(
            '7-day money-back guarantee on all paid plans · Cancel anytime',
            'सभी सशुल्क प्लान पर 7-दिन की मनी-बैक गारंटी · कभी भी रद्द करें',
          )}
        </p>
      </div>

      {/* Subscription confirmation dialog (logged-in checkout, from legacy PricingCards) */}
      <SubscriptionConfirm
        isOpen={!!confirmPlan}
        planName={confirmPlan?.nameEn || ''}
        planCode={confirmPlan?.code || ''}
        priceMonthly={confirmPlan?.code ? PRICING[confirmPlan.code].monthly : 0}
        priceYearly={confirmPlan?.code ? PRICING[confirmPlan.code].yearly : 0}
        billingCycle={cycle}
        loading={checkoutLoading}
        onCancel={() => setConfirmPlan(null)}
        onConfirm={() => {
          if (!confirmPlan?.code) return;
          checkout({
            planCode: confirmPlan.code,
            billingCycle: cycle,
            onSuccess: (p) => {
              setSuccessPlan(p);
              setConfirmPlan(null);
            },
            onError: () => setConfirmPlan(null),
          });
        }}
      />
    </section>
  );
}
