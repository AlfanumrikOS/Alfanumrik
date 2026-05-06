'use client';

/**
 * Manage Subscription — flag-gated card on /school-admin/billing.
 *
 * Phase 2-C UI follow-up. Calls the POST/PATCH/DELETE handlers shipped on
 * /api/school-admin/subscription in PR #549. Visible only when the flag
 * `ff_school_self_service_billing_v1` is on for the caller (the same flag
 * the route checks server-side, so flag-off here AND flag-off there both
 * close the loop).
 *
 * Lean by design:
 *   - One bilingual component.
 *   - Two inline dialogs (Change plan / Cancel) using <dialog> for
 *     accessibility + focus trapping for free.
 *   - All fetches go through fetch() with the same Bearer pattern the
 *     enclosing page uses.
 *   - On POST success: redirects the browser to Razorpay's hosted page.
 *   - On PATCH success: refreshes parent data via the onChange callback.
 *   - On DELETE success: same.
 */

import { useEffect, useRef, useState } from 'react';
import { Card, Button } from '@/components/ui';

interface SubscriptionState {
  plan: string;
  billing_cycle: 'monthly' | 'yearly';
  seats_purchased: number;
  status: string;
  razorpay_subscription_id: string | null;
  current_period_end: string | null;
}

interface Props {
  schoolId: string;
  /** Active student count for seat-cap UX. Same as the parent's currentSeats.active. */
  seatsUsed: number;
  /** True when ff_school_self_service_billing_v1 evaluated true for this admin. */
  flagOn: boolean;
  isHi: boolean;
  /** Bearer token for the school-admin auth. Pass-through from the parent. */
  authToken: string | null;
  /** Called after a successful PATCH or DELETE so the parent can refetch. */
  onChange: () => void;
}

const PAID_PLANS: Array<{ code: string; nameEn: string; nameHi: string; pricePerSeatInr: number }> = [
  { code: 'starter', nameEn: 'Starter', nameHi: 'स्टार्टर', pricePerSeatInr: 299 },
  { code: 'pro', nameEn: 'Pro', nameHi: 'प्रो', pricePerSeatInr: 699 },
  { code: 'unlimited', nameEn: 'Family / School', nameHi: 'फैमिली / स्कूल', pricePerSeatInr: 1099 },
];

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

export default function ManageSubscriptionSection({
  schoolId,
  seatsUsed,
  flagOn,
  isHi,
  authToken,
  onChange,
}: Props) {
  const changeDialog = useRef<HTMLDialogElement | null>(null);
  const cancelDialog = useRef<HTMLDialogElement | null>(null);

  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [loadingSub, setLoadingSub] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form state (Change plan dialog)
  const [formPlan, setFormPlan] = useState<string>('starter');
  const [formSeats, setFormSeats] = useState<number>(50);

  // Cancel dialog state
  const [cancelImmediate, setCancelImmediate] = useState(false);

  // Load current subscription on mount.
  useEffect(() => {
    if (!flagOn || !authToken) {
      setLoadingSub(false);
      return;
    }
    let cancelled = false;
    setLoadingSub(true);
    fetch('/api/school-admin/subscription', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j) => {
        if (cancelled) return;
        const data = j?.data?.subscription as SubscriptionState | null | undefined;
        setSub(data ?? null);
        if (data) {
          setFormPlan(data.plan && PAID_PLANS.some((p) => p.code === data.plan) ? data.plan : 'starter');
          setFormSeats(Math.max(seatsUsed, data.seats_purchased ?? 50));
        } else {
          setFormSeats(Math.max(seatsUsed, 50));
        }
      })
      .catch(() => {
        if (!cancelled) setSub(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSub(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flagOn, authToken, schoolId, seatsUsed]);

  if (!flagOn) return null;

  const isExistingSub = !!sub;
  const operationLabel = isExistingSub
    ? t(isHi, 'Change plan', 'प्लान बदलें')
    : t(isHi, 'Buy a plan', 'प्लान खरीदें');

  const submitChange = async () => {
    if (!authToken) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (formSeats < seatsUsed) {
        setErrorMsg(
          t(
            isHi,
            `Cannot reduce to ${formSeats} seats — you have ${seatsUsed} active students.`,
            `${formSeats} सीट तक कम नहीं कर सकते — आपके पास ${seatsUsed} सक्रिय छात्र हैं।`,
          ),
        );
        setSubmitting(false);
        return;
      }
      const method = isExistingSub ? 'PATCH' : 'POST';
      const body = isExistingSub
        ? { plan: formPlan, seats: formSeats }
        : { plan: formPlan, billing_cycle: 'monthly' as const, seats: formSeats };
      const res = await fetch('/api/school-admin/subscription', {
        method,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(
          (json?.error as string) ??
            t(isHi, 'Could not update subscription', 'सब्सक्रिप्शन अपडेट नहीं हो सका'),
        );
        return;
      }
      // POST → redirect to Razorpay hosted page; PATCH → refresh in place.
      if (method === 'POST' && (json?.data?.hosted_page_url as string)) {
        window.location.href = json.data.hosted_page_url as string;
        return;
      }
      changeDialog.current?.close();
      onChange();
    } catch {
      setErrorMsg(t(isHi, 'Network error', 'नेटवर्क त्रुटि'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCancel = async () => {
    if (!authToken) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/school-admin/subscription', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cancellation_timing: cancelImmediate ? 'immediate' : 'end_of_cycle',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(
          (json?.error as string) ?? t(isHi, 'Could not cancel', 'रद्द नहीं कर सके'),
        );
        return;
      }
      cancelDialog.current?.close();
      onChange();
    } catch {
      setErrorMsg(t(isHi, 'Network error', 'नेटवर्क त्रुटि'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-label={t(isHi, 'Manage subscription', 'सब्सक्रिप्शन प्रबंधन')}>
      <Card>
        <div className="px-3 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                {t(isHi, 'Manage subscription', 'सब्सक्रिप्शन प्रबंधन')}
              </p>
              {!loadingSub && sub && (
                <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-1)' }}>
                  {sub.plan} · {sub.seats_purchased} {t(isHi, 'seats', 'सीट')} · {sub.status}
                </p>
              )}
              {!loadingSub && !sub && (
                <p className="text-sm text-[var(--text-2)] mt-1">
                  {t(isHi, 'No paid subscription yet.', 'अभी कोई पेड सब्सक्रिप्शन नहीं।')}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => {
                setErrorMsg(null);
                changeDialog.current?.showModal();
              }}
              disabled={loadingSub}
              data-testid="school-billing-change-plan-cta"
            >
              {operationLabel}
            </Button>
            {isExistingSub && sub.status !== 'cancelled' && (
              <Button
                variant="ghost"
                onClick={() => {
                  setErrorMsg(null);
                  setCancelImmediate(false);
                  cancelDialog.current?.showModal();
                }}
                data-testid="school-billing-cancel-cta"
              >
                {t(isHi, 'Cancel subscription', 'सब्सक्रिप्शन रद्द करें')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* ── Change-plan dialog ───────────────────────────────────── */}
      <dialog
        ref={changeDialog}
        className="rounded-2xl p-0 backdrop:bg-black/40"
        style={{ border: '1px solid var(--border)', maxWidth: '420px', width: '92%' }}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            submitChange();
          }}
        >
          <div className="p-5 space-y-4">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
              {operationLabel}
            </h2>

            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-3)' }}>
                {t(isHi, 'Plan', 'प्लान')}
              </span>
              <select
                value={formPlan}
                onChange={(e) => setFormPlan(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}
                data-testid="school-billing-plan-select"
              >
                {PAID_PLANS.map((p) => (
                  <option key={p.code} value={p.code}>
                    {isHi ? p.nameHi : p.nameEn} · ₹{p.pricePerSeatInr}/seat/mo
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-3)' }}>
                {t(isHi, 'Seats', 'सीट')}
              </span>
              <input
                type="number"
                min={Math.max(1, seatsUsed)}
                max={5000}
                value={formSeats}
                onChange={(e) => setFormSeats(Number(e.target.value))}
                className="w-full rounded-xl px-3 py-2.5 text-sm"
                style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}
                data-testid="school-billing-seats-input"
              />
              <span className="text-[11px] text-[var(--text-3)] mt-1 inline-block">
                {t(isHi, 'Active students', 'सक्रिय छात्र')}: {seatsUsed}
              </span>
            </label>

            {errorMsg && (
              <p className="text-xs font-semibold" style={{ color: '#DC2626' }}>{errorMsg}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="text-sm px-3 py-2 rounded-xl"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                onClick={() => changeDialog.current?.close()}
                disabled={submitting}
              >
                {t(isHi, 'Close', 'बंद करें')}
              </button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting
                  ? t(isHi, 'Working…', 'काम चल रहा है…')
                  : isExistingSub
                  ? t(isHi, 'Save', 'सेव करें')
                  : t(isHi, 'Continue to payment', 'भुगतान पर जाएँ')}
              </Button>
            </div>
          </div>
        </form>
      </dialog>

      {/* ── Cancel-subscription dialog ───────────────────────────── */}
      <dialog
        ref={cancelDialog}
        className="rounded-2xl p-0 backdrop:bg-black/40"
        style={{ border: '1px solid var(--border)', maxWidth: '420px', width: '92%' }}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            submitCancel();
          }}
        >
          <div className="p-5 space-y-4">
            <h2 className="text-base font-bold" style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
              {t(isHi, 'Cancel subscription', 'सब्सक्रिप्शन रद्द करें')}
            </h2>

            <p className="text-sm text-[var(--text-2)]">
              {t(
                isHi,
                "By default, your school keeps access until the end of the period you've paid for. Choose 'Cancel immediately' only if compliance requires it.",
                'डिफ़ॉल्ट रूप से, आपके स्कूल की पहुँच भुगतान-अवधि के अंत तक बनी रहती है। केवल अनुपालन कारणों से ही "तुरंत रद्द करें" चुनें।',
              )}
            </p>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cancelImmediate}
                onChange={(e) => setCancelImmediate(e.target.checked)}
                data-testid="school-billing-cancel-immediate-toggle"
              />
              <span>{t(isHi, 'Cancel immediately (end access now)', 'तुरंत रद्द करें (अभी पहुँच समाप्त)')}</span>
            </label>

            {errorMsg && (
              <p className="text-xs font-semibold" style={{ color: '#DC2626' }}>{errorMsg}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="text-sm px-3 py-2 rounded-xl"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                onClick={() => cancelDialog.current?.close()}
                disabled={submitting}
              >
                {t(isHi, 'Keep subscription', 'सब्सक्रिप्शन रखें')}
              </button>
              <Button
                variant="primary"
                type="submit"
                disabled={submitting}
                data-testid="school-billing-cancel-confirm"
              >
                {submitting
                  ? t(isHi, 'Working…', 'काम चल रहा है…')
                  : cancelImmediate
                  ? t(isHi, 'Cancel now', 'अभी रद्द करें')
                  : t(isHi, 'Cancel at period end', 'अवधि के अंत में रद्द करें')}
              </Button>
            </div>
          </div>
        </form>
      </dialog>
    </section>
  );
}
