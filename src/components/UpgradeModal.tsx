'use client';

import { useState } from 'react';
import { useCheckout } from '@/hooks/useCheckout';
import Link from 'next/link';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: string; // 'chat' | 'quiz'
  currentLimit: number;
  onUpgradeSuccess?: () => void;
}

const PLANS = [
  {
    code: 'starter' as const,
    name: 'Starter',
    price: '₹299',
    priceYearly: '₹200',
    chats: 30,
    quizzes: 20,
    color: '#E8581C',
  },
  {
    code: 'pro' as const,
    name: 'Pro',
    price: '₹699',
    priceYearly: '₹467',
    chats: 100,
    quizzes: '∞',
    highlight: true,
    color: '#7C3AED',
  },
  {
    code: 'unlimited' as const,
    name: 'Unlimited',
    price: '₹1,499',
    priceYearly: '₹1,000',
    chats: '∞',
    quizzes: '∞',
    color: '#0891B2',
  },
];

export function UpgradeModal({ isOpen, onClose, feature, currentLimit, onUpgradeSuccess }: UpgradeModalProps) {
  const { checkout, loading, status, error } = useCheckout();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const featureLabel = feature === 'chat' ? 'Foxy chats' : 'quizzes';

  // Status messages for trust
  const statusMessage = status === 'loading_gateway' ? 'Loading payment gateway...'
    : status === 'creating_order' ? 'Creating secure payment...'
    : status === 'verifying' ? 'Payment received, verifying...'
    : status === 'activating' ? 'Verified! Activating your plan...'
    : null;

  if (success) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
        <div className="w-full max-w-sm rounded-2xl p-6 text-center" style={{ background: 'var(--surface-1)' }}>
          <div className="text-4xl mb-3">🎉</div>
          <h3 className="text-lg font-bold mb-2">Upgrade Successful!</h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>Your plan has been upgraded. Enjoy more {featureLabel}!</p>
          <button onClick={() => { setSuccess(false); onClose(); onUpgradeSuccess?.(); }}
            className="w-full py-3 rounded-xl text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #E8581C, #F5A623)' }}>
            Continue Learning
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--surface-1)' }}>
        {/* Header */}
        <div className="text-center mb-4">
          <div className="text-3xl mb-2">🦊</div>
          <h3 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            Daily Limit Reached
          </h3>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            You&apos;ve used all {currentLimit} {featureLabel} for today. Upgrade to keep learning!
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <button onClick={() => setBillingCycle('monthly')}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: billingCycle === 'monthly' ? 'var(--orange)' : 'var(--surface-2)', color: billingCycle === 'monthly' ? '#fff' : 'var(--text-3)' }}>
            Monthly
          </button>
          <button onClick={() => setBillingCycle('yearly')}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: billingCycle === 'yearly' ? 'var(--orange)' : 'var(--surface-2)', color: billingCycle === 'yearly' ? '#fff' : 'var(--text-3)' }}>
            Yearly <span className="text-[10px]">(save 33%)</span>
          </button>
        </div>

        {/* Plans */}
        <div className="space-y-3 mb-4">
          {PLANS.map(plan => (
            <div key={plan.code} className="rounded-xl p-4 flex items-center justify-between"
              style={{ background: plan.highlight ? `${plan.color}08` : 'var(--bg)', border: plan.highlight ? `2px solid ${plan.color}30` : '1px solid var(--border)' }}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{plan.name}</span>
                  {plan.highlight && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: plan.color }}>POPULAR</span>}
                </div>
                <div className="text-lg font-extrabold mt-0.5" style={{ color: plan.color }}>
                  {billingCycle === 'yearly' ? plan.priceYearly : plan.price}<span className="text-xs font-normal" style={{ color: 'var(--text-3)' }}>/mo</span>
                </div>
                {billingCycle === 'yearly' && (
                  <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                    Billed as {plan.code === 'starter' ? '₹2,399' : plan.code === 'pro' ? '₹5,599' : '₹11,999'}/year
                  </div>
                )}
                <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                  {plan.chats} chats · {plan.quizzes} quizzes /day
                </div>
              </div>
              <button
                onClick={() => checkout({
                  planCode: plan.code,
                  billingCycle,
                  onSuccess: () => setSuccess(true),
                })}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white shrink-0"
                style={{ background: loading ? '#ccc' : `linear-gradient(135deg, ${plan.color}, ${plan.color}cc)` }}>
                {loading ? (status === 'verifying' ? 'Verifying...' : status === 'activating' ? 'Activating...' : '...') : 'Upgrade'}
              </button>
            </div>
          ))}
        </div>

        {statusMessage && (
          <div className="text-xs text-center mb-3 flex items-center justify-center gap-2" style={{ color: 'var(--orange)' }}>
            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {statusMessage}
          </div>
        )}
        {error && <p className="text-xs text-center mb-3" style={{ color: '#EF4444' }}>{error}</p>}

        {/* Footer */}
        <div className="flex items-center justify-between">
          <Link href="/pricing" className="text-xs font-semibold" style={{ color: 'var(--orange)' }}>
            Compare plans →
          </Link>
          <button onClick={onClose} className="text-xs font-semibold px-4 py-2 rounded-lg" style={{ color: 'var(--text-3)' }}>
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
