'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCheckout } from '@/hooks/useCheckout';
import { useAuth } from '@/lib/AuthContext';

/* ─── Plan Data ─── */

interface Plan {
  name: string;
  tagline: string;
  monthlyPrice: string;
  yearlyPrice: string;
  yearlySaving: string;
  popular: boolean;
  features: { label: string; included: boolean }[];
  cta: string;
  href: string;
  free: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'Explorer',
    tagline: 'Get started with Foxy for free',
    monthlyPrice: 'Free',
    yearlyPrice: 'Free',
    yearlySaving: '',
    popular: false,
    free: true,
    cta: 'Start Free',
    href: '/login',
    features: [
      { label: '5 Foxy chats / day', included: true },
      { label: '5 quizzes / day', included: true },
      { label: '2 subjects', included: true },
      { label: 'Voice tutor', included: false },
      { label: 'Progress reports', included: true },
      { label: 'Spaced repetition', included: true },
      { label: 'Interactive labs', included: false },
    ],
  },
  {
    name: 'Starter',
    tagline: 'More chats, more subjects',
    monthlyPrice: '\u20B9299',
    yearlyPrice: '\u20B92,399',
    yearlySaving: 'Save 33%',
    popular: false,
    free: false,
    cta: 'Get Started',
    href: '/login',
    features: [
      { label: '30 Foxy chats / day', included: true },
      { label: '20 quizzes / day', included: true },
      { label: '4 subjects', included: true },
      { label: 'Voice tutor', included: false },
      { label: 'Progress reports', included: true },
      { label: 'Spaced repetition', included: true },
      { label: 'Interactive labs', included: true },
    ],
  },
  {
    name: 'Pro',
    tagline: 'The complete learning experience',
    monthlyPrice: '\u20B9699',
    yearlyPrice: '\u20B95,599',
    yearlySaving: 'Save 33%',
    popular: true,
    free: false,
    cta: 'Get Started',
    href: '/login',
    features: [
      { label: '100 Foxy chats / day', included: true },
      { label: 'Unlimited quizzes', included: true },
      { label: 'All subjects', included: true },
      { label: 'Voice tutor', included: true },
      { label: 'Progress reports', included: true },
      { label: 'Spaced repetition', included: true },
      { label: 'Interactive labs', included: true },
    ],
  },
  {
    name: 'Unlimited',
    tagline: 'No limits, maximum results',
    monthlyPrice: '\u20B91,499',
    yearlyPrice: '\u20B911,999',
    yearlySaving: 'Save 33%',
    popular: false,
    free: false,
    cta: 'Get Started',
    href: '/login',
    features: [
      { label: 'Unlimited Foxy chats', included: true },
      { label: 'Unlimited quizzes', included: true },
      { label: 'All subjects', included: true },
      { label: 'Voice tutor', included: true },
      { label: 'Progress reports', included: true },
      { label: 'Spaced repetition', included: true },
      { label: 'Interactive labs', included: true },
    ],
  },
];

/* ─── Component ─── */

export function PricingCards() {
  const [annual, setAnnual] = useState(false);
  const { isLoggedIn } = useAuth();
  const { checkout, loading: checkoutLoading } = useCheckout();
  const [successPlan, setSuccessPlan] = useState<string | null>(null);

  return (
    <section style={{ padding: '0 16px 64px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 40 }}>
        <span style={{ fontSize: 14, fontWeight: annual ? 500 : 700, color: annual ? 'var(--text-3, #888)' : 'var(--text-1, #1a1a1a)' }}>
          Monthly
        </span>
        <button
          onClick={() => setAnnual(!annual)}
          aria-label={annual ? 'Switch to monthly billing' : 'Switch to annual billing'}
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
          Annual
        </span>
        {annual && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
            background: 'rgba(22,163,74,0.1)', color: 'var(--green, #16A34A)',
          }}>
            Save 33%
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
                  Most Popular
                </div>
              )}

              {/* Plan Name & Tagline */}
              <h3 style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 4, color: 'var(--text-1, #1a1a1a)' }}>
                {plan.name}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-3, #888)', marginBottom: 16, lineHeight: 1.5 }}>
                {plan.tagline}
              </p>

              {/* Price */}
              <div style={{ marginBottom: 20 }}>
                <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-1, #1a1a1a)' }}>
                  {plan.free ? 'Free' : annual ? plan.yearlyPrice : plan.monthlyPrice}
                </span>
                {!plan.free && (
                  <span style={{ fontSize: 14, color: 'var(--text-3, #888)', marginLeft: 4 }}>
                    /{annual ? 'yr' : 'mo'}
                  </span>
                )}
                {annual && plan.yearlySaving && (
                  <div style={{
                    fontSize: 12, fontWeight: 700, color: 'var(--green, #16A34A)', marginTop: 4,
                  }}>
                    {plan.yearlySaving}
                  </div>
                )}
              </div>

              {/* CTA Button — checkout for logged-in users, login for guests */}
              {plan.free || !isLoggedIn ? (
                <Link href={plan.href} style={{
                  display: 'block', textAlign: 'center', padding: '12px 20px', borderRadius: 12,
                  fontSize: 14, fontWeight: 700, textDecoration: 'none', fontFamily: 'var(--font-display)',
                  background: isPopular ? 'var(--orange, #E8581C)' : plan.free ? 'var(--surface-2, #F5F0EA)' : 'var(--text-1, #1a1a1a)',
                  color: plan.free ? 'var(--text-1, #1a1a1a)' : '#fff', marginBottom: 24, transition: 'opacity 0.15s',
                }}>
                  {plan.cta}
                </Link>
              ) : (
                <button
                  onClick={() => {
                    const planCode = plan.name.toLowerCase() as 'starter' | 'pro' | 'unlimited';
                    checkout({ planCode, billingCycle: annual ? 'yearly' : 'monthly', onSuccess: (p) => setSuccessPlan(p) });
                  }}
                  disabled={checkoutLoading}
                  style={{
                    display: 'block', width: '100%', textAlign: 'center', padding: '12px 20px', borderRadius: 12,
                    fontSize: 14, fontWeight: 700, border: 'none', cursor: checkoutLoading ? 'wait' : 'pointer',
                    fontFamily: 'var(--font-display)',
                    background: isPopular ? 'var(--orange, #E8581C)' : 'var(--text-1, #1a1a1a)',
                    color: '#fff', marginBottom: 24, transition: 'opacity 0.15s', opacity: checkoutLoading ? 0.6 : 1,
                  }}
                >
                  {successPlan === plan.name.toLowerCase() ? '✓ Upgraded!' : checkoutLoading ? 'Processing...' : plan.cta}
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
                      {f.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
