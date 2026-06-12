'use client';

// src/components/pulse/StudentPulseList.tsx
//
// The class/school roster view: one lightweight row per student, status +
// compact signals, sorted worst-first. The server already returns the rows
// worst-first (`ClassPulseResponse.students`), so this component preserves the
// incoming order and only PRESENTS it. Each row links to the single-student
// detail surface so a teacher/principal can drill in.
//
// Used by:
//   - Teacher class surface → `useClassPulse(classId).data.students`.
//   - Principal school surface → built from the school overview + classes-at-risk
//     (the host maps those rows into this list's row shape if it wants a roster).
//
// Owns its three UI states (loading / error / empty). P7 bilingual via `isHi`.
// Accessible: each row is a keyboard-focusable link; signals use colour + icon +
// text (never colour-alone). P13: only the roster name + derived signals render
// (all already authorized to the viewer).

import Link from 'next/link';
import type { PulseListItem } from '@/lib/pulse/types';
import {
  statusToken,
  tp,
  type PulseVariant,
} from './pulse-copy';
import PulseSignals from './PulseSignals';

interface StudentPulseListProps {
  students: PulseListItem[] | undefined;
  isHi: boolean;
  /** Tone for the signal chips (teacher/principal = actionable). */
  variant: PulseVariant;
  /** Build the detail href for a row. Default → /teacher/students?student=<id>. */
  hrefForStudent?: (item: PulseListItem) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Optional cap (e.g. show only the worst N on a dense dashboard). */
  max?: number;
}

function ListSkeleton({ isHi }: { isHi: boolean }) {
  return (
    <div
      className="space-y-2"
      role="status"
      aria-busy="true"
      aria-label={tp(isHi, 'Loading roster', 'सूची लोड हो रही है')}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 rounded-xl animate-pulse"
          style={{ background: 'var(--surface-2, #eef2f6)' }}
        />
      ))}
      <span className="sr-only">{tp(isHi, 'Loading…', 'लोड हो रहा है…')}</span>
    </div>
  );
}

function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className="text-[11px] font-semibold" style={{ color }}>
        {label}
      </span>
    </span>
  );
}

export default function StudentPulseList({
  students,
  isHi,
  variant,
  hrefForStudent,
  isLoading = false,
  error,
  onRetry,
  max,
}: StudentPulseListProps) {
  if (error && !students) {
    return (
      <div
        className="rounded-2xl p-5 text-center"
        style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
        role="alert"
      >
        <p className="text-sm text-[var(--text-2)] mb-3">
          {tp(isHi, "Couldn't load the roster Pulse.", 'सूची पल्स लोड नहीं हो सकी।')}
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

  if (isLoading && !students) {
    return <ListSkeleton isHi={isHi} />;
  }

  const rows = (students ?? []).slice(0, max ?? students?.length ?? 0);

  if (rows.length === 0) {
    return (
      <div
        className="rounded-2xl py-8 px-5 text-center"
        style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e7eb)' }}
      >
        <div className="text-3xl mb-2" aria-hidden="true">
          🙌
        </div>
        <p className="text-sm font-semibold text-[var(--text-1)]">
          {tp(isHi, 'No students to triage', 'कोई छात्र नहीं')}
        </p>
        <p className="text-xs text-[var(--text-3)] mt-1">
          {tp(isHi, 'Everyone is on track — nothing needs attention.', 'सब पटरी पर हैं — किसी पर ध्यान देने की ज़रूरत नहीं।')}
        </p>
      </div>
    );
  }

  const defaultHref = (item: PulseListItem) =>
    `/teacher/students?student=${encodeURIComponent(item.studentId)}`;

  return (
    <ul className="space-y-2" aria-label={tp(isHi, 'Student Pulse roster', 'छात्र पल्स सूची')}>
      {rows.map((item) => {
        const st = statusToken(item.status, isHi, variant);
        const href = (hrefForStudent ?? defaultHref)(item);
        return (
          <li key={item.studentId}>
            <Link
              href={href}
              className="block rounded-xl p-3 transition-all hover:shadow-md active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange,#F97316)] focus-visible:ring-offset-2"
              style={{
                background: 'var(--surface-1, #fff)',
                border: `1px solid ${st.color}33`,
                minHeight: 44,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-base" aria-hidden="true">
                    {st.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-1)] truncate">
                      {item.displayName}
                    </div>
                    <div className="text-[11px] text-[var(--text-3)]">
                      {item.grade
                        ? tp(isHi, `Grade ${item.grade}`, `कक्षा ${item.grade}`)
                        : tp(isHi, 'Grade —', 'कक्षा —')}
                      {item.totalAtRiskChapters > 0 && (
                        <span style={{ color: '#DC2626' }}>
                          {' · '}
                          {tp(
                            isHi,
                            `${item.totalAtRiskChapters} at risk`,
                            `${item.totalAtRiskChapters} जोखिम में`,
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <StatusDot color={st.color} label={st.label} />
              </div>

              <div className="mt-2">
                <PulseSignals
                  signals={item.signals}
                  isHi={isHi}
                  variant={variant}
                  compact
                />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
