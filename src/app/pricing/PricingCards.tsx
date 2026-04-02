'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCheckout } from '@/hooks/useCheckout';
import { useAuth } from '@/lib/AuthContext';
import { SubscriptionConfirm } from '@/components/SubscriptionConfirm';
import { useLang } from '@/components/landing/LangToggle';
import { PRICING, formatINR } from '@/lib/plans';

/* ─── Plan Data ─── */

interface Plan {
  name: string;
  code: string;
  tagline: string;
  taglineHi: string;
  yearlySaving: string;
  yearlySavingHi: string;
  popular: boolean;
  features: { label: string; labelHi: string; included: boolean }[];
  cta: string;
  ctaHi: string;
  href: string;
  free: boolean;
}

/** Derive display prices from centralized PRICING config */
function getPlanPrices(code: string) {
  if (code === 'free') return { monthlyPrice: 'Free', yearlyPrice: 'Free', monthlyPriceNum: 0, yearlyPriceNum: 0 };
  const p = PRICING[code as keyof typeof PRICING];
  return {
    monthlyPrice: formatINR(p.monthly),
    yearlyPrice: formatINR(p.yearly),
    monthlyPriceNum: p.monthly,
    yearlyPriceNum: p.yearly,
  };
}

const PLANS: Plan[] = [
  {
    name: 'Explorer',
    code: 'free',
    tagline: 'Get started with Foxy for free',
    taglineHi: 'Foxy के साथ मुफ़्त शुरू करें',
    yearlySaving: '',
    yearlySavingHi: '',
    popular: false,
    free: true,
    cta: 'Start Free',
    ctaHi: 'मुफ़्त शुरू करें',
    href: '/login',
    features: [
      { label: '5 Foxy chats / day', labelHi: '5 Foxy चैट / दिन', included: true },
      { label: '5 quizzes / day', labelHi: '5 क्विज़ / दिन', included: true },
      { label: '2 subjects', labelHi: '2 विषय', included: true },
      { label: 'Progress reports', labelHi: 'प्रगति रिपोर्ट', included: true },
      { label: 'Spaced repetition', labelHi: 'स्पेस्ड रिपीटिशन', included: true },
      { label: 'STEM Centre', labelHi: 'STEM सेंटर', included: false },
    ],
  },
  {
    name: 'Starter',
    code: 'starter',
    tagline: 'More chats, more subjects',
    taglineHi: 'ज़्यादा चैट, ज़्यादा विषय',
    yearlySaving: 'Save 33%',
    yearlySavingHi: '33% बचाएँ',
    popular: false,
    free: false,
    cta: 'Get Started',
    ctaHi: 'शुरू करें',
    href: '/login',
    features: [
      { label: '30 Foxy chats / day', labelHi: '30 Foxy चैट / दिन', included: true },
      { label: '20 quizzes / day', labelHi: '20 क्विज़ / दिन', included: true },
      { label: '4 subjects', labelHi: '4 विषय', included: true },
      { label: 'Progress reports', labelHi: 'प्रगति रिपोर्ट', included: true },
      { label: 'Spaced repetition', labelHi: 'स्पेस्ड रिपीटिशन', included: true },
      { label: 'STEM Centre', labelHi: 'STEM सेंटर', included: true },
    ],
  },
  {
    name: 'Pro',
    code: 'pro',
    tagline: 'The complete learning experience',
    taglineHi: 'संपूर्ण सीखने का अनुभव',
    yearlySaving: 'Save 33%',
    yearlySavingHi: '33% बचाएँ',
    popular: true,
    free: false,
    cta: 'Get Started',
    ctaHi: 'शुरू करें',
    href: '/login',
    features: [
      { label: '100 Foxy chats / day', labelHi: '100 Foxy चैट / दिन', included: true },
      { label: 'Unlimited quizzes', labelHi: 'असीमित क्विज़', included: true },
      { label: 'All subjects', labelHi: 'सभी विषय', included: true },
      { label: 'Progress reports', labelHi: 'प्रगति रिपोर्ट', included: true },
      { label: 'Spaced repetition', labelHi: 'स्पेस्ड रिपीटिशन', included: true },
      { label: 'STEM Centre', labelHi: 'STEM सेंटर', included: true },
    ],
  },
  {
    name: 'Unlimited',
    code: 'unlimited',
    tagline: 'No limits, maximum results',
    taglineHi: 'कोई सीमा नहीं, अधिकतम परिणाम',
    yearlySaving: 'Save 33%',
    yearlySavingHi: '33% बचाएँ',
    popular: false,
    free: false,
    cta: 'Get Started',
    ctaHi: 'शुरू करें',
    href: '/login',
    features: [
      { label: 'Unlimited Foxy chats', labelHi: 'असीमित Foxy चैट', included: true },
      { label: 'Unlimited quizzes', labelHi: 'असीमित क्विज़', included: true },
      { label: 'All subjects', labelHi: 'सभी विषय', included: true },
      { label: 'Progress reports', labelHi: 'प्रगति रिपोर्ट', included: true },
      { label: 'Spaced repetition', labelHi: 'स्पेस्ड रिपीटिशन', included: true },
      { label: 'STEM Centre', labelHi: 'STEM सेंटर', included: true },
    ],
  },
];

/* ─── Component ─── */

export function PricingCards() {
  const [annual, setAnnual] = useState(false);
  const { isLoggedIn } = useAuth();
  const { checkout, loading: checkoutLoading } = useCheckout();
  const [successPlan, setSuccessPlan] = useState<string | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<Plan | null>(null);
  const { t } = useLang();

  return (
    <section style={{ padding: '0 16px 64px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 40 }}>
        <span style={{ fontSize: 14, fontWeight: annual ? 500 : 700, color: annual ? 'var(--text-3, #888)' : 'var(--text-1, #1a1a1a)' }}>
          {t('Monthly', 'मासिक')}
        </span>
        <button
          onClick={() => setAnnual(!annual)}
          aria-label={annual ? t('Switch to monthly billing', 'मासिक बिलिंग पर जाएँ') : t('Switch to annual billing', 'वार्षिक बिलिंग पर जाएँ')}
          style={{
            position: 'relative',
            width: 52,
            height: 28,
            borderRadius: 999,
            border: 'none',
            background: annual ? 'var(--orange, #E8581C)' : 'var(--surface-3, #EDE6DC)',
            cursor: 'pointer',
            transition: 'background 0.2s',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 3,
              left: annual ? 27 : 3,
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: '#fff',
              transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            }}
          />
        </button>
        <span style={{ fontSize: 14, fontWeight: annual ? 700 : 500, color: annual ? 'var(--text-1, #1a1a1a)' : 'var(--text-3, #888)' }}>
          {t('Annual', 'वार्षिक')}
        </span>
        {annual && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
            background: 'rgba(22,163,74,0.1)', color: 'var(--green, #16A34A)',
          }}>
            {t('Save 33%', '33% बचाएँ')}
          </span>
        )}
      </div>

      {/* Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 20,
        alignItems: 'start',
      }}>
        {PLANS.map(plan => {
          const isPopular = plan.popular;
          return (
            <div
              key={plan.name}
              style={{
                background: 'var(--surface-1, #FFFFFF)',
                border: isPopular ? '2px solid var(--orange, #E8581C)' : '1px solid var(--border, #e5e0d8)',
                borderRadius: 20,
                padding: 28,
                position: 'relative',
                boxShadow: isPopular ? '0 8px 32px rgba(232,88,28,0.12)' : '0 2px 8px rgba(0,0,0,0.04)',
                transform: isPopular ? 'scale(1.03)' : 'none',
              }}
            >
              {/* Popular Badge */}
              {isPopular && (
                <div style={{
                  position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--orange, #E8581C)', color: '#fff',
                  fontSize: 11, fontWeight: 700, padding: '4px 16px', borderRadius: 999,
                  fontFamily: 'var(--font-display)',
                  whiteSpace: 'nowrap',
                }}>
                  {t('Most Popular', 'सबसे लोकप्रिय')}
                </div>
              )}

              {/* Plan Name & Tagline */}
              <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 4, color: 'var(--text-1, #1a1a1a)' }}>
                {plan.name}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-3, #888)', marginBottom: 16, lineHeight: 1.5 }}>
                {t(plan.tagline, plan.taglineHi)}
              </p>

              {/* Price */}
              <div style={{ marginBottom: 20 }}>
                {(() => {
                  const prices = getPlanPrices(plan.code);
                  return <>
                    <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-1, #1a1a1a)' }}>
                      {plan.free ? t('Free', 'मुफ़्त') : annual ? prices.yearlyPrice : prices.monthlyPrice}
                    </span>
                    {!plan.free && (
                      <span style={{ fontSize: 14, color: 'var(--text-3, #888)', marginLeft: 4 }}>
                        /{annual ? t('yr', 'वर्ष') : t('mo', 'माह')}
                      </span>
                    )}
                    {annual && plan.yearlySaving && (
                      <div style={{
                        fontSize: 12, fontWeight: 700, color: 'var(--green, #16A34A)', marginTop: 4,
                      }}>
                        {t(plan.yearlySaving, plan.yearlySavingHi)}
                      </div>
                    )}
                  </>;
                })()}
              </div>

              {/* CTA Button — checkout for logged-in users, login for guests */}
              {plan.free || !isLoggedIn ? (
                <Link href={plan.href} style={{
                  display: 'block', textAlign: 'center', padding: '12px 20px', borderRadius: 12,
                  fontSize: 14, fontWeight: 700, textDecoration: 'none', fontFamily: 'var(--font-display)',
                  background: isPopular ? 'var(--orange, #E8581C)' : plan.free ? 'var(--surface-2, #F5F0EA)' : 'var(--text-1, #1a1a1a)',
                  color: plan.free ? 'var(--text-1, #1a1a1a)' : '#fff', marginBottom: 24, transition: 'opacity 0.15s',
                }}>
                  {t(plan.cta, plan.ctaHi)}
                </Link>
              ) : (
                <button
                  onClick={() => setConfirmPlan(plan)}
                  disabled={checkoutLoading}
                  style={{
                    display: 'block', width: '100%', textAlign: 'center', padding: '12px 20px', borderRadius: 12,
                    fontSize: 14, fontWeight: 700, border: 'none', cursor: checkoutLoading ? 'wait' : 'pointer',
                    fontFamily: 'var(--font-display)',
                    background: isPopular ? 'var(--orange, #E8581C)' : 'var(--text-1, #1a1a1a)',
                    color: '#fff', marginBottom: 24, transition: 'opacity 0.15s', opacity: checkoutLoading ? 0.6 : 1,
                  }}
                >
                  {successPlan === plan.name.toLowerCase()
                    ? t('Upgraded!', 'अपग्रेड हो गया!')
                    : checkoutLoading
                      ? t('Processing...', 'प्रोसेसिंग...')
                      : t(plan.cta, plan.ctaHi)}
                </button>
              )}

              {/* Feature List */}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plan.features.map(f => (
                  <li key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11,
                      background: f.included ? 'rgba(22,163,74,0.1)' : 'rgba(0,0,0,0.04)',
                      color: f.included ? 'var(--green, #16A34A)' : 'var(--text-3, #888)',
                    }}>
                      {f.included ? '\u2713' : '\u2715'}
                    </span>
                    <span style={{ color: f.included ? 'var(--text-2, #444)' : 'var(--text-3, #888)' }}>
                      {t(f.label, f.labelHi)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Subscription confirmation dialog */}
      <SubscriptionConfirm
        isOpen={!!confirmPlan}
        planName={confirmPlan?.name || ''}
        planCode={confirmPlan?.code || ''}
        priceMonthly={confirmPlan ? getPlanPrices(confirmPlan.code).monthlyPriceNum : 0}
        priceYearly={confirmPlan ? getPlanPrices(confirmPlan.code).yearlyPriceNum : 0}
        billingCycle={annual ? 'yearly' : 'monthly'}
        loading={checkoutLoading}
        onCancel={() => setConfirmPlan(null)}
        onConfirm={() => {
          if (!confirmPlan) return;
          const planCode = confirmPlan.code as 'starter' | 'pro' | 'unlimited';
          checkout({
            planCode,
            billingCycle: annual ? 'yearly' : 'monthly',
            onSuccess: (p) => { setSuccessPlan(p); setConfirmPlan(null); },
            onError: () => setConfirmPlan(null),
          });
        }}
      />
    </section>
  );
}
