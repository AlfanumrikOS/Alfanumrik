'use client';

/**
 * GradingQueue — Phase 3A Wave B grading-queue surface (lazy-loaded for P10).
 *
 * A dense, oldest-first list of submissions awaiting grading ACROSS every
 * assignment the teacher owns. Data comes from the `get_grading_queue`
 * teacher-dashboard Edge action (fetched by the parent Command Center) and is
 * passed in as `items` — this component is pure presentation so it stays
 * trivially testable and tree-shakeable out of the flag-OFF bundle.
 *
 * Boundary discipline (frontend):
 *   - NO grading/scoring logic lives here. `auto_score` is rendered verbatim
 *     from the Edge response (assessment owns the number); P1/P2 untouched.
 *   - `needs_review_reason` is an additive exception SIGNAL only — it renders an
 *     amber "exception chip" so a teacher triages anomalies first. It never
 *     changes a score.
 *   - One-tap a row → the parent navigates to the EXISTING /teacher/submissions
 *     review (get_submission_detail + mark_submission_reviewed). We do NOT
 *     rebuild grading UI here.
 *   - P7 bilingual via the `isHi` prop. P13 no PII in client logs (this
 *     component logs nothing).
 */

import { useMemo } from 'react';

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export interface GradingQueueItem {
  submission_id: string;
  assignment_id: string;
  assignment_title: string;
  student_id: string;
  student_name: string;
  submitted_at: string | null;
  question_count: number;
  auto_score: number | null;
  needs_review_reason: 'all_same_answer' | 'too_fast' | null;
}

function formatDate(iso: string | null, isHi: boolean): string {
  if (!iso) return tt(isHi, 'No date', 'कोई तिथि नहीं');
  try {
    return new Date(iso).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Exception chip — visually distinct (amber) so anomalies sort to the eye. */
function ExceptionChip({
  reason,
  isHi,
}: {
  reason: 'all_same_answer' | 'too_fast';
  isHi: boolean;
}) {
  const label =
    reason === 'all_same_answer'
      ? tt(isHi, 'All same answer', 'सभी उत्तर समान')
      : tt(isHi, 'Very fast', 'बहुत तेज़');
  return (
    <span
      data-testid={`exception-chip-${reason}`}
      title={tt(isHi, 'Review this submission first', 'इस सबमिशन की पहले समीक्षा करें')}
      className="inline-flex items-center gap-1 py-0.5 px-2 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/40 whitespace-nowrap"
    >
      <span aria-hidden="true">&#9888;</span>
      {label}
    </span>
  );
}

export default function GradingQueue({
  items,
  count,
  loading,
  error,
  isHi,
  onOpenRow,
  onRetry,
  onClose,
}: {
  items: GradingQueueItem[];
  count: number;
  loading: boolean;
  error: boolean;
  isHi: boolean;
  onOpenRow: (item: GradingQueueItem) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  // Exceptions first within the oldest-first ordering already applied by the
  // Edge action — the server returns FIFO; we only hoist anomalies so a teacher
  // triages them up front without re-sorting the whole backlog.
  const ordered = useMemo(() => {
    const flagged = items.filter((i) => i.needs_review_reason != null);
    const rest = items.filter((i) => i.needs_review_reason == null);
    return [...flagged, ...rest];
  }, [items]);

  return (
    <div className="td-card" data-testid="grading-queue">
      <div className="td-card-head">
        <h3>{tt(isHi, 'Grading queue', 'ग्रेडिंग कतार')}</h3>
        <div className="flex items-center gap-2">
          {!loading && !error && (
            <span className="td-badge" data-testid="grading-queue-count">
              {count} {tt(isHi, 'awaiting', 'लंबित')}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="py-1 px-2.5 bg-transparent text-slate-400 border border-slate-700 rounded-md text-[11px] font-medium cursor-pointer hover:border-indigo-500"
          >
            {tt(isHi, 'Close', 'बंद करें')}
          </button>
        </div>
      </div>

      <div className="mt-3.5">
        {loading ? (
          // Loading
          <div className="h-32 rounded-lg bg-slate-800/50 animate-pulse" aria-hidden="true" />
        ) : error ? (
          // Error
          <div className="text-center py-8 text-slate-500" data-testid="grading-queue-error">
            <div className="text-3xl mb-3">&#x1F615;</div>
            <p className="text-[14px] font-medium text-slate-400 mb-3">
              {tt(isHi, "Couldn't load the grading queue", 'ग्रेडिंग कतार लोड नहीं हो सकी')}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="py-2 px-5 bg-indigo-500 text-white border-none rounded-lg text-[13px] font-semibold cursor-pointer"
            >
              {tt(isHi, 'Retry', 'पुनः प्रयास करें')}
            </button>
          </div>
        ) : ordered.length === 0 ? (
          // Empty
          <div className="text-center py-8 text-slate-500" data-testid="grading-queue-empty">
            <span className="text-emerald-500 text-2xl block mb-2">&#x2713;</span>
            <p className="text-[14px] font-medium text-slate-400 mb-1">
              {tt(isHi, 'Nothing to grade', 'ग्रेड करने के लिए कुछ नहीं')}
            </p>
            <p className="text-[13px] text-slate-600">
              {tt(
                isHi,
                'All submitted work has been reviewed. New submissions appear here.',
                'सभी सबमिट किया गया कार्य समीक्षित है। नए सबमिशन यहाँ दिखेंगे।',
              )}
            </p>
          </div>
        ) : (
          // List (dense, oldest-first; exceptions hoisted)
          <div className="flex flex-col gap-2" data-testid="grading-queue-list">
            {ordered.map((item) => (
              <button
                key={item.submission_id}
                type="button"
                onClick={() => onOpenRow(item)}
                data-testid="grading-queue-row"
                className={`text-left w-full bg-slate-800 rounded-lg py-2.5 px-3 border cursor-pointer transition-colors hover:border-indigo-500 ${
                  item.needs_review_reason ? 'border-amber-500/40' : 'border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-semibold text-slate-100 truncate">
                        {item.assignment_title}
                      </span>
                      {item.needs_review_reason && (
                        <ExceptionChip reason={item.needs_review_reason} isHi={isHi} />
                      )}
                    </div>
                    <div className="text-[12px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-1.5">
                      <span className="text-slate-200">{item.student_name}</span>
                      <span>&middot;</span>
                      <span>{formatDate(item.submitted_at, isHi)}</span>
                      <span>&middot;</span>
                      <span>
                        {item.question_count} {tt(isHi, 'questions', 'प्रश्न')}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[18px] font-bold text-slate-100">
                      {item.auto_score != null ? `${item.auto_score}%` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                      {tt(isHi, 'auto', 'स्वतः')}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
