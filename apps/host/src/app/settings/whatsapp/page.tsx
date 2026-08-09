'use client';

/**
 * WhatsApp Study Bot — connect page (Phase 2, identity binding).
 *
 * Mounted at /settings/whatsapp. Student-facing surface for linking a
 * WhatsApp number to their account via the OTP flow:
 *
 *   POST /api/whatsapp/link/start  { role: 'student' }
 *     → 200 { otp, deep_link ('https://wa.me/<num>?text=LINK%20<otp>'), expires_at }
 *     → 401 unauthenticated (redirect to /login per house pattern)
 *     → 403 { error: 'parental_consent_required' } → point to /parent/consent
 *       (parent-side surface; the student's guardian approves there)
 *     → 429 cooldown → retry timer
 *
 * No QR library exists in the repo (verified 2026-07-30), so this page
 * degrades gracefully to deep-link + OTP-with-copy — the wa.me link also
 * works on desktop via WhatsApp Web, so no capability is lost.
 *
 * Bilingual (P7) via AuthContext.isHi. WhatsApp / OTP / QR untranslated.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { LoadingFoxy } from '@alfanumrik/ui/ui';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

interface LinkStartData {
  otp: string;
  deep_link: string;
  expires_at: string;
}

type PageState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'success'; data: LinkStartData }
  | { kind: 'expired' }
  | { kind: 'consent_required' }
  | { kind: 'cooldown'; retryAfterSec: number }
  | { kind: 'error'; message: string };

const DEFAULT_COOLDOWN_SEC = 60;

function formatMmSs(totalSec: number): string {
  const clamped = Math.max(0, totalSec);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ── Feature bullet row ── */
function FeatureRow({ emoji, text }: { emoji: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="text-lg leading-6 shrink-0" aria-hidden="true">
        {emoji}
      </span>
      <span className="text-sm leading-6" style={{ color: 'var(--text-2, #4b5563)' }}>
        {text}
      </span>
    </li>
  );
}

export default function WhatsAppConnectPage() {
  const router = useRouter();
  const { student, isLoggedIn, isLoading, isHi } = useAuth();

  const [state, setState] = useState<PageState>({ kind: 'idle' });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Auth guard — house pattern (see /settings) */
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  /* Single ticking interval for both the OTP expiry countdown and the
     429 cooldown timer. Interval handle lives in a ref (house rule —
     never in useState). */
  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (state.kind !== 'success' && state.kind !== 'cooldown') return;

    tickRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          if (tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
          }
          setState(s =>
            s.kind === 'success' ? { kind: 'expired' } : s.kind === 'cooldown' ? { kind: 'idle' } : s,
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [state.kind]);

  /* Auto-dismiss the "copied" flag */
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const startLink = useCallback(async () => {
    setState({ kind: 'requesting' });
    setCopied(false);
    try {
      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData?.session?.access_token ?? '';

      const resp = await fetch('/api/whatsapp/link/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ role: 'student' }),
      });

      if (resp.status === 401) {
        router.replace('/login');
        return;
      }

      let json: any = null;
      try {
        json = await resp.json();
      } catch {
        /* non-JSON body — handled by status branches below */
      }

      if (resp.status === 403) {
        if (json?.error === 'parental_consent_required') {
          setState({ kind: 'consent_required' });
        } else {
          setState({
            kind: 'error',
            message: t(isHi, 'You do not have access to this feature yet.', 'आपको अभी इस सुविधा की अनुमति नहीं है।'),
          });
        }
        return;
      }

      if (resp.status === 429) {
        /* Pinned contract: 429 body is { error: 'rate_limited', retry_after_ms }
           (milliseconds). Prefer retry_after_ms; fall back to the Retry-After
           header (seconds), then legacy retry_after_seconds / retry_after body
           fields (seconds), then the 60s default. */
        const bodyRetryMs = Number(json?.retry_after_ms);
        const headerRetry = Number(resp.headers.get('Retry-After'));
        const bodyRetry = Number(json?.retry_after_seconds ?? json?.retry_after);
        const retryAfterSec =
          Number.isFinite(bodyRetryMs) && bodyRetryMs > 0
            ? Math.ceil(bodyRetryMs / 1000)
            : Number.isFinite(headerRetry) && headerRetry > 0
              ? Math.ceil(headerRetry)
              : Number.isFinite(bodyRetry) && bodyRetry > 0
                ? Math.ceil(bodyRetry)
                : DEFAULT_COOLDOWN_SEC;
        setSecondsLeft(retryAfterSec);
        setState({ kind: 'cooldown', retryAfterSec });
        return;
      }

      if (!resp.ok) {
        setState({
          kind: 'error',
          message: t(isHi, 'Something went wrong. Please try again.', 'कुछ गलत हुआ। फिर से कोशिश करें।'),
        });
        return;
      }

      /* Success — the pinned contract (POST /api/whatsapp/link/start → 200)
         is the RAW shape { otp, deep_link, expires_at }, no envelope. Parse
         the raw body as the primary path; tolerance for a { success, data }
         envelope is kept only as a harmless fallback. */
      const raw = json ?? {};
      const payload: Partial<LinkStartData> =
        raw.otp && raw.deep_link && raw.expires_at ? raw : (raw.data ?? raw);
      if (!payload.otp || !payload.deep_link || !payload.expires_at) {
        setState({
          kind: 'error',
          message: t(isHi, 'Unexpected server response. Please try again.', 'सर्वर से अप्रत्याशित जवाब मिला। फिर से कोशिश करें।'),
        });
        return;
      }

      const expiresMs = new Date(payload.expires_at).getTime();
      const remaining = Math.floor((expiresMs - Date.now()) / 1000);
      setSecondsLeft(Number.isFinite(remaining) && remaining > 0 ? remaining : 10 * 60);
      setState({ kind: 'success', data: payload as LinkStartData });
    } catch {
      setState({
        kind: 'error',
        message: t(isHi, 'Could not reach the server. Check your connection and try again.', 'सर्वर से संपर्क नहीं हो सका। इंटरनेट जाँचें और फिर कोशिश करें।'),
      });
    }
  }, [isHi, router]);

  const copyOtp = useCallback(async (otp: string) => {
    try {
      await navigator.clipboard.writeText(otp);
      setCopied(true);
    } catch {
      /* Clipboard API unavailable (older WebView) — select-on-tap fallback
         is provided by the visible OTP text itself. */
    }
  }, []);

  if (isLoading || !student) return <LoadingFoxy />;

  const busy = state.kind === 'requesting';

  return (
    <div className="mesh-bg min-h-dvh pb-12">
      {/* ─── Header ─── */}
      <header
        className="page-header"
        style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)' }}
      >
        <div className="app-container py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label={t(isHi, 'Back', 'वापस')}
            className="text-[var(--text-3)] text-lg leading-none p-1 -ml-1"
          >
            ←
          </button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {t(isHi, 'WhatsApp Study Bot', 'WhatsApp स्टडी बॉट')}
          </h1>
        </div>
      </header>

      <main className="app-container py-6 max-w-md mx-auto space-y-5">
        {/* ─── What it does ─── */}
        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
        >
          <h2
            className="text-base font-bold mb-3"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1, #111827)' }}
          >
            {t(isHi, 'Study on WhatsApp', 'WhatsApp पर पढ़ाई')}
          </h2>
          <ul className="space-y-2.5">
            <FeatureRow
              emoji="📝"
              text={t(
                isHi,
                'Daily 6 practice questions, right in your chat.',
                'रोज़ के 6 अभ्यास प्रश्न, सीधे आपकी चैट में।',
              )}
            />
            <FeatureRow
              emoji="🙋"
              text={t(
                isHi,
                'Ask a doubt any time — get a CBSE-grounded answer.',
                'कभी भी doubt पूछें — CBSE आधारित जवाब पाएं।',
              )}
            />
            <FeatureRow
              emoji="📒"
              text={t(
                isHi,
                'Your mistakes become a revision notebook automatically.',
                'आपकी गलतियाँ अपने आप रिवीज़न नोटबुक बन जाती हैं।',
              )}
            />
          </ul>
        </div>

        {/* ─── State: idle / requesting ─── */}
        {(state.kind === 'idle' || state.kind === 'requesting') && (
          <button
            onClick={startLink}
            disabled={busy}
            className="w-full rounded-2xl py-3.5 text-base font-bold text-on-accent transition-opacity disabled:opacity-60"
            style={{ background: 'var(--accent-warm-strong)' }}
          >
            {busy
              ? t(isHi, 'Connecting…', 'कनेक्ट हो रहा है…')
              : t(isHi, 'Connect WhatsApp', 'WhatsApp कनेक्ट करें')}
          </button>
        )}

        {/* ─── State: success ─── */}
        {state.kind === 'success' && (
          <div
            className="rounded-2xl p-5 space-y-4"
            style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
          >
            <p className="text-sm leading-6" style={{ color: 'var(--text-2, #4b5563)' }}>
              {t(
                isHi,
                'Tap the button below to open WhatsApp and send the pre-filled message. That links your number.',
                'नीचे के बटन पर टैप करें — WhatsApp खुलेगा और पहले से लिखा मैसेज भेजें। इससे आपका नंबर लिंक हो जाएगा।',
              )}
            </p>

            {/* Big tap button → wa.me deep link (works on mobile app AND
                desktop WhatsApp Web; QR intentionally omitted — no QR lib
                in repo, graceful degradation per plan) */}
            <a
              href={state.data.deep_link}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-2xl py-3.5 text-center text-base font-bold text-foreground"
              style={{ background: '#25D366' }}
            >
              {t(isHi, 'Open WhatsApp', 'WhatsApp खोलें')}
            </a>

            {/* OTP with copy affordance */}
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-3, #9ca3af)' }}>
                {t(
                  isHi,
                  'Or send this code yourself as "LINK <code>":',
                  'या यह code खुद "LINK <code>" लिखकर भेजें:',
                )}
              </p>
              <div className="flex items-center gap-2">
                <span
                  className="flex-1 rounded-xl px-4 py-3 text-center text-xl font-bold tracking-[0.3em] font-mono select-all"
                  style={{
                    background: 'var(--surface-2, #f9fafb)',
                    border: '1px dashed var(--border, #e5e7eb)',
                    color: 'var(--purple, #7C3AED)',
                  }}
                  data-testid="whatsapp-link-otp"
                >
                  {state.data.otp}
                </span>
                <button
                  onClick={() => copyOtp(state.data.otp)}
                  className="shrink-0 rounded-xl px-3 py-3 text-sm font-semibold"
                  style={{
                    background: 'var(--surface-2, #f9fafb)',
                    border: '1px solid var(--border, #e5e7eb)',
                    color: copied ? '#16A34A' : 'var(--text-2, #4b5563)',
                  }}
                  aria-label={t(isHi, 'Copy OTP', 'OTP कॉपी करें')}
                >
                  {copied ? t(isHi, 'Copied ✓', 'कॉपी हुआ ✓') : t(isHi, 'Copy', 'कॉपी')}
                </button>
              </div>
            </div>

            {/* Expiry countdown */}
            <p
              className="text-xs text-center"
              style={{ color: secondsLeft <= 60 ? '#DC2626' : 'var(--text-3, #9ca3af)' }}
              role="timer"
              aria-live="polite"
            >
              {t(isHi, 'Code expires in', 'Code की समय-सीमा:')}{' '}
              <span className="font-mono font-bold">{formatMmSs(secondsLeft)}</span>
            </p>
          </div>
        )}

        {/* ─── State: expired ─── */}
        {state.kind === 'expired' && (
          <div
            className="rounded-2xl p-5 space-y-3 text-center"
            style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
          >
            <p className="text-sm" style={{ color: 'var(--text-2, #4b5563)' }}>
              {t(isHi, 'That code has expired.', 'यह code अब मान्य नहीं है।')}
            </p>
            <button
              onClick={startLink}
              className="w-full rounded-2xl py-3 text-sm font-bold text-on-accent"
              style={{ background: 'var(--accent-warm-strong)' }}
            >
              {t(isHi, 'Get a new code', 'नया code पाएं')}
            </button>
          </div>
        )}

        {/* ─── State: parental consent required (403) ─── */}
        {state.kind === 'consent_required' && (
          <div
            className="rounded-2xl p-5 space-y-3"
            style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
            role="alert"
          >
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-1, #111827)' }}>
              {t(isHi, 'Ask your parent first', 'पहले अपने माता-पिता से पूछें')}
            </h3>
            <p className="text-sm leading-6" style={{ color: 'var(--text-2, #4b5563)' }}>
              {t(
                isHi,
                'To use the WhatsApp Study Bot, your parent needs to give permission in their Alfanumrik parent account (Parent portal → Consent). Once they approve, come back here and tap Connect again.',
                'WhatsApp स्टडी बॉट इस्तेमाल करने के लिए आपके माता-पिता को अपने Alfanumrik पेरेंट खाते में अनुमति देनी होगी (Parent पोर्टल → Consent)। अनुमति मिलने के बाद यहाँ वापस आकर दोबारा Connect दबाएं।',
              )}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-3, #9ca3af)' }}>
              {t(isHi, 'Parents sign in at', 'माता-पिता यहाँ साइन इन करें:')}{' '}
              <Link href="/parent/consent" className="font-semibold" style={{ color: 'var(--orange, #E8581C)' }}>
                alfanumrik.com/parent/consent
              </Link>
            </p>
            <button
              onClick={startLink}
              className="w-full rounded-2xl py-3 text-sm font-bold"
              style={{
                background: 'var(--surface-2, #f9fafb)',
                border: '1px solid var(--border, #e5e7eb)',
                color: 'var(--text-1, #111827)',
              }}
            >
              {t(isHi, 'Try again', 'फिर कोशिश करें')}
            </button>
          </div>
        )}

        {/* ─── State: cooldown (429) ─── */}
        {state.kind === 'cooldown' && (
          <div
            className="rounded-2xl p-5 space-y-2 text-center"
            style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
            role="alert"
          >
            <p className="text-sm" style={{ color: 'var(--text-2, #4b5563)' }}>
              {t(
                isHi,
                'Too many attempts. You can try again in',
                'बहुत सारी कोशिशें हो गईं। फिर से कोशिश करें:',
              )}{' '}
              <span className="font-mono font-bold" role="timer" aria-live="polite">
                {formatMmSs(secondsLeft)}
              </span>
            </p>
          </div>
        )}

        {/* ─── State: generic error ─── */}
        {state.kind === 'error' && (
          <div
            className="rounded-2xl p-5 space-y-3 text-center"
            style={{ background: 'var(--surface-1, #fff)', border: '1px solid #FCA5A5' }}
            role="alert"
          >
            <p className="text-sm" style={{ color: '#DC2626' }}>
              {state.message}
            </p>
            <button
              onClick={startLink}
              className="w-full rounded-2xl py-3 text-sm font-bold text-on-accent"
              style={{ background: 'var(--accent-warm-strong)' }}
            >
              {t(isHi, 'Try again', 'फिर कोशिश करें')}
            </button>
          </div>
        )}

        {/* ─── Privacy footnote ─── */}
        <p className="text-xs leading-5 text-center px-2" style={{ color: 'var(--text-3, #9ca3af)' }}>
          {t(
            isHi,
            'We only use your WhatsApp number for study messages. You can disconnect any time by sending STOP.',
            'हम आपके WhatsApp नंबर का उपयोग सिर्फ़ पढ़ाई के मैसेज के लिए करते हैं। STOP भेजकर कभी भी डिस्कनेक्ट कर सकते हैं।',
          )}
        </p>
      </main>
    </div>
  );
}
