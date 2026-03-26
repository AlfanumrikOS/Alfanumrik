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
  const [error, setError] = useState<string | null>(null);

  const checkout = useCallback(async ({ planCode, billingCycle, onSuccess, onError }: CheckoutOptions) => {
    setLoading(true);
    setError(null);

    try {
      // Load Razorpay script
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        const msg = 'Payment gateway could not be loaded. Please try again.';
        setError(msg);
        onError?.(msg);
        setLoading(false);
        return;
      }

      // Get fresh access token for API auth
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        const msg = 'Please log in again to continue.';
        setError(msg);
        onError?.(msg);
        setLoading(false);
        return;
      }

      // Create order on backend
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
        const msg = data.error || 'Payment initialization failed';
        setError(msg);
        onError?.(msg);
        setLoading(false);
        return;
      }

      const order = await orderRes.json();

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
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          // Verify payment on backend
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

            if (verifyRes.ok) {
              // Refresh auth state to reflect new plan
              await refreshStudent();
              onSuccess?.(planCode);
            } else {
              const data = await verifyRes.json().catch(() => ({ error: 'Verification failed' }));
              setError(data.error || 'Payment verification failed');
              onError?.(data.error || 'Payment verification failed');
            }
          } catch {
            setError('Payment verification failed. Contact support.');
            onError?.('Payment verification failed');
          }
          setLoading(false);
        },
        modal: {
          ondismiss: () => {
            setLoading(false);
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed';
      setError(msg);
      onError?.(msg);
      setLoading(false);
    }
  }, [student, refreshStudent]);

  return { checkout, loading, error };
}
