'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

/**
 * Razorpay Checkout Hook — unified for recurring + one-time flows.
 *
 * Monthly plans → Razorpay Subscription (recurring)
 * Yearly plans  → Razorpay Order (one-time)
 *
 * Client sends only plan_code + billing_cycle — never amounts.
 */

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, handler: (response: Record<string, unknown>) => void) => void };
  }
}

interface CheckoutOptions {
  planCode: 'starter' | 'pro' | 'unlimited';
  billingCycle: 'monthly' | 'yearly';
  onSuccess?: (plan: string) => void;
  onError?: (error: string) => void;
}

export type CheckoutStatus =
  | 'idle'
  | 'loading_gateway'
  | 'creating_order'
  | 'checkout_open'
  | 'verifying'
  | 'activating'
  | 'success'
  | 'failed'
  | 'cancelled';

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function useCheckout() {
  const { student, refreshStudent } = useAuth();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<CheckoutStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const checkout = useCallback(async ({ planCode, billingCycle, onSuccess, onError }: CheckoutOptions) => {
    setLoading(true);
    setError(null);
    setStatus('loading_gateway');

    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        fail('Payment gateway could not be loaded. Check your connection and try again.', onError);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        fail('Session expired. Please log in again to continue.', onError);
        return;
      }

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      };

      // Call unified subscribe endpoint
      setStatus('creating_order');
      const res = await fetch('/api/payments/subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({ plan_code: planCode, billing_cycle: billingCycle }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Payment initialization failed' }));
        fail(data.error || 'Payment initialization failed. Please try again.', onError);
        return;
      }

      const data = await res.json();
      setStatus('checkout_open');

      if (data.type === 'subscription') {
        // ─── Monthly recurring: Razorpay Subscription checkout ───
        openSubscriptionCheckout({
          subscriptionId: data.subscription_id,
          key: data.key,
          planCode,
          billingCycle,
          accessToken,
          headers,
          onSuccess,
          onError,
        });
      } else {
        // ─── Yearly one-time: Razorpay Order checkout ────────────
        openOrderCheckout({
          orderId: data.order_id,
          amount: data.amount,
          currency: data.currency,
          key: data.key,
          planCode,
          billingCycle,
          accessToken,
          headers,
          onSuccess,
          onError,
        });
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Payment failed. Please try again.', onError);
    }

    function fail(msg: string, onErr?: (s: string) => void) {
      setError(msg);
      setStatus('failed');
      onErr?.(msg);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openOrderCheckout and openSubscriptionCheckout are stable functions defined in this hook's closure
  }, [student, refreshStudent]);

  // ─── Subscription checkout (monthly recurring) ─────────────

  function openSubscriptionCheckout(params: {
    subscriptionId: string;
    key: string;
    planCode: string;
    billingCycle: string;
    accessToken: string;
    headers: Record<string, string>;
    onSuccess?: (plan: string) => void;
    onError?: (error: string) => void;
  }) {
    const options = {
      key: params.key,
      subscription_id: params.subscriptionId,
      name: 'Alfanumrik',
      description: `${capitalize(params.planCode)} Plan — Monthly`,
      prefill: {
        name: student?.name || '',
        email: student?.email || '',
      },
      theme: { color: '#E8581C' },

      handler: async (response: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
        setStatus('verifying');
        try {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: params.headers,
            body: JSON.stringify({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_signature: response.razorpay_signature,
              plan_code: params.planCode,
              billing_cycle: 'monthly',
              type: 'subscription',
            }),
          });

          const data = await verifyRes.json().catch(() => ({}));
          if (verifyRes.ok && data.success) {
            setStatus('activating');
            await refreshStudent();
            setStatus('success');
            params.onSuccess?.(params.planCode);
          } else {
            setError(data.error || 'Verification failed. Your payment is safe — plan will activate shortly.');
            setStatus('failed');
          }
        } catch {
          setError('Verification failed. If charged, your plan will activate automatically.');
          setStatus('failed');
        }
        setLoading(false);
      },

      modal: {
        ondismiss: () => {
          setStatus('cancelled');
          setLoading(false);
        },
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', (response: Record<string, unknown>) => {
      const errorObj = response?.error as Record<string, unknown> | undefined;
      setError((errorObj?.description as string) || 'Payment failed. Please try again.');
      setStatus('failed');
      setLoading(false);
    });
    rzp.open();
  }

  // ─── Order checkout (yearly one-time) ──────────────────────

  function openOrderCheckout(params: {
    orderId: string;
    amount: number;
    currency: string;
    key: string;
    planCode: string;
    billingCycle: string;
    accessToken: string;
    headers: Record<string, string>;
    onSuccess?: (plan: string) => void;
    onError?: (error: string) => void;
  }) {
    const options = {
      key: params.key,
      amount: params.amount,
      currency: params.currency,
      name: 'Alfanumrik',
      description: `${capitalize(params.planCode)} Plan — Yearly`,
      order_id: params.orderId,
      prefill: {
        name: student?.name || '',
        email: student?.email || '',
      },
      theme: { color: '#E8581C' },

      handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        setStatus('verifying');
        try {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: params.headers,
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              plan_code: params.planCode,
              billing_cycle: 'yearly',
              type: 'order',
            }),
          });

          const data = await verifyRes.json().catch(() => ({}));
          if (verifyRes.ok && data.success) {
            setStatus('activating');
            await refreshStudent();
            setStatus('success');
            params.onSuccess?.(params.planCode);
          } else if (verifyRes.status === 202 || data.status === 'pending_confirmation') {
            await refreshStudent();
            setStatus('success');
            params.onSuccess?.(params.planCode);
          } else {
            setError(data.error || 'Payment verification failed. Please contact support.');
            setStatus('failed');
          }
        } catch {
          setError('Verification failed. If charged, your plan will activate automatically.');
          setStatus('failed');
        }
        setLoading(false);
      },

      modal: {
        ondismiss: () => {
          setStatus('cancelled');
          setLoading(false);
        },
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', (response: Record<string, unknown>) => {
      const errorObj = response?.error as Record<string, unknown> | undefined;
      setError((errorObj?.description as string) || 'Payment failed. Please try again.');
      setStatus('failed');
      setLoading(false);
    });
    rzp.open();
  }

  return { checkout, loading, status, error };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
