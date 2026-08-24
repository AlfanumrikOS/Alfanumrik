'use client';

/**
 * /hpc — NEP 2020 Holistic Progress Card.
 *
 * WHY THIS PAGE WAS REBUILT (2026-08-24, CEO defect #12)
 * -----------------------------------------------------
 * It did not load. Three independent causes, all fixed here:
 *
 * 1. DOUBLE COMPUTE. The page fired `generate_hpc` and then `get_hpc`
 *    sequentially. Both actions run the SAME `generateHPC()` fan-out in
 *    `supabase/functions/nep-compliance/index.ts`, and `generate_hpc`
 *    persists nothing (there is a literal `// TODO: Store generated HPC in a
 *    nep_hpc_reports table for caching` at :521). So every page view paid for
 *    the whole multi-table fan-out TWICE. Now: `get_hpc` only; `generate_hpc`
 *    fires ONLY if `get_hpc` came back without a report — which is the
 *    forward-compatible shape for when the caching table lands.
 *
 * 2. A 10s CLIENT TIMEOUT. `usePortalFetch` defaults `timeoutMs` to 10000 and
 *    this page never overrode it, so the doubled fan-out aborted, threw, and
 *    fell into the error branch. It now passes an explicit 30s budget through
 *    `usePortalAction`'s third argument.
 *
 * 3. FAIL-HARD RENDER. `if (!hpc || hpc.error)` replaced the ENTIRE card with
 *    a red line, so one missing sub-read blanked a student's whole progress
 *    card. Rendering is now per-section: a section with no data says so, and
 *    the rest of the card still paints. Loading / error / empty stay three
 *    DISTINCT states — an error never renders as an empty state.
 *
 * Also: the page was hardcoded dark (`#0B1120`) with raw hex throughout and no
 * shell, so it looked broken next to every other student surface. It now uses
 * `AppShell` + the shared semantic tokens, and every string is bilingual (P7).
 *
 * STILL OUTSTANDING (handed off, NOT done here): the edge function's caching
 * TODO. Persisting the report needs a new table + RLS, i.e. a migration, which
 * is architect-owned. Steps 1-3 above make the page load without it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { usePortalAction } from '@alfanumrik/lib/usePortalFetch';
import { AppShell } from '@alfanumrik/ui/responsive';
import { ACCENT_SURFACE, ON_ACCENT } from '@alfanumrik/ui/dashboard/os/palette';

/**
 * The report body (all six sections + their presentational primitives + the
 * fuller palette import) is real weight that is only ever needed AFTER data
 * has already loaded — never during the loading/error/empty states. Loading
 * it on demand instead of unconditionally keeps it out of `/hpc`'s route
 * first-load JS (P10 ratchet fix, 2026-08-24; see `HpcReportBody.tsx`'s own
 * header comment for the full rationale). `ssr: false` is safe here — this
 * whole page is already `'use client'` and client-only rendered.
 */
const HpcReportBody = dynamic(() => import('./HpcReportBody'), {
  ssr: false,
  loading: () => (
    <div className="space-y-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-3xl animate-pulse"
          style={{ height: 132, background: 'var(--surface-2)' }}
          aria-hidden="true"
        />
      ))}
    </div>
  ),
});

/**
 * 30s. The nep-compliance fan-out reads students + learning profiles + concept
 * mastery + quiz sessions + notes + achievements and derives six sections from
 * them; 10s was not a realistic budget even before the double-compute fix, and
 * the abort is what produced "Failed to load HPC" in production.
 */
const HPC_TIMEOUT_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────────────

type HpcPayload = Record<string, unknown>;

type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'ready'; hpc: HpcPayload };

/**
 * Section keys the backend emits. Presence of ANY ONE of them means we have a
 * report worth rendering — deliberately not "all of them", because partial is
 * exactly the case this page must survive.
 */
const REPORT_KEYS = [
  'student',
  'subject_performance',
  'bloom_distribution',
  'competency_levels',
  'learning_behaviors',
  'holistic_indicators',
  'cbse_readiness',
  'portfolio_highlights',
] as const;

function hasReport(value: unknown): value is HpcPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = value as HpcPayload;
  if (typeof o.error === 'string' && o.error.trim() !== '') return false;
  return REPORT_KEYS.some((k) => o[k] != null);
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HPCPage() {
  const { student, isLoading: authLoading, isLoggedIn, isHi } = useAuth();
  const nepApi = usePortalAction('/functions/v1/nep-compliance', isHi, HPC_TIMEOUT_MS);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [retryTick, setRetryTick] = useState(0);
  // Pedagogy v2 Wave 3 — recent monthly synthesis chip. null when flag off,
  // no synthesis yet, or fetch failed.
  const [synthesisChip, setSynthesisChip] = useState<{ month: string } | null>(null);

  const studentId = student?.id || '';

  useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, router]);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    (async () => {
      setPhase({ kind: 'loading' });
      try {
        // ONE read. `generate_hpc` is a fallback, not a prelude — calling both
        // ran the identical fan-out twice for zero benefit (it persists
        // nothing today) and is what blew the client timeout.
        let data: unknown = await nepApi('get_hpc', { student_id: studentId });

        if (!hasReport(data)) {
          await nepApi('generate_hpc', { student_id: studentId });
          data = await nepApi('get_hpc', { student_id: studentId });
        }

        if (cancelled) return;

        if (hasReport(data)) {
          setPhase({ kind: 'ready', hpc: data });
        } else if (
          data && typeof data === 'object' &&
          typeof (data as HpcPayload).error === 'string'
        ) {
          // Backend said it failed → ERROR, never "empty".
          setPhase({ kind: 'error' });
        } else {
          setPhase({ kind: 'empty' });
        }
      } catch {
        // Includes the 30s abort. Raw backend messages are deliberately not
        // rendered to the student (P13 + they are internal strings).
        if (!cancelled) setPhase({ kind: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [nepApi, studentId, retryTick]);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/synthesis/state', { credentials: 'same-origin' });
        if (cancelled) return;
        if (!res.ok) { setSynthesisChip(null); return; }
        const body = await res.json() as
          | { state: 'no_synthesis_yet' }
          | { state: 'ready'; row: { synthesisMonth: string } };
        if (body.state === 'ready') setSynthesisChip({ month: body.row.synthesisMonth });
        else setSynthesisChip(null);
      } catch {
        if (!cancelled) setSynthesisChip(null);
      }
    })();
    return () => { cancelled = true; };
  }, [studentId]);

  const shell = useCallback(
    (children: React.ReactNode) => (
      <AppShell
        variant="mobile"
        header={
          <div className="page-header-inner flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="flex-shrink-0 min-h-tap-min inline-flex items-center"
              style={{ color: 'var(--text-3)' }}
              aria-label={isHi ? 'डैशबोर्ड पर वापस' : 'Back to dashboard'}
            >
              ←
            </button>
            <span
              className="text-fluid-base font-bold truncate min-w-0"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
            >
              {isHi ? 'समग्र प्रगति कार्ड' : 'Holistic Progress Card'}
            </span>
          </div>
        }
      >
        <div className="app-container py-6 max-w-2xl mx-auto space-y-4">{children}</div>
      </AppShell>
    ),
    [isHi, router],
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase.kind === 'loading') {
    return shell(
      <div className="space-y-4" data-testid="hpc-loading" aria-busy="true">
        <p className="text-fluid-xs" style={{ color: 'var(--text-3)' }} role="status">
          {isHi ? 'समग्र प्रगति कार्ड तैयार हो रहा है…' : 'Building your Holistic Progress Card…'}
        </p>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-3xl animate-pulse"
            style={{ height: 132, background: 'var(--surface-2)' }}
            aria-hidden="true"
          />
        ))}
      </div>,
    );
  }

  // ── Error (distinct from empty) ────────────────────────────────────────────
  if (phase.kind === 'error') {
    return shell(
      <div
        className="rounded-3xl p-6 text-center"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        role="alert"
        data-testid="hpc-error"
      >
        <span className="text-3xl" aria-hidden="true">⚠️</span>
        <p className="text-fluid-sm font-bold mt-2" style={{ color: 'var(--text-2)' }}>
          {isHi ? 'प्रगति कार्ड लोड नहीं हो सका' : 'Could not load your progress card'}
        </p>
        <p className="text-fluid-xs mt-1 mb-4" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'कनेक्शन जाँचो और दोबारा कोशिश करो।' : 'Check your connection and try again.'}
        </p>
        <button
          type="button"
          onClick={() => setRetryTick((t) => t + 1)}
          data-testid="hpc-retry"
          className="inline-flex items-center justify-center min-h-tap-comfort px-5 py-2.5 rounded-xl text-fluid-xs font-bold active:scale-[0.98] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ background: ACCENT_SURFACE, color: ON_ACCENT }}
        >
          {isHi ? 'दोबारा कोशिश करें' : 'Try again'}
        </button>
      </div>,
    );
  }

  // ── Empty (backend answered, there is genuinely nothing yet) ───────────────
  if (phase.kind === 'empty') {
    return shell(
      <div
        className="rounded-3xl p-6 text-center"
        style={{ background: 'var(--surface-1)', border: '1px dashed var(--border)' }}
        data-testid="hpc-empty"
      >
        <span className="text-3xl" aria-hidden="true">📋</span>
        <p className="text-fluid-sm font-bold mt-2" style={{ color: 'var(--text-2)' }}>
          {isHi ? 'अभी कार्ड बनाने के लिए कुछ नहीं है' : 'Nothing to put on the card yet'}
        </p>
        <p className="text-fluid-xs mt-1" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'कुछ क्विज़ पूरे करो — तुम्हारा पहला प्रगति कार्ड अपने आप बन जाएगा।'
            : 'Finish a few quizzes and your first progress card builds itself.'}
        </p>
      </div>,
    );
  }

  // ── Ready — per-section, fail-soft ─────────────────────────────────────────
  // All section rendering lives in the dynamically-imported `HpcReportBody`
  // (see the `dynamic()` call above) — nothing to derive here, the report is
  // only real weight once data exists to show, so it stays out of this
  // route's first-load JS.
  return shell(
    <HpcReportBody
      hpc={phase.hpc}
      isHi={isHi}
      synthesisChip={synthesisChip}
      onOpenSynthesis={() => router.push('/synthesis')}
    />,
  );
}
