'use client';

import { useState } from 'react';

interface SubscriptionConfirmProps {
  isOpen: boolean;
  planName: string;
  planCode: string;
  priceMonthly: number;
  priceYearly: number;
  billingCycle: 'monthly' | 'yearly';
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function SubscriptionConfirm({
  isOpen, planName, planCode, priceMonthly, priceYearly,
  billingCycle, onConfirm, onCancel, loading,
}: SubscriptionConfirmProps) {
  if (!isOpen) return null;

  const isMonthly = billingCycle === 'monthly';
  const price = isMonthly ? priceMonthly : priceYearly;

  return (
    <div style={overlay}>
      <div style={modal}>
        {/* Header */}
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, fontFamily: 'var(--font-display)' }}>
          Confirm Your {isMonthly ? 'Subscription' : 'Purchase'}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-3, #888)', marginBottom: 20 }}>
          Review your plan before proceeding to payment.
        </p>

        {/* Plan Summary */}
        <div style={summaryBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700 }}>{planName} Plan</p>
              <p style={{ fontSize: 12, color: 'var(--text-3, #888)', marginTop: 2 }}>
                {isMonthly ? 'Monthly subscription' : 'One-time yearly payment'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 22, fontWeight: 800 }}>₹{price.toLocaleString('en-IN')}</p>
              <p style={{ fontSize: 11, color: 'var(--text-3, #888)' }}>
                {isMonthly ? '/month' : '/year'}
              </p>
            </div>
          </div>
        </div>

        {/* Billing Details */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isMonthly ? (
            <>
              <BillingRow icon="🔄" text={`₹${priceMonthly.toLocaleString('en-IN')} will be charged every month`} />
              <BillingRow icon="📅" text="Auto-renews monthly until you cancel" />
              <BillingRow icon="🛡️" text="Cancel anytime from the Billing page" />
              <BillingRow icon="⚡" text="Access starts immediately after payment" />
            </>
          ) : (
            <>
              <BillingRow icon="📅" text={`One-time payment of ₹${priceYearly.toLocaleString('en-IN')}`} />
              <BillingRow icon="🎉" text="Full year of access — no auto-renewal" />
              <BillingRow icon="⚡" text="Access starts immediately after payment" />
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={loading} style={cancelBtn}>
            Go Back
          </button>
          <button onClick={onConfirm} disabled={loading} style={confirmBtn}>
            {loading ? 'Opening Payment...' : isMonthly ? 'Subscribe Now' : 'Pay Now'}
          </button>
        </div>

        {/* Footer */}
        <p style={{ fontSize: 10, color: 'var(--text-3, #888)', marginTop: 12, textAlign: 'center', lineHeight: 1.5 }}>
          Powered by Razorpay. Payments are secure and encrypted.
          {isMonthly && ' You can cancel your subscription at any time from Settings > Billing.'}
        </p>
      </div>
    </div>
  );
}

function BillingRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 13, color: 'var(--text-2, #444)' }}>{text}</span>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 90,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.5)', padding: 16,
};

const modal: React.CSSProperties = {
  background: 'var(--surface-1, #fff)', borderRadius: 20, padding: 24,
  maxWidth: 420, width: '100%',
  boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
};

const summaryBox: React.CSSProperties = {
  background: 'var(--bg, #FBF8F4)', border: '1px solid var(--border, #e5e0d8)',
  borderRadius: 14, padding: 16,
};

const confirmBtn: React.CSSProperties = {
  flex: 1, padding: '13px 20px', borderRadius: 12, border: 'none',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
  background: 'var(--orange, #E8581C)', color: '#fff',
  fontFamily: 'var(--font-display)',
};

const cancelBtn: React.CSSProperties = {
  padding: '13px 20px', borderRadius: 12,
  border: '1px solid var(--border, #e5e0d8)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  background: 'transparent', color: 'var(--text-2, #444)',
};
