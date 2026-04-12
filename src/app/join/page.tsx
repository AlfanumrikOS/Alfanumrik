'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  Card,
  Button,
  Input,
  Badge,
  Skeleton,
} from '@/components/ui';

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
export default function JoinPage() {
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
      const res = await fetch('/api/schools/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        className="min-h-dvh flex items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
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
      className="min-h-dvh flex flex-col items-center justify-center px-4 py-8 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      style={{ background: 'var(--bg)' }}
    >
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4" aria-hidden="true">🦊</div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: 'Sora, system-ui, sans-serif', color: 'var(--text-1)' }}
          >
            {t(isHi, 'Join Your School', 'अपने स्कूल से जुड़ें')}
          </h1>
          <p className="text-sm text-[var(--text-3)] mt-2">
            {t(
              isHi,
              'Enter the invite code from your school',
              'अपने स्कूल से मिला आमंत्रण कोड दर्ज करें'
            )}
          </p>
        </div>

        {/* Result state: Success */}
        {result && result.success ? (
          <Card accent="#16A34A" className="text-center">
            <div className="py-4 space-y-4">
              <div className="text-4xl" aria-hidden="true">🎉</div>

              <div>
                <h2 className="text-lg font-bold text-[var(--text-1)]">
                  {result.authenticated
                    ? t(isHi, 'Welcome!', 'स्वागत है!')
                    : t(isHi, 'Almost there!', 'लगभग पूरा!')}
                </h2>
                <p className="text-sm text-[var(--text-2)] mt-2">
                  {result.message}
                </p>
              </div>

              {/* School & role info */}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {result.school && (
                  <Badge color="#7C3AED" size="md">
                    {result.school.name}
                  </Badge>
                )}
                {result.role && (
                  <Badge
                    color={result.role === 'teacher' ? '#0891B2' : '#F97316'}
                    size="md"
                  >
                    {result.role === 'teacher'
                      ? t(isHi, 'Teacher', 'शिक्षक')
                      : t(isHi, 'Student', 'छात्र')}
                  </Badge>
                )}
                {result.class_name && (
                  <Badge color="#16A34A" size="md">
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
                    onClick={() =>
                      router.push(
                        `/login?school=${result.school?.slug ?? ''}&code=${code}`
                      )
                    }
                  >
                    {t(isHi, 'Sign Up to Continue', 'जारी रखने के लिए साइन अप करें')}
                  </Button>
                  <Button
                    variant="ghost"
                    fullWidth
                    onClick={() =>
                      router.push(
                        `/login?school=${result.school?.slug ?? ''}&code=${code}`
                      )
                    }
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
            <div>
              <label
                htmlFor="invite-code"
                className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium"
              >
                {t(isHi, 'Invite Code / आमंत्रण कोड', 'Invite Code / आमंत्रण कोड')}
              </label>
              <input
                id="invite-code"
                type="text"
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
                className="input-base text-center text-2xl font-bold tracking-[0.2em]"
                style={{
                  fontFamily: 'monospace',
                  height: '56px',
                  letterSpacing: '0.2em',
                  ...(error
                    ? {
                        borderColor: '#DC2626',
                        boxShadow: '0 0 0 2px rgba(220,38,38,0.1)',
                      }
                    : {}),
                }}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'code-error' : undefined}
              />
            </div>

            {error && (
              <p
                id="code-error"
                className="text-sm text-red-500 text-center font-medium"
                role="alert"
              >
                {error}
              </p>
            )}

            <Button
              variant="primary"
              fullWidth
              size="lg"
              onClick={handleJoin}
              disabled={submitting || code.trim().length < 3}
            >
              {submitting
                ? t(isHi, 'Checking...', 'जाँच रहे हैं...')
                : t(isHi, 'Join', 'जुड़ें')}
            </Button>

            {/* Login link */}
            {!isLoggedIn && (
              <p className="text-center text-xs text-[var(--text-3)]">
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
        <div className="text-center mt-8">
          <p className="text-xs text-[var(--text-3)]">
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