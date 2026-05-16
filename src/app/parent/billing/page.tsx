'use client';

/**
 * /parent/billing — Phase C.4 parent billing surface.
 *
 * Sections:
 *   1. Summary banner (active subs, total monthly spend, alerts)
 *   2. Per-child plan cards (each child + their plan + Upgrade/Cancel CTAs)
 *   3. Payment history (last 12 invoices across all linked children)
 *
 * Cancel/Upgrade flows reuse the existing Razorpay endpoints:
 *   - /api/payments/subscribe  (creates a new subscription / order)
 *   - /api/payments/cancel     (cancels an existing subscription)
 *
 * Schema note: alfanumrik's `student_subscriptions` table is keyed per
 * student, so each linked child has their own subscription row. There is
 * no parent-level "family plan" today — the page aggregates per-child.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

interface ChildBilling {
  student_id: string;
  student_name: string | null;
  grade: string | null;
  plan_code: string;
  plan_name: string;
  status: string;
  billing_cycle: string | null;
  auto_renew: boolean;
  current_period_end: string | null;
  next_billing_at: string | null;
  price_inr: number;
  is_in_grace: boolean;
  is_cancel_scheduled: boolean;
  razorpay_subscription_id: string | null;
}

interface PaymentInvoice {
  id: string;
  student_id: string;
  student_name: string | null;
  amount_inr: number;
  currency: string;
  status: string;
  plan_code: string | null;
  billing_cycle: string | null;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
  created_at: string;
}

interface BillingSummary {
  total_active_subscriptions: number;
  total_monthly_spend_inr: number;
  any_in_grace: boolean;
  any_cancel_scheduled: boolean;
}

interface BillingPayload {
  children: ChildBilling[];
  payment_history: PaymentInvoice[];
  summary: BillingSummary;
}

function formatInr(n: number): string {
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN')}`;
}

function formatDate(iso: string | null, isHi: boolean): string {
  if (!iso) return t(isHi, '—', '—');
  try {
    return new Date(iso).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export default function ParentBillingPage() {
  const router = useRouter();
  const { authUserId, activeRole, isHi } = useAuth();
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const res = await fetch('/api/parent/billing', { headers });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError(t(isHi, 'You must be signed in as a parent to view billing.', 'बिलिंग देखने के लिए आपको अभिभावक के रूप में साइन इन होना चाहिए।'));
          return;
        }
        setError(t(isHi, 'Failed to load billing data. Please try again.', 'बिलिंग डेटा लोड करने में विफल। कृपया पुनः प्रयास करें।'));
        return;
      }
      const json = await res.json();
      if (!json.success) {
        setError(json.error || t(isHi, 'Unknown error', 'अज्ञात त्रुटि'));
        return;
      }
      setPayload(json.data);
    } catch {
      setError(t(isHi, 'Network error. Please check your connection.', 'नेटवर्क त्रुटि। कृपया अपना कनेक्शन जाँचें।'));
    } finally {
      setLoading(false);
    }
  }, [isHi]);

  useEffect(() => {
    // Only guardian-mode parents have a Supabase auth session. Link-code-mode
    // parents don't (they hold an HMAC payload), so they cannot view billing.
    if (!authUserId || activeRole !== 'guardian') {
      setLoading(false);
      setError(t(isHi, 'Billing requires a parent account. Please sign in with your email.', 'बिलिंग के लिए अभिभावक खाते की आवश्यकता है। कृपया अपने ईमेल से साइन इन करें।'));
      return;
    }
    load();
  }, [authUserId, activeRole, isHi, load]);

  const handleUpgrade = () => {
    // The pricing/checkout flow lives at /pricing — reuse it instead of
    // duplicating Razorpay widget integration here.
    router.push('/pricing');
  };

  const handleCancel = async (child: ChildBilling) => {
    if (!child.razorpay_subscription_id) return;
    const confirmMsg = t(
      isHi,
      `Cancel ${child.student_name}'s ${child.plan_name} plan? Access continues until ${formatDate(child.current_period_end, isHi)}.`,
      `${child.student_name} की ${child.plan_name} योजना रद्द करें? ${formatDate(child.current_period_end, isHi)} तक एक्सेस जारी रहेगा।`
    );
    if (!window.confirm(confirmMsg)) return;

    setCancellingId(child.student_id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      // Reuse the existing Razorpay cancel endpoint — no parallel flow.
      // Note: today this endpoint cancels by the *caller's* auth.userId →
      // student lookup. Because parents are guardians (not students), the
      // current endpoint will return 404. This is a known schema-shape
      // limitation flagged in the PR description; the corresponding fix
      // (allow cancel by student_id when caller is the linked guardian)
      // is scoped to a follow-up backend PR. The UI surface is shipped
      // here so the flow is wired end-to-end as soon as the backend lands.
      const res = await fetch('/api/payments/cancel', {
        method: 'POST',
        headers,
        body: JSON.stringify({ immediate: false, student_id: child.student_id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        // TODO(phase-e3): replace alert() with toast/modal
        // eslint-disable-next-line no-restricted-syntax
        window.alert(json.error || t(isHi, 'Cancellation failed.', 'रद्द करना विफल।'));
        return;
      }
      // TODO(phase-e3): replace alert() with toast/modal
      // eslint-disable-next-line no-restricted-syntax
      window.alert(json.message || t(isHi, 'Cancellation scheduled.', 'रद्द करना अनुसूचित।'));
      await load();
    } catch {
      // TODO(phase-e3): replace alert() with toast/modal
      // eslint-disable-next-line no-restricted-syntax
      window.alert(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setCancellingId(null);
    }
  };

  // ─── States ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="animate-pulse">
          <div className="mb-4 h-8 w-48 rounded bg-orange-100" />
          <div className="mb-2 h-4 w-64 rounded bg-orange-50" />
          <div className="mt-6 h-32 rounded-2xl bg-orange-50" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">{t(isHi, 'Billing', 'बिलिंग')}</h1>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
          <p className="text-sm">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            {t(isHi, 'Retry', 'पुनः प्रयास')}
          </button>
        </div>
      </main>
    );
  }

  if (!payload) return null;

  const { children, payment_history, summary } = payload;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8" data-testid="parent-billing-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          {t(isHi, 'Billing', 'बिलिंग')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {t(
            isHi,
            'Manage your subscription, see what each child is on, and review past invoices.',
            'अपनी सदस्यता प्रबंधित करें, देखें कि प्रत्येक बच्चा किस योजना पर है, और पिछले इनवॉइस की समीक्षा करें।'
          )}
        </p>
      </header>

      {/* ─── Summary banner ────────────────────────────────────────────── */}
      <section
        data-testid="billing-summary"
        className="mb-6 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-5 sm:p-6"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {t(isHi, 'Active Subscriptions', 'सक्रिय सदस्यताएँ')}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {summary.total_active_subscriptions}
              <span className="ml-1 text-sm font-normal text-slate-500">
                / {children.length} {t(isHi, 'children', 'बच्चे')}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {t(isHi, 'Monthly Spend', 'मासिक खर्च')}
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {formatInr(summary.total_monthly_spend_inr)}
              <span className="ml-1 text-sm font-normal text-slate-500">
                / {t(isHi, 'month', 'महीना')}
              </span>
            </p>
          </div>
          <div className="flex items-center">
            {summary.any_in_grace ? (
              <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800">
                {t(isHi, 'Payment past due', 'भुगतान बकाया')}
              </span>
            ) : summary.any_cancel_scheduled ? (
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800">
                {t(isHi, 'Cancellation scheduled', 'रद्दीकरण अनुसूचित')}
              </span>
            ) : summary.total_active_subscriptions > 0 ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                {t(isHi, 'All plans active', 'सभी योजनाएँ सक्रिय')}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {t(isHi, 'Free tier', 'फ्री टियर')}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ─── Per-child plan cards ──────────────────────────────────────── */}
      <section className="mb-8" data-testid="children-covered">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          {t(isHi, 'Children Covered', 'कवर किए गए बच्चे')}
        </h2>

        {children.length === 0 ? (
          <div
            data-testid="no-children-state"
            className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"
          >
            <p className="text-sm text-slate-500">
              {t(
                isHi,
                'No children linked yet. Link a child first to manage their subscription.',
                'अभी तक कोई बच्चा नहीं जुड़ा है। उनकी सदस्यता प्रबंधित करने के लिए पहले एक बच्चे को जोड़ें।'
              )}
            </p>
            <button
              onClick={() => router.push('/parent/children')}
              className="mt-4 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
            >
              {t(isHi, 'Link a Child', 'बच्चा जोड़ें')}
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {children.map((child) => {
              const isFree = child.plan_code === 'free';
              const daysLeft = daysUntil(child.current_period_end);
              const endingSoon =
                child.is_cancel_scheduled && daysLeft != null && daysLeft <= 30;

              return (
                <li
                  key={child.student_id}
                  data-testid={`child-billing-${child.student_id}`}
                  className="rounded-2xl border border-orange-100 bg-white p-4 sm:p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-slate-900">
                          {child.student_name || t(isHi, 'Unnamed Child', 'अनाम बच्चा')}
                        </h3>
                        {child.grade && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {t(isHi, `Grade ${child.grade}`, `कक्षा ${child.grade}`)}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            isFree
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-orange-100 text-orange-800'
                          }`}
                        >
                          {child.plan_name}
                        </span>
                        {child.billing_cycle && !isFree && (
                          <span className="text-xs text-slate-500">
                            {child.billing_cycle === 'yearly'
                              ? t(isHi, 'Annual', 'वार्षिक')
                              : t(isHi, 'Monthly', 'मासिक')}
                            {' · '}
                            {formatInr(child.price_inr)}
                          </span>
                        )}
                      </div>

                      {!isFree && child.current_period_end && (
                        <p className="mt-2 text-xs text-slate-500">
                          {child.is_cancel_scheduled
                            ? t(
                                isHi,
                                `Access ends on ${formatDate(child.current_period_end, isHi)}`,
                                `${formatDate(child.current_period_end, isHi)} को एक्सेस समाप्त होगा`
                              )
                            : t(
                                isHi,
                                `Next billing: ${formatDate(child.next_billing_at, isHi)}`,
                                `अगली बिलिंग: ${formatDate(child.next_billing_at, isHi)}`
                              )}
                        </p>
                      )}

                      {child.is_in_grace && (
                        <p
                          data-testid={`grace-warning-${child.student_id}`}
                          className="mt-2 rounded-md bg-yellow-50 px-3 py-1.5 text-xs font-medium text-yellow-800"
                        >
                          {t(
                            isHi,
                            'Payment failed — please update your card to keep access.',
                            'भुगतान विफल हुआ — एक्सेस बनाए रखने के लिए कृपया अपना कार्ड अपडेट करें।'
                          )}
                        </p>
                      )}

                      {endingSoon && (
                        <p
                          data-testid={`ending-warning-${child.student_id}`}
                          className="mt-2 rounded-md bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-800"
                        >
                          {t(
                            isHi,
                            `Subscription ending in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
                            `${daysLeft} दिन में सदस्यता समाप्त हो रही है।`
                          )}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 sm:flex-col sm:items-end">
                      <button
                        onClick={() =>
                          router.push(`/parent?child=${encodeURIComponent(child.student_id)}`)
                        }
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {t(isHi, 'View progress', 'प्रगति देखें')}
                      </button>
                      {isFree ? (
                        <button
                          onClick={handleUpgrade}
                          data-testid={`upgrade-${child.student_id}`}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          {t(isHi, 'Upgrade', 'अपग्रेड')}
                        </button>
                      ) : (
                        !child.is_cancel_scheduled && (
                          <button
                            onClick={() => handleCancel(child)}
                            disabled={cancellingId === child.student_id}
                            data-testid={`cancel-${child.student_id}`}
                            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {cancellingId === child.student_id
                              ? t(isHi, 'Cancelling…', 'रद्द हो रहा है…')
                              : t(isHi, 'Cancel', 'रद्द करें')}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─── Payment History ───────────────────────────────────────────── */}
      <section data-testid="payment-history">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">
          {t(isHi, 'Payment History', 'भुगतान इतिहास')}
        </h2>

        {payment_history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
            <p className="text-sm text-slate-500">
              {t(
                isHi,
                'No payments yet. Past invoices will appear here.',
                'अभी तक कोई भुगतान नहीं। पिछले इनवॉइस यहाँ दिखाई देंगे।'
              )}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-orange-100 bg-white">
            <table className="min-w-full divide-y divide-orange-100 text-sm">
              <thead className="bg-orange-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t(isHi, 'Date', 'तारीख')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t(isHi, 'Child', 'बच्चा')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t(isHi, 'Plan', 'योजना')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t(isHi, 'Amount', 'राशि')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {t(isHi, 'Status', 'स्थिति')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-50">
                {payment_history.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 text-slate-700">{formatDate(p.created_at, isHi)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {p.student_name || t(isHi, '—', '—')}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {p.plan_code || t(isHi, '—', '—')}
                      {p.billing_cycle && (
                        <span className="ml-1 text-xs text-slate-400">({p.billing_cycle})</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {formatInr(p.amount_inr)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === 'captured' || p.status === 'paid' || p.status === 'success'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.status === 'failed'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
