'use client';

/**
 * TeacherEngagementTable — Phase 3B Wave A. The paginated per-teacher engagement
 * table of the read-only School Command Center. Lazy-loaded via next/dynamic
 * from CommandCenter.tsx so its chunk only ships when the Command Center renders
 * (P10 bundle protection; flag-OFF never loads this chunk).
 *
 * Boundary discipline (frontend):
 *   - 100% read-only. No mutations, no business logic. Counts are rendered
 *     verbatim from get_teacher_engagement.
 *   - Rows are rendered in the ORDER the API returns (most-assigned first).
 *   - P7 bilingual via the `isHi` prop.
 */

import type { TeacherEngagementRow } from '@/lib/school-admin/command-center-types';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export interface TeacherEngagementTableProps {
  rows: TeacherEngagementRow[];
  loading: boolean;
  error: boolean;
  isHi: boolean;
  /** Current page window (echoed by the API). */
  limit: number;
  offset: number;
  /** Rows on THIS page (rows.length). Drives the "next" affordance. */
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onRetry: () => void;
}

export default function TeacherEngagementTable({
  rows,
  loading,
  error,
  isHi,
  limit,
  offset,
  count,
  onPrev,
  onNext,
  onRetry,
}: TeacherEngagementTableProps) {
  const pageStart = rows.length > 0 ? offset + 1 : 0;
  const pageEnd = offset + rows.length;
  const canPrev = offset > 0;
  const canNext = count >= limit;

  return (
    <section
      aria-label={tt(isHi, 'Teacher engagement', 'शिक्षक सहभागिता')}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4"
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">
          {tt(isHi, 'Teacher engagement', 'शिक्षक सहभागिता')}
        </h3>
        {!loading && !error && rows.length > 0 && (
          <span className="text-[11px] text-[var(--text-3)]">
            {pageStart}–{pageEnd}
          </span>
        )}
      </header>

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-11 rounded-xl bg-[var(--surface-2)] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-sm text-[var(--text-2)] mb-3">
            {tt(
              isHi,
              "Couldn't load teacher engagement.",
              'शिक्षक सहभागिता लोड नहीं हो सकी।',
            )}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[var(--purple,#7C3AED)] active:scale-95 transition-transform min-h-[44px]"
          >
            {tt(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2" aria-hidden="true">📭</div>
          <p className="text-sm font-semibold text-[var(--text-1)]">
            {tt(isHi, 'No teacher activity yet', 'अभी कोई शिक्षक गतिविधि नहीं')}
          </p>
          <p className="text-xs text-[var(--text-3)] mt-1">
            {tt(
              isHi,
              'Engagement appears once teachers start assigning remediation.',
              'जब शिक्षक रिमेडिएशन सौंपना शुरू करेंगे तो सहभागिता दिखेगी।',
            )}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left">
                <th className="py-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                  {tt(isHi, 'Teacher', 'शिक्षक')}
                </th>
                <th className="py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)] text-center">
                  {tt(isHi, 'Classes', 'कक्षाएँ')}
                </th>
                <th className="py-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)] text-center">
                  {tt(isHi, 'Assigned', 'सौंपा')}
                </th>
                <th className="py-2 pl-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)] text-center">
                  {tt(isHi, 'Resolved', 'हल')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.teacher_id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2.5 pr-3 font-semibold text-[var(--text-1)]">
                    {row.teacher_name}
                  </td>
                  <td className="py-2.5 px-2 text-center text-[var(--text-2)] tabular-nums">
                    {row.class_count}
                  </td>
                  <td className="py-2.5 px-2 text-center text-[var(--text-2)] tabular-nums">
                    {row.remediation_assigned_count}
                  </td>
                  <td className="py-2.5 pl-2 text-center font-semibold tabular-nums text-emerald-600">
                    {row.remediation_resolved_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (canPrev || canNext) && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onPrev}
            disabled={!canPrev}
            className="px-3 py-2 rounded-lg text-xs font-semibold text-[var(--text-2)] bg-[var(--surface-2)] border border-[var(--border)] disabled:opacity-40 disabled:cursor-default min-h-[44px]"
          >
            ← {tt(isHi, 'Previous', 'पिछला')}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canNext}
            className="px-3 py-2 rounded-lg text-xs font-semibold text-[var(--text-2)] bg-[var(--surface-2)] border border-[var(--border)] disabled:opacity-40 disabled:cursor-default min-h-[44px]"
          >
            {tt(isHi, 'Next', 'अगला')} →
          </button>
        </div>
      )}
    </section>
  );
}
