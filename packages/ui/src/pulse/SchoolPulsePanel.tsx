'use client';

// src/components/pulse/SchoolPulsePanel.tsx
//
// The principal / institution_admin school lens over the FROZEN `SchoolPulse`
// contract.
//
// SLIMMED (2026-06-12, ops de-dup review): this panel NO LONGER renders the
// four overview tiles or its own classes-at-risk roster — both duplicated the
// host Command Center's OverviewStrip + ClassesAtRiskRail (same Phase 3B RPCs
// underneath ⇒ doubled load, and two at-risk lists that could disagree: the
// rail paginates while the Pulse snapshot is server-capped at the top-20
// most-at-risk classes). The page now ships exactly ONE overview strip and ONE
// roster; this panel is the genuinely NEW lens the page did not have:
//
//   - a one-line school Pulse summary: flagged-classes count + at-risk-student
//     total. These are DISPLAY-ONLY rollups of the contract's snapshot rows
//     (every addend renders verbatim elsewhere — no new domain math; backend /
//     assessment own the values). The host's paginated rail remains the
//     authoritative roster, reachable via the optional `atRiskHref` anchor.
//   - dataState (live ⇒ summary, no_data ⇒ empty state — never fabricated
//     numbers) + generatedAt freshness via timeAgo.
//
// Defensive 400 (multi-school caller without ?school_id): /api/pulse/school
// returns HTTP 400 with a school_ids hint; the SWR fetcher surfaces it as an
// Error carrying `.status`. That is NOT a transient failure — a Retry button
// would re-issue the same 400 forever (the "dead retry loop" from the ops
// review). We render a calm "select a school" state instead; the HOST owns
// school disambiguation (the Command Center picker).
//
// Owns its UI states (loading / error / select-a-school / empty / live).
// P7 bilingual via `isHi`. P13: only school-level counts render — no PII.

import type { SchoolPulse } from '@alfanumrik/lib/pulse/types';
import { tp, timeAgo } from './pulse-copy';

interface SchoolPulsePanelProps {
  school: SchoolPulse | null | undefined;
  isHi: boolean;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /**
   * Optional href (usually an in-page anchor) to the HOST page's authoritative
   * classes-at-risk roster (e.g. the Command Center's paginated
   * ClassesAtRiskRail). Omitted ⇒ the link row is not rendered.
   */
  atRiskHref?: string;
}

/** Narrow an unknown SWR error to an HTTP status, if the fetcher attached one. */
function errorStatus(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const s = (error as { status?: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return null;
}

const cardStyle = {
  background: 'var(--surface-1, #fff)',
  border: '1px solid var(--border, #e5e7eb)',
} as const;

export default function SchoolPulsePanel({
  school,
  isHi,
  isLoading = false,
  error,
  onRetry,
  atRiskHref,
}: SchoolPulsePanelProps) {
  // Multi-school 400 (no stale data) → "select a school", NEVER a retry loop:
  // retrying without a school_id re-issues the identical 400. The host page
  // (Command Center picker) owns the actual school selection.
  if (errorStatus(error) === 400 && !school) {
    return (
      <div className="rounded-2xl py-6 px-5 text-center" style={cardStyle} role="status">
        <div className="text-3xl mb-2" aria-hidden="true">
          🏫
        </div>
        <p className="text-sm font-semibold text-[var(--text-1)]">
          {tp(isHi, 'Select a school to view its Pulse', 'पल्स देखने के लिए एक स्कूल चुनें')}
        </p>
        <p className="text-xs text-[var(--text-3)] mt-1 max-w-xs mx-auto">
          {tp(
            isHi,
            'You administer more than one school — the Pulse shows one school at a time.',
            'आप एक से अधिक स्कूल संभालते हैं — पल्स एक समय में एक स्कूल दिखाता है।',
          )}
        </p>
      </div>
    );
  }

  // Hard error (no stale data) → retry. 4xx never reaches here as a loop:
  // the 400 branch above intercepts the only expected non-transient 4xx.
  if (error && !school) {
    return (
      <div className="rounded-2xl p-5 text-center" style={cardStyle} role="alert">
        <p className="text-sm text-[var(--text-2)] mb-3">
          {tp(isHi, "Couldn't load the school Pulse.", 'स्कूल पल्स लोड नहीं हो सका।')}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange,#F97316)] focus-visible:ring-offset-2"
            style={{ background: 'var(--purple, #7C3AED)', minHeight: 44 }}
          >
            {tp(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </button>
        )}
      </div>
    );
  }

  // Loading (no data yet) → one summary-card skeleton.
  if (isLoading && !school) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={tp(isHi, 'Loading school Pulse', 'स्कूल पल्स लोड हो रहा है')}
      >
        <div
          className="h-20 rounded-2xl animate-pulse"
          style={{ background: 'var(--surface-2, #eef2f6)' }}
        />
      </div>
    );
  }

  // Empty school (the contract's own dataState hint — never fabricate numbers).
  if (!school || school.dataState === 'no_data') {
    return (
      <div className="rounded-2xl py-8 px-5 text-center" style={cardStyle}>
        <div className="text-3xl mb-2" aria-hidden="true">
          🏫
        </div>
        <p className="text-sm font-semibold text-[var(--text-1)]">
          {tp(isHi, 'No school Pulse yet', 'अभी कोई स्कूल पल्स नहीं')}
        </p>
        <p className="text-xs text-[var(--text-3)] mt-1 max-w-xs mx-auto">
          {tp(
            isHi,
            'The school Pulse appears here once students start learning.',
            'जब छात्र सीखना शुरू करेंगे, तब स्कूल पल्स यहाँ दिखेगा।',
          )}
        </p>
      </div>
    );
  }

  // Live summary. Display-only rollups of the contract's snapshot rows (the
  // server caps the snapshot at the top-20 most-at-risk classes; the host's
  // paginated rail is the authoritative roster for the full list).
  const { classesAtRisk } = school;
  const flaggedClasses = classesAtRisk.filter((r) => r.atRiskCount > 0).length;
  const atRiskStudents = classesAtRisk.reduce((sum, r) => sum + r.atRiskCount, 0);
  const allClear = flaggedClasses === 0;
  // Same presentation convention as the host rail: red when any class carries
  // risk, green when clear. (Severity-band definitions stay with ops.)
  const accent = allClear ? '#16A34A' : '#DC2626';

  return (
    <div className="rounded-2xl p-4" style={cardStyle}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-center gap-2.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: accent }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--text-1)]">
              {allClear
                ? tp(isHi, 'All clear — no classes flagged at risk', 'सब ठीक — कोई कक्षा जोखिम में नहीं')
                : tp(
                    isHi,
                    `${flaggedClasses} ${flaggedClasses === 1 ? 'class' : 'classes'} flagged at risk`,
                    `${flaggedClasses} ${flaggedClasses === 1 ? 'कक्षा' : 'कक्षाएँ'} जोखिम में`,
                  )}
            </p>
            {!allClear && (
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                {tp(
                  isHi,
                  `${atRiskStudents} student${atRiskStudents === 1 ? '' : 's'} at risk across flagged classes`,
                  `चिह्नित कक्षाओं में ${atRiskStudents} छात्र जोखिम में`,
                )}
              </p>
            )}
          </div>
        </div>
        {atRiskHref && !allClear && (
          <a
            href={atRiskHref}
            className="inline-flex items-center px-3 py-2 rounded-xl text-xs font-semibold text-[var(--text-2)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--purple,#7C3AED)] active:scale-[0.98] transition-all min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange,#F97316)] focus-visible:ring-offset-2"
          >
            {tp(isHi, 'View classes at risk', 'जोखिम वाली कक्षाएँ देखें')} ↑
          </a>
        )}
      </div>

      {/* Freshness footer — dataState is 'live' on this branch by construction. */}
      <p
        className="text-[11px] text-[var(--text-3)] mt-3 pt-3 border-t flex items-center gap-1.5"
        style={{ borderColor: 'var(--border, #e5e7eb)' }}
      >
        <span aria-hidden="true" style={{ color: '#16A34A' }}>
          ●
        </span>
        {tp(isHi, 'Live', 'लाइव')} · {tp(isHi, 'Updated', 'अपडेट')}{' '}
        {timeAgo(school.generatedAt, isHi)}
      </p>
    </div>
  );
}
