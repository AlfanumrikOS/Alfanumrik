'use client';

/**
 * /settings/account/delete — DPDP §17 right-to-erasure (Wave 2 D7 follow-up #2).
 *
 * Three states driven entirely by GET /api/v1/account/delete:
 *
 *   State A — no in-flight request (GET 404)
 *     Shows the consequences card + reason textarea + confirmEmail input +
 *     two-step confirmation (sheet modal that requires typing DELETE).
 *     POST /api/v1/account/delete on submit. After 201, SWR revalidates →
 *     transitions to State B. After 400 (CONFIRM_EMAIL_MISMATCH) we surface
 *     the bilingual error inline; we DO NOT echo back the email or the
 *     reason text in any error or log call (P13).
 *
 *   State B — cooling-off active (status: 'requested' | 'cooling_off')
 *     Shows the requested_at, days remaining, terminal date, and a single
 *     Cancel button. DELETE /api/v1/account/delete; on 200 → State C.
 *
 *   State C — terminal (status: 'cancelled_by_user' | 'purged' | 'failed')
 *     Cancelled → green confirmation. Purged should be unreachable in the
 *     browser (auth.users is dropped) but if it ever loads we render a
 *     generic completion notice instead of crashing.
 *
 * Auth: useRequireAuth() pattern via useAuth().isLoggedIn — protects the
 * page from anonymous loads and bounces to /login.
 *
 * P7 (Bilingual): every visible string branches on isHi. Technical terms
 * (DPDP, email, account, XP) are intentionally left in English with Hindi
 * surrounding context.
 *
 * P13 (No PII in logs): we deliberately do NOT pass `reason` or
 * `confirmEmail` to console.log/console.warn/console.error. Errors are
 * surfaced to the user via UI state only. The server already redacts.
 */

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import {
  Card,
  Button,
  Textarea,
  Input,
  SectionHeader,
  Badge,
  LoadingFoxy,
  SheetModal,
  FormField,
  Skeleton,
} from '@alfanumrik/ui/ui';

/* ─── Types ───────────────────────────────────────────────── */
type DeletionStatus =
  | 'requested'
  | 'cooling_off'
  | 'cancelled_by_user'
  | 'purged'
  | 'failed';

interface DeletionData {
  deletion_id: string;
  status: DeletionStatus;
  requested_at: string;
  cooling_off_ends_at: string;
  completed_at: string | null;
  purged_categories: Record<string, unknown>;
  can_cancel: boolean;
}

/* ─── SWR fetcher ─────────────────────────────────────────── */
async function fetchDeletionStatus(): Promise<DeletionData | null> {
  const res = await fetch('/api/v1/account/delete', {
    method: 'GET',
    credentials: 'include',
  });
  // 404 means no in-flight request — that is the "empty" state, not an error.
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error('status_lookup_failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  return json.data as DeletionData;
}

/* ─── Date helpers ────────────────────────────────────────── */
function formatDate(iso: string, isHi: boolean): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string): number {
  try {
    const target = new Date(iso).getTime();
    const now = Date.now();
    return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
  } catch {
    return 0;
  }
}

/* ═══════════════════════════════════════════════════════════
 * Page
 * ═══════════════════════════════════════════════════════════ */
export default function AccountDeletePage() {
  const router = useRouter();
  const { isLoggedIn, isLoading: authLoading, isHi, student, guardian } = useAuth();
  const [authDeadlineExpired, setAuthDeadlineExpired] = useState(false);

  // Email used for the confirmEmail check — prefer the role-specific profile
  // email, fallback to "" (server will reject blank with a clear error).
  // TeacherProfile does not include an email field on the client; teachers
  // type their own email and the server is the authoritative validator.
  const accountEmail = useMemo(() => {
    return (student?.email ?? guardian?.email ?? '').toLowerCase();
  }, [student, guardian]);

  // SWR must be called unconditionally (rules-of-hooks). We gate the
  // fetch by passing `null` as the SWR key when not logged in.
  const { data, error, isLoading, mutate } = useSWR<DeletionData | null>(
    isLoggedIn ? 'account-deletion-status' : null,
    fetchDeletionStatus,
    {
      revalidateOnFocus: true,
      shouldRetryOnError: (err: { status?: number }) => {
        // Don't retry on 4xx — only network/5xx transients.
        if (err?.status && err.status >= 400 && err.status < 500) return false;
        return true;
      },
    },
  );

  useEffect(() => {
    if (!authLoading) {
      setAuthDeadlineExpired(false);
      return;
    }
    const timeout = window.setTimeout(() => setAuthDeadlineExpired(true), 20_000);
    return () => window.clearTimeout(timeout);
  }, [authLoading]);

  useEffect(() => {
    if ((!authLoading || authDeadlineExpired) && !isLoggedIn) {
      router.replace('/login?redirect=/settings/account/delete');
    }
  }, [authDeadlineExpired, authLoading, isLoggedIn, router]);

  // Bounce anonymous users to /login. Intentionally not gated by role —
  // students, parents, and teachers all have the 'account.delete'
  // permission per migration 20260505120000.
  if ((!authLoading || authDeadlineExpired) && !isLoggedIn) {
    return <LoadingFoxy />;
  }

  if (authLoading || isLoading) return <LoadingFoxy />;

  // Render one of three states.
  let body: React.ReactNode;
  if (error) {
    body = <ErrorState isHi={isHi} onRetry={() => mutate()} />;
  } else if (!data) {
    // Empty state = no in-flight request → State A
    body = (
      <StateANoRequest
        isHi={isHi}
        accountEmail={accountEmail}
        onSubmitted={() => mutate()}
      />
    );
  } else if (data.status === 'requested' || data.status === 'cooling_off') {
    body = (
      <StateBCoolingOff
        isHi={isHi}
        data={data}
        onCancelled={() => mutate()}
      />
    );
  } else if (data.status === 'cancelled_by_user') {
    body = <StateCCancelled isHi={isHi} onStartOver={() => mutate()} />;
  } else {
    // 'purged' or 'failed' — the user shouldn't normally see this in-browser
    // because the auth row is gone. Render a graceful generic state.
    body = <StateCTerminal isHi={isHi} status={data.status} />;
  }

  return (
    <div className="mesh-bg min-h-dvh pb-12">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-[var(--text-3)]"
            aria-label={isHi ? 'वापस' : 'Back'}
          >
            ←
          </button>
          <h1
            className="text-lg font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isHi ? 'खाता हटाएं' : 'Delete account'}
          </h1>
        </div>
      </header>
      <main className="app-container py-5 space-y-4 max-w-2xl">{body}</main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * Error / Loading helpers
 * ═══════════════════════════════════════════════════════════ */
function ErrorState({ isHi, onRetry }: { isHi: boolean; onRetry: () => void }) {
  return (
    <Card>
      <p
        className="text-sm font-medium"
        style={{ color: 'var(--red, #DC2626)' }}
      >
        {isHi
          ? 'स्थिति लोड नहीं हो सकी। कृपया पुनः प्रयास करें।'
          : 'Could not load deletion status. Please try again.'}
      </p>
      <div className="mt-3">
        <Button variant="ghost" onClick={onRetry}>
          {isHi ? 'पुनः प्रयास करें' : 'Retry'}
        </Button>
      </div>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <Skeleton width="60%" height={20} />
      <div className="mt-3 space-y-2">
        <Skeleton width="100%" height={12} />
        <Skeleton width="90%" height={12} />
        <Skeleton width="70%" height={12} />
      </div>
    </Card>
  );
}
// Suppress unused-warning for SkeletonCard — it is used by the LoadingFoxy
// fallback path in future if we choose more granular skeletons. Keeping it
// here documents the pattern for the next state.
void SkeletonCard;

/* ═══════════════════════════════════════════════════════════
 * STATE A — No deletion in progress
 * ═══════════════════════════════════════════════════════════ */
function StateANoRequest({
  isHi,
  accountEmail,
  onSubmitted,
}: {
  isHi: boolean;
  accountEmail: string;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const reasonError = useMemo(() => {
    if (!reason) return null;
    const len = reason.trim().length;
    if (len < 10) {
      return isHi
        ? 'कृपया कम से कम 10 अक्षर लिखें'
        : 'Please write at least 10 characters';
    }
    if (len > 500) {
      return isHi
        ? '500 अक्षरों की सीमा पार हो गई'
        : 'Exceeds the 500-character limit';
    }
    return null;
  }, [reason, isHi]);

  const emailError = useMemo(() => {
    if (!confirmEmail) return null;
    if (confirmEmail.trim().toLowerCase() !== accountEmail) {
      return isHi
        ? 'यह आपके खाते के ईमेल से मेल नहीं खाता'
        : 'This does not match your account email';
    }
    return null;
  }, [confirmEmail, accountEmail, isHi]);

  const canProceed =
    reason.trim().length >= 10 &&
    reason.trim().length <= 500 &&
    !!confirmEmail &&
    !emailError &&
    !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch('/api/v1/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: reason.trim(), confirmEmail: confirmEmail.trim() }),
      });
      const json = await res.json().catch(() => ({}));

      // Map server error codes to bilingual user-facing messages.
      // We intentionally do NOT log the response body — it could contain
      // hints about the email or reason that we want to keep off the wire.
      if (!res.ok) {
        const code = (json?.code as string | undefined) ?? '';
        let msg: string;
        switch (code) {
          case 'CONFIRM_EMAIL_MISMATCH':
            msg = isHi
              ? 'पुष्टि-ईमेल आपके खाते से मेल नहीं खाता'
              : 'Confirm email does not match your account';
            break;
          case 'REASON_REQUIRED':
          case 'REASON_TOO_LONG':
            msg = isHi
              ? 'कारण मान्य नहीं है (10-500 अक्षर आवश्यक)'
              : 'Reason is not valid (10-500 characters required)';
            break;
          case 'EMAIL_LOOKUP_FAILED':
          case 'RPC_FAILED':
          case 'RPC_NO_ROW':
            msg = isHi
              ? 'सर्वर अभी उपलब्ध नहीं है। कुछ देर बाद पुनः प्रयास करें।'
              : 'Server temporarily unavailable. Please try again shortly.';
            break;
          case 'NO_ACCOUNT':
            msg = isHi
              ? 'आपके खाते की प्रोफ़ाइल नहीं मिली'
              : 'Account profile not found';
            break;
          default:
            if (res.status === 401) {
              msg = isHi ? 'कृपया पुनः लॉग इन करें' : 'Please sign in again';
            } else {
              msg = isHi
                ? 'अनुरोध विफल हुआ। कृपया पुनः प्रयास करें।'
                : 'Request failed. Please try again.';
            }
        }
        setServerError(msg);
        return;
      }

      // 201 happy path or 200 idempotent replay — both surface as State B.
      setShowConfirm(false);
      onSubmitted();
    } catch {
      setServerError(
        isHi
          ? 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'
          : 'Network error. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card accent="var(--red, #DC2626)">
        <h2
          className="text-xl font-bold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isHi ? 'अपना खाता हटाएं' : 'Delete your account'}
        </h2>
        <p className="text-sm text-[var(--text-2)] mt-2 leading-relaxed">
          {isHi
            ? 'यह आपके DPDP §17 अधिकारों के तहत स्थायी विलोपन शुरू करता है। नीचे दिए गए परिणामों को ध्यान से पढ़ें।'
            : 'This starts a permanent erasure under your DPDP §17 rights. Please read the consequences below carefully.'}
        </p>
      </Card>

      <Card>
        <SectionHeader icon="⚠️">
          {isHi ? 'क्या होगा' : 'What will happen'}
        </SectionHeader>
        <ul className="mt-3 space-y-2 text-sm text-[var(--text-2)] leading-relaxed">
          <li className="flex gap-2">
            <span className="text-[var(--red,#DC2626)] shrink-0">•</span>
            <span>
              {isHi
                ? 'आपका सारा सीखने का इतिहास, क्विज़ उत्तर, और Foxy बातचीत हमेशा के लिए हटा दी जाएगी।'
                : 'All your learning history, quiz responses, and Foxy conversations will be permanently deleted.'}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--orange)] shrink-0">•</span>
            <span>
              {isHi
                ? '30 दिन की कूलिंग-ऑफ अवधि — उससे पहले कभी भी रद्द कर सकते हैं।'
                : '30-day cooling-off period — you can cancel any time before then.'}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--purple)] shrink-0">•</span>
            <span>
              {isHi
                ? 'कोई भी सक्रिय सदस्यता वर्तमान बिलिंग अवधि के अंत में रद्द हो जाएगी।'
                : 'Any active subscription will be cancelled at the end of the current billing period.'}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--text-3)] shrink-0">•</span>
            <span>
              {isHi
                ? 'भारतीय आयकर अधिनियम के अनुसार भुगतान रिकॉर्ड 8 साल तक रखे जाते हैं (अनाम कर दिए जाते हैं)।'
                : 'Payment records are retained for 8 years per the Income Tax Act (anonymised).'}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--red,#DC2626)] shrink-0">•</span>
            <span className="font-semibold">
              {isHi
                ? '30 दिन के बाद यह क्रिया वापस नहीं ली जा सकती।'
                : 'This action cannot be undone after 30 days.'}
            </span>
          </li>
        </ul>
      </Card>

      <Card>
        <SectionHeader icon="📝">
          {isHi ? 'पुष्टि' : 'Confirm'}
        </SectionHeader>
        <div className="space-y-4 mt-3">
          <FormField
            label={isHi ? 'कारण (आवश्यक)' : 'Reason (required)'}
            required
            helperText={
              isHi
                ? `10-500 अक्षर। यह हमें सेवा सुधारने में मदद करता है। • ${reason.trim().length}/500`
                : `10-500 characters. This helps us improve the service. • ${reason.trim().length}/500`
            }
            error={reasonError ?? undefined}
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isHi
                  ? 'बताएं कि आप क्यों जा रहे हैं...'
                  : 'Tell us why you are leaving...'
              }
              rows={4}
              maxLength={550}
              data-testid="deletion-reason-input"
            />
          </FormField>

          <FormField
            label={
              isHi
                ? 'पुष्टि के लिए अपना ईमेल टाइप करें'
                : 'Type your account email to confirm'
            }
            required
            helperText={
              accountEmail
                ? isHi
                  ? `यह "${accountEmail}" से बिल्कुल मेल खाना चाहिए`
                  : `Must match "${accountEmail}" exactly`
                : isHi
                  ? 'अपने पंजीकृत ईमेल का उपयोग करें'
                  : 'Use your registered email'
            }
            error={emailError ?? undefined}
          >
            <Input
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
              data-testid="deletion-confirm-email-input"
            />
          </FormField>

          {serverError && (
            <div
              role="alert"
              className="p-3 rounded-xl text-sm font-medium"
              style={{
                background: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.25)',
                color: 'var(--red, #DC2626)',
              }}
              data-testid="deletion-server-error"
            >
              {serverError}
            </div>
          )}

          <Button
            variant="destructive"
            fullWidth
            disabled={!canProceed}
            onClick={() => {
              setServerError(null);
              setConfirmText('');
              setShowConfirm(true);
            }}
            data-testid="deletion-open-confirm-button"
          >
            {isHi
              ? 'मेरा खाता स्थायी रूप से हटाएं'
              : 'Permanently delete my account'}
          </Button>
        </div>
      </Card>

      {/* Two-step confirmation: type DELETE */}
      <SheetModal
        open={showConfirm}
        onClose={() => !submitting && setShowConfirm(false)}
        title={isHi ? 'क्या आप पूरी तरह निश्चित हैं?' : 'Are you absolutely sure?'}
      >
        <div className="space-y-4 pt-2">
          <p className="text-sm text-[var(--text-2)] leading-relaxed">
            {isHi
              ? 'पुष्टि के लिए नीचे "DELETE" टाइप करें। 30 दिनों तक आप इस अनुरोध को रद्द कर सकते हैं।'
              : 'Type "DELETE" below to confirm. You will have 30 days to cancel this request.'}
          </p>
          <FormField
            label={isHi ? 'पुष्टि' : 'Confirmation'}
            required
            helperText={isHi ? 'बड़े अक्षरों में DELETE लिखें' : 'Type DELETE in uppercase'}
          >
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              data-testid="deletion-confirm-text-input"
            />
          </FormField>
          {serverError && (
            <div
              role="alert"
              className="p-3 rounded-xl text-sm font-medium"
              style={{
                background: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.25)',
                color: 'var(--red, #DC2626)',
              }}
            >
              {serverError}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setShowConfirm(false)}
              disabled={submitting}
            >
              {isHi ? 'रद्द करें' : 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              fullWidth
              disabled={confirmText !== 'DELETE' || submitting}
              loading={submitting}
              onClick={handleSubmit}
              data-testid="deletion-final-submit-button"
            >
              {submitting
                ? isHi
                  ? 'अनुरोध सबमिट हो रहा है...'
                  : 'Submitting request...'
                : isHi
                  ? 'हाँ, हटाएं'
                  : 'Yes, delete'}
            </Button>
          </div>
        </div>
      </SheetModal>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
 * STATE B — Cooling-off active
 * ═══════════════════════════════════════════════════════════ */
function StateBCoolingOff({
  isHi,
  data,
  onCancelled,
}: {
  isHi: boolean;
  data: DeletionData;
  onCancelled: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const daysLeft = daysUntil(data.cooling_off_ends_at);
  const purgeDate = formatDate(data.cooling_off_ends_at, isHi);
  const requestedDate = formatDate(data.requested_at, isHi);

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/account/delete', {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (json?.code as string | undefined) ?? '';
        let msg: string;
        switch (code) {
          case 'COOLING_OFF_ENDED':
            msg = isHi
              ? 'कूलिंग-ऑफ अवधि समाप्त हो गई है। रद्द नहीं किया जा सकता।'
              : 'Cooling-off window has ended. Cannot cancel.';
            break;
          case 'ALREADY_PURGED':
            msg = isHi
              ? 'खाता पहले ही हटाया जा चुका है।'
              : 'Account has already been purged.';
            break;
          case 'ALREADY_CANCELLED':
            msg = isHi
              ? 'अनुरोध पहले ही रद्द हो चुका है।'
              : 'Request has already been cancelled.';
            break;
          case 'NO_REQUEST':
            msg = isHi
              ? 'कोई सक्रिय अनुरोध नहीं मिला।'
              : 'No active request found.';
            break;
          default:
            msg = isHi
              ? 'रद्दीकरण विफल। कृपया पुनः प्रयास करें।'
              : 'Cancellation failed. Please try again.';
        }
        setError(msg);
        return;
      }
      setShowConfirm(false);
      onCancelled();
    } catch {
      setError(
        isHi
          ? 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'
          : 'Network error. Please try again.',
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <Card accent="var(--orange)">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2
              className="text-xl font-bold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isHi
                ? 'खाता हटाने की प्रक्रिया जारी'
                : 'Account deletion in progress'}
            </h2>
            <div className="mt-2">
              <Badge color="var(--orange)">
                {isHi ? `${daysLeft} दिन शेष` : `${daysLeft} days remaining`}
              </Badge>
            </div>
          </div>
        </div>
        <p className="text-sm text-[var(--text-2)] mt-3 leading-relaxed">
          {isHi
            ? `आपका डेटा ${purgeDate} को स्थायी रूप से हटा दिया जाएगा। तब तक आप इसे रद्द कर सकते हैं।`
            : `Your data will be permanently purged on ${purgeDate}. You can still cancel until then.`}
        </p>
      </Card>

      <Card>
        <SectionHeader icon="📅">
          {isHi ? 'अनुरोध विवरण' : 'Request details'}
        </SectionHeader>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--text-3)]">
              {isHi ? 'अनुरोध तिथि' : 'Requested on'}
            </span>
            <span className="font-medium">{requestedDate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-3)]">
              {isHi ? 'विलोपन तिथि' : 'Purge date'}
            </span>
            <span className="font-medium">{purgeDate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-3)]">
              {isHi ? 'स्थिति' : 'Status'}
            </span>
            <span className="font-medium" style={{ color: 'var(--orange)' }}>
              {data.status === 'requested'
                ? isHi
                  ? 'अनुरोधित'
                  : 'Requested'
                : isHi
                  ? 'कूलिंग-ऑफ'
                  : 'Cooling off'}
            </span>
          </div>
        </div>
      </Card>

      {error && (
        <Card>
          <p
            role="alert"
            className="text-sm font-medium"
            style={{ color: 'var(--red, #DC2626)' }}
            data-testid="deletion-cancel-error"
          >
            {error}
          </p>
        </Card>
      )}

      <Button
        variant="primary"
        fullWidth
        onClick={() => setShowConfirm(true)}
        data-testid="deletion-cancel-open-button"
      >
        {isHi
          ? 'अनुरोध रद्द करें — मेरा खाता रखें'
          : 'Cancel deletion request — keep my account'}
      </Button>

      <SheetModal
        open={showConfirm}
        onClose={() => !cancelling && setShowConfirm(false)}
        title={isHi ? 'विलोपन रद्द करें?' : 'Cancel deletion?'}
      >
        <div className="space-y-4 pt-2">
          <p className="text-sm text-[var(--text-2)] leading-relaxed">
            {isHi
              ? 'यह आपके विलोपन अनुरोध को रद्द कर देगा और आपका खाता पूरी तरह सक्रिय हो जाएगा।'
              : 'This will cancel your deletion request and fully reactivate your account.'}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              fullWidth
              onClick={() => setShowConfirm(false)}
              disabled={cancelling}
            >
              {isHi ? 'वापस' : 'Back'}
            </Button>
            <Button
              variant="primary"
              fullWidth
              loading={cancelling}
              onClick={handleCancel}
              data-testid="deletion-cancel-confirm-button"
            >
              {cancelling
                ? isHi
                  ? 'रद्द हो रहा है...'
                  : 'Cancelling...'
                : isHi
                  ? 'हाँ, रद्द करें'
                  : 'Yes, cancel deletion'}
            </Button>
          </div>
        </div>
      </SheetModal>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
 * STATE C — Cancelled (terminal, success)
 * ═══════════════════════════════════════════════════════════ */
function StateCCancelled({ isHi, onStartOver }: { isHi: boolean; onStartOver: () => void }) {
  return (
    <Card>
      <div
        className="rounded-xl p-4 text-center"
        style={{
          background: 'rgba(22,163,74,0.08)',
          border: '1px solid rgba(22,163,74,0.25)',
        }}
        data-testid="deletion-cancelled-success"
      >
        <div className="text-3xl mb-2" aria-hidden="true">
          ✓
        </div>
        <h2
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--green, #16A34A)' }}
        >
          {isHi
            ? 'विलोपन सफलतापूर्वक रद्द किया गया'
            : 'Deletion cancelled successfully'}
        </h2>
        <p className="text-sm text-[var(--text-2)] mt-2">
          {isHi
            ? 'आपका खाता पूरी तरह सक्रिय है।'
            : 'Your account is fully active.'}
        </p>
      </div>
      <div className="mt-4">
        <Button variant="ghost" fullWidth onClick={onStartOver}>
          {isHi ? 'ताज़ा करें' : 'Refresh'}
        </Button>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
 * STATE C — Generic terminal (purged / failed — defensive)
 * ═══════════════════════════════════════════════════════════ */
function StateCTerminal({ isHi, status }: { isHi: boolean; status: DeletionStatus }) {
  return (
    <Card>
      <h2
        className="text-lg font-bold"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {status === 'purged'
          ? isHi
            ? 'विलोपन पूर्ण'
            : 'Deletion completed'
          : isHi
            ? 'विलोपन विफल'
            : 'Deletion failed'}
      </h2>
      <p className="text-sm text-[var(--text-2)] mt-2 leading-relaxed">
        {status === 'purged'
          ? isHi
            ? 'आपका खाता हटा दिया गया है।'
            : 'Your account has been deleted.'
          : isHi
            ? 'विलोपन में कोई समस्या आई। कृपया सहायता से संपर्क करें।'
            : 'There was an issue completing the deletion. Please contact support.'}
      </p>
    </Card>
  );
}
