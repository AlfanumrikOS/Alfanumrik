'use client';

/**
 * Pedagogy v2 — Wave 3 Task 5
 * /synthesis — monthly synthesis ritual surface.
 *
 * Calls /api/synthesis/state which returns one of:
 *   - 404 (flag off) → soft fallback
 *   - { state: 'no_synthesis_yet' } → friendly waiting message
 *   - { state: 'ready', row } → render <SynthesisRitual/> + <ParentShareCard/>
 *
 * The lazy-fill of summary text happens server-side in /api/synthesis/state
 * (Task 4's Edge Function inserts rows with empty summaries; this route
 * generates the bilingual summary on first view via Claude). So by the
 * time the client gets `state: 'ready'` the summary is already filled
 * (or the fallback empty-string path rendered the "generating…" hint).
 *
 * Wave 3 v1 surface: the parent-share card is preview-only here — the
 * actual "Send via WhatsApp" wiring lands in Task 6.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import SynthesisRitual from '@alfanumrik/ui/synthesis/SynthesisRitual';
import ParentShareCard from '@alfanumrik/ui/synthesis/ParentShareCard';
import type { SynthesisBundle } from '@alfanumrik/lib/learn/monthly-synthesis-orchestrator';

interface SynthesisRow {
  id: string;
  synthesisMonth: string;
  bundle: SynthesisBundle;
  summaryTextEn: string;
  summaryTextHi: string;
  // 'flagged' added by item 4.5 (2026-07-21) — pre-send fabrication gate.
  parentShareStatus: 'pending' | 'sent' | 'opted_out' | 'failed' | 'suppressed' | 'flagged';
  parentShareSentAt: string | null;
  createdAt: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'flag_off' }
  | { kind: 'error' }
  | { kind: 'no_synthesis_yet' }
  | { kind: 'ready'; row: SynthesisRow };

export default function SynthesisPage() {
  const router = useRouter();
  const { isHi, isLoggedIn, isLoading } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (isLoading) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    setPhase({ kind: 'loading' });
    (async () => {
      try {
        const res = await fetch('/api/synthesis/state', { credentials: 'same-origin' });
        if (cancelled) return;
        // 404 means the feature is genuinely off (flag off, or no student
        // profile yet) — distinct from a real failure below.
        if (res.status === 404) {
          setPhase({ kind: 'flag_off' });
          return;
        }
        // Any other non-OK status (500, etc.) is a real failure, not a
        // disabled feature — show a retryable error state instead of the
        // "not available" copy.
        if (!res.ok) {
          setPhase({ kind: 'error' });
          return;
        }
        const data = await res.json() as
          | { state: 'no_synthesis_yet' }
          | { state: 'ready'; row: SynthesisRow };
        if (data.state === 'no_synthesis_yet') {
          setPhase({ kind: 'no_synthesis_yet' });
        } else {
          setPhase({ kind: 'ready', row: data.row });
        }
      } catch {
        // Network error or JSON parse failure — also a real failure, not a
        // disabled feature.
        if (!cancelled) setPhase({ kind: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [isLoading, isLoggedIn, router, retryTick]);

  if (phase.kind === 'loading') {
    return (
      <main className="app-container py-8" data-testid="synthesis-loading">
        <div className="h-32 rounded-3xl animate-pulse" style={{ background: 'var(--surface-2)' }} aria-hidden="true" />
      </main>
    );
  }

  if (phase.kind === 'flag_off') {
    return (
      <main className="app-container py-8" data-testid="synthesis-flag-off">
        <p className="text-sm text-[var(--text-2)]">
          {isHi ? 'यह सुविधा अभी उपलब्ध नहीं है।' : 'This feature is not available for you yet.'}
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-purple-700 underline">
          {isHi ? '← डैशबोर्ड' : '← Dashboard'}
        </Link>
      </main>
    );
  }

  if (phase.kind === 'error') {
    return (
      <main className="app-container py-8" data-testid="synthesis-error">
        <div
          className="rounded-2xl p-5 text-center max-w-lg"
          style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
          role="alert"
        >
          <div className="text-2xl mb-1" aria-hidden="true">⚠️</div>
          <p className="text-sm text-[var(--text-2)] mb-3">
            {isHi ? 'कुछ गलत हो गया। कृपया दोबारा कोशिश करें।' : 'Something went wrong. Please try again.'}
          </p>
          <button
            type="button"
            onClick={() => setRetryTick(t => t + 1)}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange,#E8581C)] focus-visible:ring-offset-2"
            style={{ background: 'var(--purple, #7C3AED)', minHeight: 44 }}
          >
            {isHi ? 'दोबारा कोशिश करें' : 'Retry'}
          </button>
        </div>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-purple-700 underline">
          {isHi ? '← डैशबोर्ड' : '← Dashboard'}
        </Link>
      </main>
    );
  }

  if (phase.kind === 'no_synthesis_yet') {
    return (
      <main className="app-container py-8 max-w-lg mx-auto" data-testid="synthesis-empty">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-purple-900" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'मासिक सारांश' : 'Monthly Synthesis'}
          </h1>
        </header>
        <p className="text-sm text-purple-700 mb-4">
          {isHi
            ? 'पहला सारांश इस महीने के अंत में आएगा। तब तक रोज़ाना अभ्यास और साप्ताहिक डाइव करते रहो।'
            : 'Your first synthesis lands at the end of this month. Until then, keep up the daily practice and weekly dives.'}
        </p>
        <Link href="/dashboard" className="inline-block text-sm text-purple-700 underline">
          {isHi ? '← डैशबोर्ड' : '← Dashboard'}
        </Link>
      </main>
    );
  }

  // ready
  return (
    <main className="app-container py-8 max-w-lg mx-auto space-y-4" data-testid="synthesis-ready">
      <header>
        <h1 className="text-2xl font-bold text-purple-900" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'महीना पूरा' : 'Month complete'}
        </h1>
      </header>

      <SynthesisRitual
        synthesisMonth={phase.row.synthesisMonth}
        bundle={phase.row.bundle}
        summaryTextEn={phase.row.summaryTextEn}
        summaryTextHi={phase.row.summaryTextHi}
      />

      <ParentShareCard
        synthesisRunId={phase.row.id}
        summaryTextEn={phase.row.summaryTextEn}
        summaryTextHi={phase.row.summaryTextHi}
        parentShareStatus={phase.row.parentShareStatus}
        parentShareSentAt={phase.row.parentShareSentAt}
        onSend={async () => {
          if (phase.kind !== 'ready') return;
          const res = await fetch('/api/synthesis/parent-share', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ synthesisRunId: phase.row.id }),
          });
          if (res.ok) {
            const data = await res.json() as { ok: true; sentAt?: string };
            setPhase({
              kind: 'ready',
              row: {
                ...phase.row,
                parentShareStatus: 'sent',
                parentShareSentAt: data.sentAt ?? new Date().toISOString(),
              },
            });
            return;
          }
          if (res.status === 403) {
            setPhase({
              kind: 'ready',
              row: { ...phase.row, parentShareStatus: 'opted_out' },
            });
            return;
          }
          setPhase({
            kind: 'ready',
            row: { ...phase.row, parentShareStatus: 'failed' },
          });
        }}
      />

      <Link href="/dashboard" className="inline-block text-sm text-purple-700 underline">
        {isHi ? '← डैशबोर्ड' : '← Dashboard'}
      </Link>
    </main>
  );
}
