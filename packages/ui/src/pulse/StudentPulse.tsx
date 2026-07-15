'use client';

// src/components/pulse/StudentPulse.tsx
//
// The shared single-student Pulse detail view, used by all four lenses. It
// composes the four sub-cards (status / signals / mastery / timeline) and owns
// the three required UI states: loading (skeleton), error (retry), empty
// (unknown / no-data). The DATA comes verbatim from the frozen contract
// (`PulseResponse`) handed in by the host surface — this component never
// fetches; the host passes the SWR result through.
//
// `variant` controls tone + which affordances show:
//   - 'student'   → encouraging copy, no triage actions.
//   - 'parent'    → warm, child-focused copy.
//   - 'teacher' / 'principal' → neutral, actionable triage copy.
//
// P7 bilingual via `isHi`. usePermissions gating is the HOST'S job (this is a
// dumb presentational shell). P13: only contract-derived, non-PII values render.

import type { PulseResponse } from '@alfanumrik/lib/pulse/types';
import { tp, type PulseVariant } from './pulse-copy';
import PulseStatusCard, { type PulseVitals } from './PulseStatusCard';
import PulseSignals from './PulseSignals';
import PulseMasterySummary from './PulseMasterySummary';
import PulseTimeline from './PulseTimeline';

interface StudentPulseProps {
  variant: PulseVariant;
  isHi: boolean;
  /** The contract payload (unwrapped `.data` from the Pulse SWR hook). */
  pulse: PulseResponse | null | undefined;
  /** SWR loading flag. */
  isLoading?: boolean;
  /** SWR error (any truthy value renders the error state). */
  error?: unknown;
  /** Optional headline name (child/student name for non-self lenses). */
  displayName?: string;
  /** Optional vitals strip (XP/level/streak/live) — typically self lens only. */
  vitals?: PulseVitals;
  /** Retry handler wired to the host SWR `mutate()` for the error state. */
  onRetry?: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-1.5">
      {children}
    </h4>
  );
}

function PulseSkeleton({ isHi }: { isHi: boolean }) {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-busy="true"
      aria-label={tp(isHi, 'Loading Pulse', 'पल्स लोड हो रहा है')}
    >
      <div
        className="h-28 rounded-2xl animate-pulse"
        style={{ background: 'var(--surface-2, #eef2f6)' }}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-14 rounded-xl animate-pulse"
            style={{ background: 'var(--surface-2, #eef2f6)' }}
          />
        ))}
      </div>
      <div
        className="h-24 rounded-xl animate-pulse"
        style={{ background: 'var(--surface-2, #eef2f6)' }}
      />
      <span className="sr-only">{tp(isHi, 'Loading…', 'लोड हो रहा है…')}</span>
    </div>
  );
}

function PulseError({
  isHi,
  onRetry,
}: {
  isHi: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-2xl p-5 text-center"
      style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
      role="alert"
    >
      <div className="text-2xl mb-1" aria-hidden="true">
        🩺
      </div>
      <p className="text-sm text-[var(--text-2)] mb-3">
        {tp(isHi, "Couldn't load the Pulse.", 'पल्स लोड नहीं हो सका।')}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange,#E8581C)] focus-visible:ring-offset-2"
          style={{ background: 'var(--purple, #7C3AED)', minHeight: 44 }}
        >
          {tp(isHi, 'Retry', 'दोबारा कोशिश करें')}
        </button>
      )}
    </div>
  );
}

export default function StudentPulse({
  variant,
  isHi,
  pulse,
  isLoading = false,
  error,
  displayName,
  vitals,
  onRetry,
}: StudentPulseProps) {
  // Error wins over a stale payload (SWR keepPreviousData may hold old data).
  if (error && !pulse) {
    return <PulseError isHi={isHi} onRetry={onRetry} />;
  }

  // Loading with no data yet → skeleton.
  if (isLoading && !pulse) {
    return <PulseSkeleton isHi={isHi} />;
  }

  // No data at all (and not loading) → empty state.
  if (!pulse) {
    return (
      <div
        className="rounded-2xl p-5 text-center"
        style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
      >
        <div className="text-3xl mb-2" aria-hidden="true">
          🌱
        </div>
        <p className="text-sm font-semibold text-[var(--text-1)]">
          {tp(isHi, 'No Pulse yet', 'अभी कोई पल्स नहीं')}
        </p>
        <p className="text-xs text-[var(--text-3)] mt-1 max-w-xs mx-auto">
          {variant === 'student'
            ? tp(isHi, 'Take a quiz and your Pulse will appear here.', 'एक क्विज़ लो और तुम्हारा पल्स यहाँ दिखेगा।')
            : tp(isHi, 'Not enough recent activity to build a Pulse.', 'पल्स बनाने के लिए पर्याप्त हाल की गतिविधि नहीं।')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PulseStatusCard
        pulse={pulse}
        isHi={isHi}
        variant={variant}
        displayName={displayName}
        vitals={vitals}
      />

      <div>
        <SectionLabel>{tp(isHi, 'Signals', 'संकेत')}</SectionLabel>
        <PulseSignals signals={pulse.signals} isHi={isHi} variant={variant} />
      </div>

      <div>
        <SectionLabel>{tp(isHi, 'Mastery', 'महारत')}</SectionLabel>
        <PulseMasterySummary masterySummary={pulse.masterySummary} isHi={isHi} />
      </div>

      <div>
        <SectionLabel>{tp(isHi, 'Recent activity', 'हाल की गतिविधि')}</SectionLabel>
        <PulseTimeline timeline={pulse.timeline} isHi={isHi} variant={variant} />
      </div>
    </div>
  );
}
