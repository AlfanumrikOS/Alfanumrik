'use client';

/**
 * UpcomingExamsList — the student's active exams as selectable cards for the
 * Alfa OS pre-test briefing hub (ff_test_os_v1, Tier 1 / presentation-only).
 *
 * Pure presentation over the existing exam_configs + exam_chapters read
 * (useUpcomingExams). Selecting a card drives the per-exam briefing sections in
 * the hub. Each card shows name, type badge, subject, and a days-left countdown
 * (encoded number + glyph, never colour alone — A11y).
 *
 * States: loading (skeletons), error (visually DISTINCT from empty), empty
 * (no exams yet → an encouraging zero-state that points back to /exams).
 */

import { Skeleton, Badge } from '@/components/ui';
import { examTypeMeta, getDaysRemaining } from './briefing-helpers';
import type { UpcomingExam } from './useUpcomingExams';

interface UpcomingExamsListProps {
  exams: UpcomingExam[] | null;
  isLoading: boolean;
  error: unknown;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isHi: boolean;
}

/** Days-left urgency glyph — pairs with the number so meaning never relies on
 *  colour alone (A11y). ◉ ≤3 days, ◐ ≤7 days, ○ otherwise. */
function urgencyGlyph(days: number): string {
  if (days <= 3) return '◉';
  if (days <= 7) return '◐';
  return '○';
}

function urgencyColor(days: number): string {
  if (days <= 3) return '#DC2626';
  if (days <= 7) return '#F59E0B';
  return '#16A34A';
}

export default function UpcomingExamsList({
  exams,
  isLoading,
  error,
  selectedId,
  onSelect,
  isHi,
}: UpcomingExamsListProps) {
  const heading = (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'आगामी परीक्षाएँ' : 'Upcoming exams'}
    </h2>
  );

  if (isLoading && !exams) {
    return (
      <section aria-busy="true" aria-label={isHi ? 'परीक्षाएँ लोड हो रही हैं' : 'Loading exams'}>
        {heading}
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} height={88} rounded="rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={isHi ? 'आगामी परीक्षाएँ' : 'Upcoming exams'}>
      {heading}

      {error && !exams ? (
        /* ERROR — distinct from empty: orange text + solid border. */
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'परीक्षाएँ अभी लोड नहीं हो पाईं। थोड़ी देर बाद कोशिश करो।'
            : "Couldn't load your exams right now. Please try again shortly."}
        </div>
      ) : !exams || exams.length === 0 ? (
        /* EMPTY — distinct from error: muted text + dashed border. */
        <div
          className="rounded-2xl p-5 text-center"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          <div className="text-3xl mb-2" aria-hidden="true">📋</div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'अभी कोई परीक्षा नहीं' : 'No exams yet'}
          </p>
          <p className="text-xs mt-1">
            {isHi
              ? 'पहले अपनी परीक्षा जोड़ो — फिर यहाँ ब्रीफ़िंग दिखेगी।'
              : 'Add an exam first — then your briefing will show up here.'}
          </p>
          <a
            href="/exams"
            className="inline-flex items-center justify-center gap-1 mt-3 px-4 rounded-xl text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ minHeight: 48, background: 'var(--orange, #E8581C)', color: '#fff' }}
          >
            {isHi ? 'परीक्षा जोड़ें' : 'Add an exam'}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      ) : (
        <ul className="space-y-2">
          {exams.map((exam) => {
            const days = getDaysRemaining(exam.exam_date);
            const meta = examTypeMeta(exam.exam_type);
            const isSelected = exam.id === selectedId;
            const glyph = urgencyGlyph(days);
            const color = urgencyColor(days);
            const dateLabel = new Date(exam.exam_date).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            });
            return (
              <li key={exam.id}>
                <button
                  type="button"
                  onClick={() => onSelect(exam.id)}
                  aria-pressed={isSelected}
                  className="w-full text-left flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-transform duration-150 motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    minHeight: 48,
                    background: 'var(--surface-1)',
                    border: isSelected
                      ? `2px solid ${meta.color}`
                      : '1px solid var(--border)',
                    color: 'var(--text-1)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                  aria-label={
                    isHi
                      ? `${exam.exam_name} — ${days} दिन बाकी — ${isSelected ? 'चुना गया' : 'चुनने के लिए दबाओ'}`
                      : `${exam.exam_name} — ${days} days left — ${isSelected ? 'selected' : 'tap to select'}`
                  }
                >
                  <span className="flex flex-col min-w-0 gap-1">
                    <span className="text-sm font-bold truncate" style={{ fontFamily: 'var(--font-display)' }}>
                      {exam.exam_name}
                    </span>
                    <span className="flex items-center gap-2 flex-wrap">
                      <Badge color={meta.color} size="sm">
                        {meta.icon} {isHi ? meta.labelHi : meta.label}
                      </Badge>
                      <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                        📅 {dateLabel}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className="text-xl font-bold flex items-center justify-end gap-1"
                      style={{ color, fontVariantNumeric: 'tabular-nums' }}
                    >
                      <span aria-hidden="true">{glyph}</span>
                      {days}
                    </span>
                    <span className="text-[10px] block" style={{ color: 'var(--text-3)' }}>
                      {isHi ? 'दिन बाकी' : 'days left'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
