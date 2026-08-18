'use client';

/**
 * ExamSchedule — the three-tier "when is my test" surface.
 *
 * PURE PRESENTATION. This component fetches nothing and imports no hook. It
 * renders whatever `entries` the caller passes. That is deliberate: the read
 * contract is a PROPOSAL (see handoff/BLOCKED-SCREENS.md §1) and must be
 * approved and implemented server-side before anything wires this up. Shipping
 * it prop-driven means the UI can be reviewed, storybooked and tested now
 * without a single invented endpoint.
 *
 * Two exports:
 *   <ExamScheduleCard>  — the compact Home card (next entry only).
 *   <ExamScheduleList>  — the full /tests list, all three tiers.
 *
 * Precedence, enforced by the caller's sort and reflected in the styling:
 *   school (authoritative window) > teacher (named chapters) > student (fallback).
 *
 * Tokens only: --orange, --green, --purple, --surface-*, --text-*, --border,
 * --font-display.
 *
 * `ExamScheduleEntry` / `ExamSource` live in `@alfanumrik/lib/exams/types` —
 * lib owns the DTO, this file only consumes it (2026-08-02 layering fix; see
 * that module's header for why).
 */

import { useRouter } from 'next/navigation';
import type { ExamScheduleEntry, ExamReadinessBand } from '@alfanumrik/lib/exams/types';

const BAND_STYLE: Record<ExamReadinessBand, { bg: string; fg: string; border: string }> = {
  exam_ready: { bg: 'rgb(var(--green-rgb, 22 163 74) / 0.10)', fg: 'var(--green)', border: 'rgb(var(--green-rgb, 22 163 74) / 0.22)' },
  getting_it: { bg: 'var(--surface-2)', fg: 'var(--text-2)', border: 'var(--border)' },
  shaky: { bg: 'rgb(var(--orange-rgb) / 0.10)', fg: 'var(--orange)', border: 'rgb(var(--orange-rgb) / 0.22)' },
  new: { bg: 'var(--surface-2)', fg: 'var(--text-3)', border: 'var(--border)' },
};

function ChapterChip({ label, band }: { label: string; band: ExamReadinessBand }) {
  const s = BAND_STYLE[band] ?? BAND_STYLE.new;
  return (
    <span
      className="inline-flex items-center rounded-xl px-3 text-xs font-bold"
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.border}`, minHeight: 32 }}
    >
      {label}
    </span>
  );
}

function SourceLine({ entry, isHi }: { entry: ExamScheduleEntry; isHi: boolean }) {
  if (entry.source === 'teacher') {
    return (
      <div className="flex items-center gap-2 mt-1.5">
        {entry.setByInitials && (
          <span
            className="rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold"
            style={{ width: 22, height: 22, background: 'var(--text-1)', color: 'var(--surface-1, #fff)' }}
            aria-hidden="true"
          >
            {entry.setByInitials}
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--text-3)' }}>
          {entry.setBy}
        </span>
      </div>
    );
  }
  if (entry.source === 'school') {
    return (
      <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
        {isHi ? 'स्कूल कैलेंडर से' : 'From your school calendar'}
      </p>
    );
  }
  return (
    <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
      {isHi ? 'आपने जोड़ा' : 'You added this'}
    </p>
  );
}

/** Home card — renders the single most urgent entry, or nothing. */
export function ExamScheduleCard({
  entry,
  isHi,
  onRevise,
}: {
  entry: ExamScheduleEntry | null;
  isHi: boolean;
  onRevise: (entry: ExamScheduleEntry) => void;
}) {
  if (!entry) return null;
  const accent = entry.source === 'student' ? 'var(--border)' : 'var(--orange)';

  return (
    <section
      data-testid="exam-schedule-card"
      className="rounded-2xl p-4 mb-3"
      style={{ background: 'var(--surface-1, #fff)', border: `1px solid ${accent}` }}
    >
      <div className="flex items-center gap-2">
        {/* min-w-0 + flex-1 let the title actually shrink inside the flex row
            so `truncate` has an effective width to clip against — a student-
            typed title (up to 120 chars) had no overflow handling before. */}
        <h3 className="text-sm font-bold truncate min-w-0 flex-1" style={{ color: 'var(--text-1)' }}>
          {entry.title}
        </h3>
        <span
          className="ml-auto shrink-0 inline-flex items-center rounded-xl px-2.5 text-xs font-bold"
          style={{
            background: 'rgb(var(--orange-rgb) / 0.10)',
            color: 'var(--orange)',
            border: '1px solid rgb(var(--orange-rgb) / 0.22)',
            minHeight: 30,
          }}
        >
          {entry.dayLabel}
        </span>
      </div>
      <SourceLine entry={entry} isHi={isHi} />
      {entry.chapters && entry.chapters.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {entry.chapters.map((c) => (
            <ChapterChip key={c.id} label={c.label} band={c.band} />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => onRevise(entry)}
        className="w-full rounded-xl text-sm font-bold mt-3.5"
        style={{ background: 'var(--text-1)', color: 'var(--surface-1, #fff)', minHeight: 48 }}
        data-testid="exam-schedule-revise"
      >
        {isHi ? 'इसके लिए रिवीजन करें' : 'Revise for this'}
      </button>
    </section>
  );
}

/** Full list — this week, then later, all three tiers in one column. */
export function ExamScheduleList({
  thisWeek,
  later,
  isHi,
  onAdd,
  onEdit,
}: {
  thisWeek: ExamScheduleEntry[];
  later: ExamScheduleEntry[];
  isHi: boolean;
  onAdd: () => void;
  onEdit: (entry: ExamScheduleEntry) => void;
}) {
  const router = useRouter();

  const row = (entry: ExamScheduleEntry) => (
    <div
      key={entry.id}
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface-1, #fff)',
        border: entry.source === 'student' ? '1px dashed var(--border)' : '1px solid var(--border)',
      }}
      data-testid={`exam-entry-${entry.source}`}
    >
      <div className="flex items-baseline gap-2">
        {/* Same min-w-0/flex-1/truncate treatment as the card above. */}
        <h3 className="text-sm font-bold truncate min-w-0 flex-1" style={{ color: 'var(--text-1)' }}>
          {entry.title}
        </h3>
        <span className="ml-auto shrink-0 text-xs font-bold" style={{ color: 'var(--text-2)' }}>
          {entry.dayLabel}
        </span>
      </div>
      <SourceLine entry={entry} isHi={isHi} />
      {entry.chapters && entry.chapters.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {entry.chapters.map((c) => (
            <ChapterChip key={c.id} label={c.label} band={c.band} />
          ))}
        </div>
      )}
      {entry.editable && (
        <button
          type="button"
          onClick={() => onEdit(entry)}
          className="text-xs font-bold mt-3"
          style={{ color: 'var(--text-3)', minHeight: 44 }}
        >
          {isHi ? 'बदलें' : 'Edit'}
        </button>
      )}
    </div>
  );

  return (
    <div data-testid="exam-schedule-list" className="flex flex-col gap-3">
      <div className="flex items-center">
        <h1 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
          {isHi ? 'टेस्ट और समय-सीमा' : 'Tests & deadlines'}
        </h1>
        <button
          type="button"
          onClick={onAdd}
          className="ml-auto text-sm font-bold px-3"
          style={{ color: 'var(--orange)', minHeight: 44 }}
          data-testid="exam-schedule-add"
        >
          {isHi ? 'जोड़ें' : 'Add'}
        </button>
      </div>

      {thisWeek.length > 0 && (
        <>
          <p className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'इस हफ़्ते' : 'This week'}
          </p>
          {thisWeek.map(row)}
        </>
      )}

      {later.length > 0 && (
        <>
          <p className="text-[11px] font-extrabold uppercase tracking-wider mt-1" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'बाद में' : 'Later'}
          </p>
          {later.map(row)}
        </>
      )}

      {thisWeek.length === 0 && later.length === 0 && (
        <div
          className="rounded-2xl p-5 text-center"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
          data-testid="exam-schedule-empty"
        >
          <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'कोई टेस्ट दर्ज नहीं है' : 'No tests on record'}
          </p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? 'स्कूल जुड़ने पर तारीखें अपने आप आ जाएँगी।'
              : "Dates arrive automatically once your school is linked."}
          </p>
          <button
            type="button"
            onClick={onAdd}
            className="rounded-xl text-sm font-bold px-5 mt-4"
            style={{ background: 'var(--accent-warm-strong)', color: 'var(--on-accent)', minHeight: 48 }}
          >
            {isHi ? 'तारीख जोड़ें' : 'Add a date'}
          </button>
        </div>
      )}

      <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--text-3)' }}>
        {isHi
          ? 'स्कूल की तारीखें अवधि तय करती हैं; शिक्षक की तारीखें अध्याय बताती हैं — वही रिवीजन तय करता है।'
          : 'School dates set the window. Teacher dates name the chapters — that is what shapes your revision.'}
      </p>

      <button
        type="button"
        onClick={() => router.push('/today')}
        className="text-xs font-semibold self-start"
        style={{ color: 'var(--text-3)', minHeight: 44 }}
      >
        {isHi ? '← आज पर लौटें' : '← Back to today'}
      </button>
    </div>
  );
}
