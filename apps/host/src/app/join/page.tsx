'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import { setPendingInvite } from '@alfanumrik/lib/school/pending-invite';
import { Skeleton } from '@alfanumrik/ui/ui';
import {
  Card,
  Button,
  Input,
  Field,
  Badge,
} from '@alfanumrik/ui/ui/primitives';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface JoinResult {
  success: boolean;
  authenticated?: boolean;
  school?: {
    id: string;
    name: string;
    slug: string;
    logo_url?: string | null;
  };
  role?: string;
  class_name?: string | null;
  class_grade?: string | null;
  message?: string;
  error?: string;
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isHi, isLoggedIn, isLoading: authLoading } = useAuth();

  /* ── state ── */
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<JoinResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── Pre-fill code from URL params ── */
  useEffect(() => {
    const urlCode = searchParams.get('code');
    if (urlCode) {
      setCode(urlCode.toUpperCase());
    }
  }, [searchParams]);

  /* ── Submit invite code ── */
  async function handleJoin() {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode || trimmedCode.length < 3) {
      setError(t(isHi, 'Please enter a valid invite code', 'कृपया एक वैध आमंत्रण कोड दर्ज करें'));
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      // Forward the Supabase Bearer token: an authenticated joiner's session
      // lives in localStorage (not cookies), so without this the route's
      // cookie path sees no user and wrongly returns the unauthenticated
      // branch even though the user is signed in.
      const res = await fetch('/api/schools/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeader()),
        },
        credentials: 'same-origin',
        body: JSON.stringify({ code: trimmedCode }),
      });

      const data: JoinResult = await res.json();

      if (!data.success) {
        setError(data.error || t(isHi, 'Invalid invite code', 'अमान्य आमंत्रण कोड'));
        setSubmitting(false);
        return;
      }

      setResult(data);
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setSubmitting(false);
    }
  }

  /* ── Handle key press ── */
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !submitting) {
      handleJoin();
    }
  }

  /* ── Loading state ── */
  if (authLoading) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center px-4"
        style={{ background: 'var(--bg)' }}
      >
        <div className="w-full max-w-sm space-y-4">
          <Skeleton variant="circle" height={60} width={60} className="mx-auto" />
          <Skeleton variant="title" height={28} width="70%" className="mx-auto" />
          <Skeleton variant="rect" height={56} rounded="rounded-xl" />
          <Skeleton variant="rect" height={52} rounded="rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-4 py-8"
      style={{ background: 'var(--bg)' }}
    >
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 text-5xl" aria-hidden="true">🦊</div>
          <h1
            className="text-fluid-2xl font-bold text-foreground"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {t(isHi, 'Join Your School', 'अपने स्कूल से जुड़ें')}
          </h1>
          <p className="mt-2 text-fluid-sm text-muted-foreground">
            {t(
              isHi,
              'Enter the invite code from your school',
              'अपने स्कूल से मिला आमंत्रण कोड दर्ज करें'
            )}
          </p>
        </div>

        {/* Result state: Success */}
        {result && result.success ? (
          <Card variant="elevated" className="text-center">
            <div className="space-y-4 px-5 py-6">
              <div className="text-4xl" aria-hidden="true">🎉</div>

              <div>
                <h2 className="text-fluid-lg font-bold text-foreground">
                  {result.authenticated
                    ? t(isHi, 'Welcome!', 'स्वागत है!')
                    : t(isHi, 'Almost there!', 'लगभग पूरा!')}
                </h2>
                <p className="mt-2 text-fluid-sm text-muted-foreground">
                  {result.message}
                </p>
              </div>

              {/* School & role info */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                {result.school && (
                  <Badge tone="brand" variant="soft">
                    {result.school.name}
                  </Badge>
                )}
                {result.role && (
                  <Badge tone={result.role === 'teacher' ? 'info' : 'warning'} variant="soft">
                    {result.role === 'teacher'
                      ? t(isHi, 'Teacher', 'शिक्षक')
                      : t(isHi, 'Student', 'छात्र')}
                  </Badge>
                )}
                {result.class_name && (
                  <Badge tone="success" variant="soft">
                    {result.class_name}
                    {result.class_grade ? ` (Gr. ${result.class_grade})` : ''}
                  </Badge>
                )}
              </div>

              {/* Action buttons */}
              {result.authenticated ? (
                <Button
                  variant="primary"
                  fullWidth
                  size="lg"
                  onClick={() => router.push('/dashboard')}
                >
                  {t(isHi, 'Go to Dashboard', 'डैशबोर्ड पर जाएं')} →
                </Button>
              ) : (
                <div className="space-y-2">
                  <Button
                    variant="primary"
                    fullWidth
                    size="lg"
                    onClick={() => {
                      // Persist the code now so it survives the email-verify
                      // round-trip even before /login's own effect runs.
                      setPendingInvite(code);
                      router.push(
                        `/login?school=${result.school?.slug ?? ''}&code=${encodeURIComponent(code)}`
                      );
                    }}
                  >
                    {t(isHi, 'Sign Up to Continue', 'जारी रखने के लिए साइन अप करें')}
                  </Button>
                  <Button
                    variant="ghost"
                    fullWidth
                    onClick={() => {
                      // Persist the code now so it survives the email-verify
                      // round-trip even before /login's own effect runs.
                      setPendingInvite(code);
                      router.push(
                        `/login?school=${result.school?.slug ?? ''}&code=${encodeURIComponent(code)}`
                      );
                    }}
                  >
                    {t(isHi, 'Already have an account? Sign In', 'पहले से खाता है? साइन इन करें')}
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ) : (
          /* Input state: Enter code */
          <div className="space-y-4">
            <Field
              htmlFor="invite-code"
              label={t(isHi, 'Invite Code / आमंत्रण कोड', 'Invite Code / आमंत्रण कोड')}
              error={error || undefined}
            >
              <Input
                type="text"
                size="lg"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder="ABC123"
                maxLength={8}
                autoComplete="off"
                autoFocus
                className="text-center text-2xl font-bold"
                style={{ fontFamily: 'monospace', letterSpacing: '0.2em' }}
              />
            </Field>

            <Button
              variant="primary"
              fullWidth
              size="lg"
              onClick={handleJoin}
              loading={submitting}
              disabled={submitting || code.trim().length < 3}
            >
              {submitting
                ? t(isHi, 'Checking...', 'जाँच रहे हैं...')
                : t(isHi, 'Join', 'जुड़ें')}
            </Button>

            {/* Login link */}
            {!isLoggedIn && (
              <p className="text-center text-fluid-xs text-muted-foreground">
                {t(
                  isHi,
                  "Don't have a code? ",
                  'कोड नहीं है? '
                )}
                <button
                  onClick={() => router.push('/login')}
                  className="font-semibold underline"
                  style={{ color: 'var(--purple)' }}
                >
                  {t(isHi, 'Sign in here', 'यहाँ साइन इन करें')}
                </button>
              </p>
            )}
          </div>
        )}

        {/* Footer: Powered by Alfanumrik */}
        <div className="mt-8 text-center">
          <p className="text-fluid-xs text-muted-foreground">
            {t(isHi, 'Powered by', 'द्वारा संचालित')}{' '}
            <span className="font-semibold" style={{ color: 'var(--purple)' }}>
              Alfanumrik
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Suspense boundary required by Next.js App Router when using useSearchParams().
 * Same pattern as login/page.tsx — prevents React #418 text-node hydration mismatch.
 */
export default function JoinPage() {
  return (
    <Suspense>
      <JoinPageContent />
    </Suspense>
  );
}
