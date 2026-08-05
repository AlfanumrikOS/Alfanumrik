'use client';

/**
 * EvidenceDrawer — right-side drawer that surfaces per-student attempts/hints
 * activity and misconception examples for a cluster OR an at-risk alert. Two
 * entry points:
 *
 *   1. MisconceptionClusterCard "View evidence" → cluster mode
 *      (get_misconception_clusters with include_examples:true)
 *   2. AlertRow "Evidence" affordance → alert mode
 *      (get_alerts row's `evidence` field)
 *
 * PRESENTATION ONLY. All values are rendered verbatim from the server payload;
 * no PII beyond what the server already exposes (student first names, truncated
 * question text). P7 bilingual. P13 no client-side logging.
 */

import { useEffect } from 'react';

export interface EvidenceExample {
  student_id?: string;
  student_name?: string;
  question_text: string;
  student_answer: string;
  correct_answer: string;
  detected_at: string;
}

export interface EvidenceAttemptBar {
  student_id: string;
  student_name: string;
  attempts: number;
  hints: number;
}

export interface EvidencePayload {
  title: string;
  subtitle?: string;
  attempts?: EvidenceAttemptBar[];
  examples?: EvidenceExample[];
}

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

function AttemptSparkline({ bars, isHi }: { bars: EvidenceAttemptBar[]; isHi: boolean }) {
  const max = Math.max(1, ...bars.map((b) => b.attempts + b.hints));
  return (
    <div className="flex flex-col gap-1.5" data-testid="evidence-sparkline">
      {bars.map((b) => {
        const total = b.attempts + b.hints;
        const pct = Math.round((total / max) * 100);
        return (
          <div key={b.student_id} className="flex items-center gap-2 text-[11px]">
            <span className="w-24 truncate" style={{ color: 'var(--text-2)' }}>
              {b.student_name}
            </span>
            <div
              className="flex-1 h-2 rounded-full overflow-hidden"
              style={{ background: 'var(--surface-2)' }}
            >
              <div
                className="h-full"
                style={{ width: `${pct}%`, background: 'var(--purple)' }}
              />
            </div>
            <span
              className="tabular-nums font-semibold w-14 text-right"
              style={{ color: 'var(--text-3)' }}
            >
              {b.attempts}
              {t(isHi, 'a', 'प')}·{b.hints}
              {t(isHi, 'h', 'सं')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ExampleRow({ ex, isHi }: { ex: EvidenceExample; isHi: boolean }) {
  const truncate = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);
  return (
    <div
      className="rounded-lg p-2.5 text-[12px]"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <p className="m-0 mb-1 font-semibold" style={{ color: 'var(--text-1)' }}>
        {truncate(ex.question_text)}
      </p>
      <p className="m-0" style={{ color: 'var(--danger, #DC2626)' }}>
        {t(isHi, 'Student', 'छात्र')}: {truncate(ex.student_answer)}
      </p>
      <p className="m-0" style={{ color: 'var(--success, #059669)' }}>
        {t(isHi, 'Correct', 'सही')}: {truncate(ex.correct_answer)}
      </p>
      <p className="mt-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
        {new Date(ex.detected_at).toLocaleString()}
      </p>
    </div>
  );
}

export function EvidenceDrawer({
  open,
  payload,
  loading,
  isHi,
  onClose,
}: {
  open: boolean;
  payload: EvidencePayload | null;
  loading?: boolean;
  isHi: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      data-testid="evidence-drawer"
    >
      <button
        type="button"
        aria-label={t(isHi, 'Close', 'बंद करें')}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 border-none cursor-pointer"
      />
      <aside
        className="relative w-full max-w-md h-full overflow-y-auto p-5 shadow-2xl"
        style={{ background: 'var(--surface-1)' }}
      >
        <div className="flex justify-between items-start mb-3">
          <div className="min-w-0">
            <h3
              className="text-base font-bold m-0 font-heading"
              style={{ color: 'var(--text-1)' }}
            >
              {payload?.title ?? t(isHi, 'Evidence', 'सबूत')}
            </h3>
            {payload?.subtitle && (
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                {payload.subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="evidence-close-btn"
            className="rounded-md py-1 px-2 text-[12px] font-semibold border-none cursor-pointer"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
          >
            {t(isHi, 'Close', 'बंद')}
          </button>
        </div>
        {loading && (
          <div
            className="h-24 rounded-lg animate-pulse motion-reduce:animate-none"
            style={{ background: 'var(--surface-2)' }}
            aria-hidden="true"
          />
        )}
        {!loading && payload?.attempts && payload.attempts.length > 0 && (
          <section className="mb-4">
            <h4
              className="text-[11px] uppercase tracking-wide font-bold m-0 mb-2"
              style={{ color: 'var(--text-3)' }}
            >
              {t(isHi, 'Attempts & hints', 'प्रयास और संकेत')}
            </h4>
            <AttemptSparkline bars={payload.attempts} isHi={isHi} />
          </section>
        )}
        {!loading && payload?.examples && payload.examples.length > 0 && (
          <section className="flex flex-col gap-2">
            <h4
              className="text-[11px] uppercase tracking-wide font-bold m-0"
              style={{ color: 'var(--text-3)' }}
            >
              {t(isHi, 'Recent examples', 'हाल के उदाहरण')}
            </h4>
            {payload.examples.map((ex, i) => (
              <ExampleRow key={i} ex={ex} isHi={isHi} />
            ))}
          </section>
        )}
        {!loading &&
          !payload?.examples?.length &&
          !payload?.attempts?.length && (
            <p className="text-[13px] py-6 text-center" style={{ color: 'var(--text-3)' }}>
              {t(isHi, 'No evidence available yet.', 'अभी तक कोई सबूत उपलब्ध नहीं है।')}
            </p>
          )}
      </aside>
    </div>
  );
}

export default EvidenceDrawer;
