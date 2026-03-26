'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

/**
 * Razorpay Checkout Hook — handles the complete payment flow:
 * 1. Calls /api/payments/create-order to create Razorpay order
 * 2. Opens Razorpay checkout modal
 * 3. On success, calls /api/payments/verify to activate subscription
 * 4. Refreshes auth state to reflect new plan
 *
 * Handles: success, failure, cancel/dismiss, duplicate, network errors.
 * Shows intermediate status messages for user trust.
 */

declare global {
  interface Window {
    Razorpay: any;
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
      // Load Razorpay script
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        const msg = 'Payment gateway could not be loaded. Check your connection and try again.';
        setError(msg);
        setStatus('failed');
        onError?.(msg);
        setLoading(false);
        return;
      }

      // Get fresh access token for API auth
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        const msg = 'Session expired. Please log in again to continue.';
        setError(msg);
        setStatus('failed');
        onError?.(msg);
        setLoading(false);
        return;
      }

      // Create order on backend
      setStatus('creating_order');
      const orderRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ plan_code: planCode, billing_cycle: billingCycle }),
      });

      if (!orderRes.ok) {
        const data = await orderRes.json().catch(() => ({ error: 'Failed to create order' }));
        const msg = data.error || 'Payment initialization failed. Please try again.';
        setError(msg);
        setStatus('failed');
        onError?.(msg);
        setLoading(false);
        return;
      }

      const order = await orderRes.json();
      setStatus('checkout_open');

      // Open Razorpay checkout
      const options = {
        key: order.key,
        amount: order.amount,
        currency: order.currency,
        name: 'Alfanumrik',
        description: `${planCode.charAt(0).toUpperCase() + planCode.slice(1)} Plan (${billingCycle})`,
        order_id: order.order_id,
        prefill: {
          name: student?.name || '',
          email: student?.email || '',
        },
        theme: { color: '#E8581C' },

        // SUCCESS: payment captured by Razorpay
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          setStatus('verifying');
          try {
            const verifyRes = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                plan_code: planCode,
                billing_cycle: billingCycle,
              }),
            });

            const data = await verifyRes.json().catch(() => ({}));

            if (verifyRes.ok && data.success) {
              setStatus('activating');
              await refreshStudent();
              setStatus('success');
              onSuccess?.(planCode);
            } else if (verifyRes.status === 202 || data.status === 'pending_confirmation') {
              // Payment received but access update is pending — still show success
              // Webhook will complete the activation
              await refreshStudent();
              setStatus('success');
              onSuccess?.(planCode);
            } else if (data.status === 'reconciliation_required') {
              // Payment captured but DB update failed — show trust message
              setError(`Payment received (${data.payment_id}). Your plan will be activated shortly.`);
              setStatus('failed');
              onError?.('Payment received but activation pending. Please refresh the page in a few minutes.');
            } else {
              setError(data.error || 'Payment verification failed. Please contact support.');
              setStatus('failed');
              onError?.(data.error || 'Payment verification failed');
            }
          } catch {
            setError('Payment verification failed. If charged, your plan will be activated automatically.');
            setStatus('failed');
            onError?.('Payment verification failed');
          }
          setLoading(false);
        },

        // DISMISS: user closed the modal without paying
        modal: {
          ondismiss: () => {
            setStatus('cancelled');
            setLoading(false);
            // No error — user intentionally closed. Can retry immediately.
          },
        },
      };

      const rzp = new window.Razorpay(options);

      // FAILURE: Razorpay payment failed (card declined, etc.)
      rzp.on('payment.failed', (response: any) => {
        const reason = response?.error?.description || 'Payment failed. Please try again.';
        console.error('Razorpay payment failed:', response?.error?.code, reason);
        setError(reason);
        setStatus('failed');
        setLoading(false);
      });

      rzp.open();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed. Please try again.';
      setError(msg);
      setStatus('failed');
      onError?.(msg);
      setLoading(false);
    }
  }, [student, refreshStudent]);

  return { checkout, loading, status, error };
}
