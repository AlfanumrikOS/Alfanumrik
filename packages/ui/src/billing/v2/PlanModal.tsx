'use client';

/**
 * PlanModal — screen 15 "Plan" (`/plan`, presented as a MODAL, `ff_plan_v2`).
 *
 * PRESENTATIONAL. Fetches nothing itself — every value is a prop, matching the
 * convention established this session by ProfileScreen.tsx (screen 16) and
 * SetupFlow.tsx (screen 01). The host page owns the feature-flag gate, auth,
 * and every data read (student plan, usage, the minor signal). Per SCREENS.md
 * this is explicitly "a modal over any tab, never a destination" — there is
 * deliberately no `apps/host/src/app/plan/page.tsx` in this change; wiring the
 * trigger point (which tab opens it, and how `/plan` deep-links to it) is a
 * frontend concern for a follow-up, not built here.
 *
 * House design system only: CSS custom properties (--orange, --surface-*,
 * --text-*, --border, --font-display/--font-body), matching
 * packages/ui/src/today/v2/TodayHomeV2.tsx and
 * packages/ui/src/profile/v2/ProfileScreen.tsx. No third token system (the
 * handoff's tokens/student-v2.ts and primitives/student-v2.tsx are explicitly
 * NOT used here — a design-system decision already made this session).
 *
 * ── Pricing (non-negotiable: byte-identical UI/backend/Razorpay amount) ──
 *
 * Every ₹ figure rendered here is read directly from `@alfanumrik/lib/plans`
 * (`PLANS`, `PRICING`, `formatINR`, `yearlyPerMonth`, `normalizePlanCode`) —
 * the SAME single source of truth `UpgradeModal.tsx` already renders from, and
 * the SAME literal `/api/payments/create-order` mirrors in paisa via
 * `CONSUMER_PRICING_PAISA` (`@alfanumrik/lib/pricing`, which itself re-exports
 * `plans.ts::PRICING` rather than re-declaring it — see that module's header).
 * This component declares NO price literal of its own anywhere.
 *
 * ── Checkout (unchanged order-creation path) ──
 *
 * The "Upgrade" CTA reuses `useCheckout()` (`@alfanumrik/lib/hooks/useCheckout`)
 * completely unchanged — the exact hook `UpgradeModal.tsx` already uses, which
 * calls `POST /api/payments/subscribe` (monthly → Razorpay Subscription,
 * yearly → Razorpay Order) and never sends an amount, only `plan_code` +
 * `billing_cycle`. This file does not touch, wrap, or duplicate any payment
 * route, the Razorpay integration, or order-creation logic — it is a new way
 * to LAUNCH the identical existing call. The confirm step reuses
 * `SubscriptionConfirm` unchanged for the same reason.
 *
 * ── Reset date (leads the modal, per SCREENS.md 15) ──
 *
 * "A student who can't pay still needs to know when quizzes come back." The
 * `usage` prop is expected to be populated by the host page from the EXISTING
 * `GET /api/usage/daily` route (read-through to `get_plan_limit()` +
 * `student_daily_usage`, the same authority `check_and_record_usage()`
 * enforces against — see that route's header for why it is the only safe
 * source of a daily cap/count pair). This component invents no new quota
 * arithmetic; `limit`/`count`/`remaining`/`allowed` per feature are passed
 * straight through.
 *
 * The "when" of the reset is a different question, and there is genuinely no
 * existing field for it to read: `usage_date` is a plain `CURRENT_DATE`
 * bucket with no stored reset timestamp anywhere in the schema, and no route
 * returns one (`get_student_usage()` / `get_plan_limit()` — read in full for
 * this change — return `used`/`limit` only). The DB session's timezone is
 * also not verifiable from source (no `SET timezone` pinned for this RPC
 * path), so asserting "resets at 12:00 AM IST" would be a guess this
 * component is not willing to make. Instead `nextDailyReset()` below computes
 * the caller's OWN next local midnight (from `now`, which defaults to
 * `new Date()` and is only ever overridden by a test) — the honest thing this
 * screen can say is "come back after your next midnight", not a specific
 * server-anchored clock time it cannot verify.
 *
 * ── Under-18 / DPDP (see the long note above `isMinor` below — READ IT) ──
 *
 * This does NOT block the purchase CTA. That is a deliberate, documented
 * choice, not an oversight — see the prop doc.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Skeleton, EmptyState, Button } from '@alfanumrik/ui/ui';
import { SubscriptionConfirm } from '@alfanumrik/ui/SubscriptionConfirm';
import { useCheckout } from '@alfanumrik/lib/hooks/useCheckout';
import { PLANS, PRICING, formatINR, yearlyPerMonth, normalizePlanCode } from '@alfanumrik/lib/plans';
import { isUnlimitedUsage } from '@alfanumrik/lib/usage-sentinel';

export type PlanModalFeature = 'quiz' | 'foxy_chat';

/** Mirrors the `data` shape of `GET /api/usage/daily` — pass it straight
 *  through, do not re-derive it. */
export interface PlanModalUsageEntry {
  feature: PlanModalFeature;
  limit: number;
  count: number;
  remaining: number;
  allowed: boolean;
}

/** The three paid tiers a student can move to. 'free' is deliberately
 *  excluded — `/api/payments/subscribe` itself rejects `plan_code: 'free'`
 *  ("Cannot subscribe to the free plan"), matching `UpgradeModal.tsx`. */
const UPGRADE_TIERS = ['starter', 'pro', 'unlimited'] as const;
type UpgradeTier = (typeof UPGRADE_TIERS)[number];

export interface PlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  isHi: boolean;
  /** True while the host page is still resolving plan/usage data. */
  loading: boolean;
  /** True when the host page's read failed. */
  error: boolean;
  onRetry: () => void;
  /** `students.subscription_plan` — may be null (falls back to 'free' display). */
  currentPlanCode: string | null;
  /** One entry per feature the host page fetched from `GET /api/usage/daily`.
   *  An empty array is a valid state (fetch unavailable) — the reset banner
   *  degrades to a generic "resets tonight" message with no counts. */
  usage: PlanModalUsageEntry[];
  /**
   * The signup-time minor signal — read via `getMinorSignal()`
   * (`packages/lib/src/onboarding/use-setup.ts`), the SAME `is_minor` /
   * `parent_consent_email` pair `AuthScreen.tsx` writes at signup and
   * `SetupFlow.tsx` (screen 01) already surfaces. NOT re-derived here.
   *
   * ── Why this does not block the purchase CTA (read before changing) ──
   *
   * SCREENS.md states "under-18 requires parent approval before charge —
   * same DPDP gate concept as screens 01/16." Before wiring anything, the
   * ACTUAL existing payment surface was read end-to-end looking for that
   * gate: `apps/host/src/app/api/payments/subscribe/route.ts`,
   * `create-order/route.ts`, `verify/route.ts`, `webhook/route.ts`,
   * `packages/lib/src/hooks/useCheckout.ts`, `packages/ui/src/UpgradeModal.tsx`,
   * and `packages/ui/src/SubscriptionConfirm.tsx`. NONE of them check
   * `is_minor`, `parental_consent`, or any parent-approval flag before
   * creating a Razorpay subscription/order. `CONSENT_SCOPES` in
   * `packages/lib/src/dpdp/consent.ts` has no `payment`/`billing` scope to
   * enforce against even if a route wanted to. Today, literally, a
   * self-attested-minor student CAN complete checkout via `UpgradeModal`
   * with zero parent gate — there is no existing mechanism for this
   * component to "match".
   *
   * The one precedent for this exact tension is `SetupFlow.tsx` (screen 01),
   * which faced the identical spec-vs-reality gap for onboarding and
   * resolved it the same way this file does: build the honest signal as a
   * non-blocking surface, document the gap loudly, and flag it as an open
   * product/legal question rather than inventing new enforcement logic on a
   * compliance-sensitive surface. Inventing a client-side `if (isMinor) block
   * checkout` here would be actively worse than doing nothing: it would (a)
   * not actually be enforced (a client check is trivially bypassable and the
   * server has no matching gate to back it up), and (b) create a false
   * impression that this surface is DPDP-compliant for charges when it is
   * not. Silently doing nothing at all would be worse too — hence the
   * non-blocking banner. See the "Deferred" note in this change's report:
   * closing this gap for real (a `payment` consent scope + a server-side
   * check in `subscribe`/`create-order`) is an architect + backend + ops +
   * legal decision, not a presentational-component decision.
   */
  isMinor: boolean;
  /** Parent/guardian email captured at signup, if any — display only. */
  parentConsentEmail: string | null;
  pricingHref: string;
  onUpgradeSuccess?: (planCode: string) => void;
  /** Injection point for tests only. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * The caller's own next local midnight. Deliberately NOT UTC-forced and NOT
 * IST-forced — see the file header for why guessing the DB session timezone
 * would be dishonest. For a student physically in India this IS effectively
 * IST midnight (their device's local clock), without this component having
 * to assert a server-side fact it cannot verify.
 */
export function nextDailyReset(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}

/** "in 3h 20m" / "in 45m" / "resetting now" — always non-negative. */
export function formatResetCountdown(now: Date, resetAt: Date, isHi: boolean): string {
  const totalMinutes = Math.max(0, Math.round((resetAt.getTime() - now.getTime()) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0 && minutes <= 0) return isHi ? 'अभी रीसेट हो रहा है' : 'resetting now';
  if (hours <= 0) return isHi ? `${minutes} मिनट में` : `in ${minutes}m`;
  if (minutes <= 0) return isHi ? `${hours} घंटे में` : `in ${hours}h`;
  return isHi ? `${hours} घं ${minutes} मि में` : `in ${hours}h ${minutes}m`;
}

/** "12:00 AM" style clock string for the reset instant, in the browser's own locale/zone. */
export function formatResetClock(resetAt: Date, isHi: boolean): string {
  return resetAt.toLocaleTimeString(isHi ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' });
}

const FEATURE_LABEL: Record<PlanModalFeature, { en: string; hi: string }> = {
  quiz: { en: 'Quizzes', hi: 'क्विज़' },
  foxy_chat: { en: 'Foxy chats', hi: 'फॉक्सी चैट' },
};

export default function PlanModal({
  isOpen,
  onClose,
  isHi,
  loading,
  error,
  onRetry,
  currentPlanCode,
  usage,
  isMinor,
  parentConsentEmail,
  pricingHref,
  onUpgradeSuccess,
  now,
}: PlanModalProps) {
  const { checkout, loading: checkingOut, status, error: checkoutError } = useCheckout();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [confirmTier, setConfirmTier] = useState<UpgradeTier | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clock = useMemo(() => now ?? new Date(), [now]);
  const resetAt = useMemo(() => nextDailyReset(clock), [clock]);

  const normalizedCurrent = normalizePlanCode(currentPlanCode);

  if (!isOpen) return null;

  const statusMessage =
    status === 'loading_gateway' ? (isHi ? 'भुगतान गेटवे लोड हो रहा है...' : 'Loading payment gateway...')
      : status === 'creating_order' ? (isHi ? 'सुरक्षित भुगतान बन रहा है...' : 'Creating secure payment...')
      : status === 'verifying' ? (isHi ? 'भुगतान मिला, सत्यापित हो रहा है...' : 'Payment received, verifying...')
      : status === 'activating' ? (isHi ? 'सत्यापित! प्लान सक्रिय हो रहा है...' : 'Verified! Activating your plan...')
      : null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      data-testid="plan-modal"
    >
      <div
        className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--surface-1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3
            className="text-lg font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
          >
            {isHi ? 'प्लान' : 'Plan'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={isHi ? 'बंद करें' : 'Close'}
            className="rounded-full flex items-center justify-center"
            style={{ width: 32, height: 32, background: 'var(--surface-2)', color: 'var(--text-3)' }}
            data-testid="plan-modal-close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div data-testid="plan-modal-loading">
            <Skeleton height={80} rounded="rounded-2xl" className="mb-4" />
            <Skeleton height={220} rounded="rounded-2xl" />
          </div>
        )}

        {!loading && error && (
          <div data-testid="plan-modal-error">
            <EmptyState
              icon="😕"
              title={isHi ? 'अभी लोड नहीं हो पाया' : "Couldn't load this right now"}
              description={isHi ? 'थोड़ी देर में फिर कोशिश करें।' : 'Please try again in a moment.'}
              action={
                <Button variant="soft" onClick={onRetry}>
                  {isHi ? 'फिर कोशिश करें' : 'Retry'}
                </Button>
              }
            />
          </div>
        )}

        {!loading && !error && success && (
          <div className="text-center py-6" data-testid="plan-modal-success">
            <div className="text-4xl mb-3">🎉</div>
            <h4 className="text-lg font-bold mb-2" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'अपग्रेड सफल!' : 'Upgrade Successful!'}
            </h4>
            <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
              {isHi ? 'आपका प्लान अपग्रेड हो गया है।' : 'Your plan has been upgraded.'}
            </p>
            <button
              type="button"
              onClick={() => {
                const plan = success;
                setSuccess(null);
                onClose();
                if (plan) onUpgradeSuccess?.(plan);
              }}
              className="w-full py-3 rounded-xl text-sm font-bold text-foreground"
              style={{ background: 'linear-gradient(135deg, var(--orange), #F5A623)' }}
              data-testid="plan-modal-continue"
            >
              {isHi ? 'सीखना जारी रखें' : 'Continue Learning'}
            </button>
          </div>
        )}

        {!loading && !error && !success && (
          <>
            {/* ── Reset date — leads the modal (SCREENS.md 15) ── */}
            <section
              className="rounded-xl p-4 mb-4"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              data-testid="plan-modal-reset"
            >
              <p className="text-[11px] font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
                {isHi ? 'आज की सीमा' : "Today's limits"}
              </p>
              {usage.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-2)' }}>
                  {isHi
                    ? `आपकी दैनिक सीमाएँ आपकी अगली मध्यरात्रि (${formatResetClock(resetAt, isHi)}) पर रीसेट होती हैं।`
                    : `Your daily limits reset at your next midnight (${formatResetClock(resetAt, isHi)}).`}
                </p>
              ) : (
                <div className="space-y-2">
                  {usage.map((entry) => {
                    const label = isHi ? FEATURE_LABEL[entry.feature].hi : FEATURE_LABEL[entry.feature].en;
                    const unlimited = isUnlimitedUsage(entry.limit);
                    return (
                      <div key={entry.feature} className="flex items-center justify-between text-sm" data-testid={`plan-modal-usage-${entry.feature}`}>
                        <span style={{ color: 'var(--text-2)' }}>{label}</span>
                        {unlimited ? (
                          <span className="font-bold" style={{ color: 'var(--green)' }}>
                            {isHi ? 'असीमित' : 'Unlimited'}
                          </span>
                        ) : (
                          <span className="font-bold" style={{ color: entry.allowed ? 'var(--text-1)' : '#DC2626' }}>
                            {entry.count}/{entry.limit}
                            {!entry.allowed && (
                              <span className="font-normal ml-1" style={{ color: 'var(--text-3)' }}>
                                · {isHi ? 'फिर से' : 'back'} {formatResetCountdown(clock, resetAt, isHi)}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── Under-18 advisory (non-blocking — see isMinor prop doc) ── */}
            {isMinor && (
              <div
                className="rounded-xl p-3 mb-4 text-xs leading-relaxed"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                data-testid="plan-modal-minor-advisory"
              >
                {isHi
                  ? `यह खाता 18 वर्ष से कम आयु के लिए बनाया गया है। खरीदने से पहले कृपया अपने माता-पिता/अभिभावक${parentConsentEmail ? ` (${parentConsentEmail})` : ''} से बात करें।`
                  : `This account was set up for a student under 18. Please involve your parent/guardian${parentConsentEmail ? ` (${parentConsentEmail})` : ''} before purchasing.`}
              </div>
            )}

            {/* ── Billing toggle ── */}
            <div className="flex items-center justify-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: billingCycle === 'monthly' ? 'var(--orange)' : 'var(--surface-2)', color: billingCycle === 'monthly' ? '#fff' : 'var(--text-3)' }}
                data-testid="plan-modal-cycle-monthly"
              >
                {isHi ? 'मासिक' : 'Monthly'}
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('yearly')}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                style={{ background: billingCycle === 'yearly' ? 'var(--orange)' : 'var(--surface-2)', color: billingCycle === 'yearly' ? '#fff' : 'var(--text-3)' }}
                data-testid="plan-modal-cycle-yearly"
              >
                {isHi ? 'वार्षिक' : 'Yearly'} <span className="text-[10px]">({isHi ? '33% बचाएं' : 'save 33%'})</span>
              </button>
            </div>

            {/* ── Plans — pricing read straight from the SoT, no local literal ── */}
            <div className="space-y-3 mb-2">
              {UPGRADE_TIERS.map((tier) => {
                const plan = PLANS[tier];
                const price = PRICING[tier];
                const isCurrent = normalizedCurrent === tier;
                return (
                  <div
                    key={tier}
                    className="rounded-xl p-4 flex items-center justify-between"
                    style={{
                      background: isCurrent ? `${plan.color}08` : 'var(--bg)',
                      border: isCurrent ? `2px solid ${plan.color}30` : '1px solid var(--border)',
                    }}
                    data-testid={`plan-modal-tier-${tier}`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                          {plan.icon} {plan.name}
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: plan.color }}>
                            {isHi ? 'सक्रिय' : 'CURRENT'}
                          </span>
                        )}
                      </div>
                      <div className="text-lg font-extrabold mt-0.5" style={{ color: plan.color }}>
                        {billingCycle === 'yearly' ? formatINR(yearlyPerMonth(price.yearly)) : formatINR(price.monthly)}
                        <span className="text-xs font-normal" style={{ color: 'var(--text-3)' }}>/mo</span>
                      </div>
                      {billingCycle === 'yearly' && (
                        <div className="text-[10px] font-semibold" style={{ color: 'var(--text-2)' }}>
                          {isHi ? 'सालाना बिल' : 'Billed as'} {formatINR(price.yearly)}/{isHi ? 'वर्ष' : 'year'}
                        </div>
                      )}
                      <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                        {(isHi ? plan.benefitsHi : plan.benefits).slice(0, 2).join(' · ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isCurrent || checkingOut}
                      onClick={() => setConfirmTier(tier)}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-white shrink-0"
                      style={{ background: isCurrent ? 'var(--text-3)' : checkingOut ? '#ccc' : `linear-gradient(135deg, ${plan.color}, ${plan.color}cc)` }}
                      data-testid={`plan-modal-cta-${tier}`}
                    >
                      {isCurrent
                        ? (isHi ? 'सक्रिय' : 'Current plan')
                        : checkingOut
                          ? (status === 'verifying' ? (isHi ? 'सत्यापित हो रहा...' : 'Verifying...') : status === 'activating' ? (isHi ? 'सक्रिय हो रहा...' : 'Activating...') : '...')
                          : (isHi ? 'अपग्रेड' : 'Upgrade')}
                    </button>
                  </div>
                );
              })}
            </div>

            {statusMessage && (
              <div className="text-xs text-center mb-3 flex items-center justify-center gap-2" style={{ color: 'var(--orange)' }} data-testid="plan-modal-status">
                <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {statusMessage}
              </div>
            )}
            {checkoutError && (
              <p className="text-xs text-center mb-3" style={{ color: '#EF4444' }} data-testid="plan-modal-error-message">
                {checkoutError}
              </p>
            )}

            <div className="flex items-center justify-between mt-2">
              <Link href={pricingHref} className="text-xs font-semibold" style={{ color: 'var(--orange)' }}>
                {isHi ? 'सभी प्लान देखें →' : 'Compare all plans →'}
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-semibold px-4 py-2 rounded-lg"
                style={{ color: 'var(--text-3)' }}
                data-testid="plan-modal-later"
              >
                {isHi ? 'बाद में' : 'Maybe later'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Confirmation dialog — unchanged shared component */}
      <SubscriptionConfirm
        isOpen={!!confirmTier}
        planName={confirmTier ? PLANS[confirmTier].name : ''}
        planCode={confirmTier ?? ''}
        priceMonthly={confirmTier ? PRICING[confirmTier].monthly : 0}
        priceYearly={confirmTier ? PRICING[confirmTier].yearly : 0}
        billingCycle={billingCycle}
        loading={checkingOut}
        onCancel={() => setConfirmTier(null)}
        onConfirm={() => {
          if (!confirmTier) return;
          const tier = confirmTier;
          checkout({
            planCode: tier,
            billingCycle,
            onSuccess: () => {
              setSuccess(tier);
              setConfirmTier(null);
            },
            onError: () => setConfirmTier(null),
          });
        }}
      />
    </div>
  );
}
