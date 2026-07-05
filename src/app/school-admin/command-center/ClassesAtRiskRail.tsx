'use client';

/**
 * ClassesAtRiskRail — Phase 3B Wave A. The paginated per-class risk rail of the
 * read-only School Command Center. Lazy-loaded via next/dynamic from
 * CommandCenter.tsx so its chunk only ships when the Command Center renders
 * (P10 bundle protection; flag-OFF never loads this chunk).
 *
 * Boundary discipline (frontend):
 *   - 100% read-only. No mutations, no business logic. Mastery / at-risk values
 *     are rendered verbatim from get_classes_at_risk (assessment owns them).
 *   - Rows are rendered in the ORDER the API returns (most-at-risk first).
 *   - `grade` is a STRING (P5) and may be null → render a dash.
 *   - `avg_mastery` may be null → render "—", never NaN.
 *   - P7 bilingual via the `isHi` prop.
 */

import type { ClassAtRiskRow } from '@/lib/school-admin/command-center-types';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

/** Format a 0..1 mastery fraction as a whole-percent string; null → "—". */
function masteryPct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export interface ClassesAtRiskRailProps {
  rows: ClassAtRiskRow[];
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

export default function ClassesAtRiskRail({
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
}: ClassesAtRiskRailProps) {
  const pageStart = rows.length > 0 ? offset + 1 : 0;
  const pageEnd = offset + rows.length;
  const canPrev = offset > 0;
  // A full page hints there may be more; a short page means we're at the end.
  const canNext = count >= limit;

  return (
    <section
      aria-label={tt(isHi, 'Classes at risk', 'जोखिम में कक्षाएँ')}
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4"
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-[var(--text-1)] font-['Sora',system-ui,sans-serif]">
          {tt(isHi, 'Classes at risk', 'जोखिम में कक्षाएँ')}
        </h3>
        {!loading && !error && rows.length > 0 && (
          <span className="text-[11px] text-[var(--text-3)]">
            {pageStart}–{pageEnd}
          </span>
        )}
      </header>

      {/* Loading */}
      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-12 rounded-xl bg-[var(--surface-2)] animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        /* Error */
        <div className="text-center py-8">
          <p className="text-sm text-[var(--text-2)] mb-3">
            {tt(
              isHi,
              "Couldn't load classes at risk.",
              'जोखिम वाली कक्षाएँ लोड नहीं हो सकीं।',
            )}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-on-accent bg-[var(--purple)] active:scale-95 transition-transform min-h-[44px]"
          >
            {tt(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        /* Empty */
        <div className="text-center py-8">
          <div className="text-3xl mb-2" aria-hidden="true">✅</div>
          <p className="text-sm font-semibold text-[var(--text-1)]">
            {tt(isHi, 'No classes at risk', 'कोई कक्षा जोखिम में नहीं')}
          </p>
          <p className="text-xs text-[var(--text-3)] mt-1">
            {tt(
              isHi,
              'Classes will appear here as students build a mastery signal.',
              'जैसे-जैसे छात्र प्रगति करेंगे, कक्षाएँ यहाँ दिखेंगी।',
            )}
          </p>
        </div>
      ) : (
        /* Data — vertical rail of class rows */
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.class_id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-1)] truncate">
                    {row.class_name}
                  </p>
                  <p className="text-[11px] text-[var(--text-3)] mt-0.5">
                    {tt(isHi, 'Grade', 'कक्षा')}{' '}
                    {row.grade ?? '—'} · {row.student_count}{' '}
                    {tt(isHi, 'students', 'छात्र')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`text-sm font-bold ${
                      row.at_risk_count > 0 ? 'text-danger' : 'text-[var(--text-2)]'
                    }`}
                  >
                    {row.at_risk_count}{' '}
                    <span className="text-[11px] font-medium text-[var(--text-3)]">
                      {tt(isHi, 'at risk', 'जोखिम में')}
                    </span>
                  </p>
                  <p className="text-[11px] text-[var(--text-3)] mt-0.5">
                    {tt(isHi, 'Avg', 'औसत')} {masteryPct(row.avg_mastery)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination — only when there's more than one page worth of data */}
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
