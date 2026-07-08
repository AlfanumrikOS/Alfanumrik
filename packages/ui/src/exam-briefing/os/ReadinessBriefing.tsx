'use client';

/**
 * ReadinessBriefing — overall readiness ring + per-chapter readiness chips for
 * the selected exam in the Alfa OS briefing hub (ff_test_os_v1, Tier 1 /
 * presentation-only).
 *
 * Pure presentation over the existing useSubjectReadiness reader
 * (GET /api/v1/subject-readiness). The engine OWNS what "readiness" means
 * (assessment owns the readiness RPC); this component only re-presents its
 * `summary` (ready/almost/building/not_yet counts) and per-chapter `level`.
 * The overall ring fill is the share of the exam's chapters that the engine
 * considers ready-or-almost — a presentation framing, NOT a score and NOT
 * mastery.
 *
 * Readiness is encoded as number + glyph (never colour alone — A11y).
 *
 * States: loading (skeleton), error (visually DISTINCT from empty), empty
 * (no readiness signal yet → an informational zero-state, NOT an error).
 */

import { MasteryRing, Skeleton } from '@alfanumrik/ui/ui';
import { useSubjectReadiness } from '@alfanumrik/lib/useSubjectReadiness';
import type { ChapterReadinessLevel } from '@alfanumrik/lib/useChapterReadiness';
import type { UpcomingExam } from './useUpcomingExams';

interface ReadinessBriefingProps {
  exam: UpcomingExam;
  isHi: boolean;
}

// Readiness level → display metadata. Glyph pairs with the label so meaning
// never relies on colour alone (A11y).
const LEVEL_META: Record<
  ChapterReadinessLevel,
  { en: string; hi: string; glyph: string; color: string }
> = {
  ready:    { en: 'Ready',    hi: 'तैयार',    glyph: '●', color: '#16A34A' },
  almost:   { en: 'Almost',   hi: 'लगभग',     glyph: '◕', color: '#F59E0B' },
  building: { en: 'Building',  hi: 'बन रहा',   glyph: '◐', color: '#E8581C' },
  not_yet:  { en: 'Not yet',  hi: 'अभी नहीं', glyph: '○', color: '#DC2626' },
};

export default function ReadinessBriefing({ exam, isHi }: ReadinessBriefingProps) {
  const { readiness, isLoading, error } = useSubjectReadiness(exam.subject);

  const heading = (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'तैयारी का सारांश' : 'Readiness briefing'}
    </h2>
  );

  if (isLoading && !readiness) {
    return (
      <section aria-busy="true" aria-label={isHi ? 'तैयारी लोड हो रही है' : 'Loading readiness'}>
        {heading}
        <Skeleton height={160} rounded="rounded-2xl" />
      </section>
    );
  }

  if (error && !readiness) {
    return (
      <section aria-label={isHi ? 'तैयारी का सारांश' : 'Readiness briefing'}>
        {heading}
        {/* ERROR — distinct from empty: orange text + solid border. */}
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'तैयारी का सारांश अभी लोड नहीं हो पाया।'
            : "Couldn't load your readiness summary right now."}
        </div>
      </section>
    );
  }

  // Restrict the readiness rows to the chapters that are actually on this exam.
  const examChapterNums = new Set(exam.exam_chapters.map((c) => c.chapter_number));
  const rows = (readiness?.chapters ?? []).filter((r) => examChapterNums.has(r.chapter_number));

  if (rows.length === 0) {
    return (
      <section aria-label={isHi ? 'तैयारी का सारांश' : 'Readiness briefing'}>
        {heading}
        {/* EMPTY — distinct from error: muted text + dashed border. */}
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'इस परीक्षा के अध्यायों के लिए अभी तैयारी संकेत नहीं — थोड़ा अभ्यास करो और यहाँ देखो।'
            : 'No readiness signal for this exam’s chapters yet — practise a little and it’ll show here.'}
        </div>
      </section>
    );
  }

  const readyOrAlmost = rows.filter((r) => r.level === 'ready' || r.level === 'almost').length;
  const ringValue = Math.round((readyOrAlmost / rows.length) * 100);
  const ringColor = ringValue >= 70 ? '#16A34A' : ringValue >= 40 ? 'var(--orange, #E8581C)' : '#DC2626';

  // Title-case the chapter title; fall back to "Ch N" so a chip always reads.
  const chapterTitle = (num: number) =>
    exam.exam_chapters.find((c) => c.chapter_number === num)?.chapter_title ||
    `${isHi ? 'अध्याय' : 'Ch'} ${num}`;

  return (
    <section aria-label={isHi ? 'तैयारी का सारांश' : 'Readiness briefing'}>
      {heading}

      <div
        className="rounded-2xl p-4 flex flex-col gap-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        {/* Overall ring */}
        <div className="flex items-center gap-4">
          <div aria-hidden="true">
            <MasteryRing value={ringValue} size={76} strokeWidth={7} color={ringColor}>
              <span
                className="text-xl font-bold"
                style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}
              >
                {ringValue}%
              </span>
            </MasteryRing>
          </div>
          <span className="sr-only">
            {isHi
              ? `${rows.length} में से ${readyOrAlmost} अध्याय तैयार या लगभग तैयार`
              : `${readyOrAlmost} of ${rows.length} chapters ready or almost ready`}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
              {isHi ? 'समग्र तैयारी' : 'Overall readiness'}
            </p>
            <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
              <span aria-hidden="true" style={{ color: ringColor }}>●</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {isHi
                  ? `${rows.length} में से ${readyOrAlmost} अध्याय तैयार/लगभग`
                  : `${readyOrAlmost}/${rows.length} chapters ready or almost`}
              </span>
            </p>
          </div>
        </div>

        {/* Per-chapter readiness chips */}
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const meta = LEVEL_META[r.level];
            return (
              <li
                key={r.chapter_number}
                className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                  {chapterTitle(r.chapter_number)}
                </span>
                <span
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                  style={{ background: `${meta.color}12`, border: `1px solid ${meta.color}25`, color: meta.color }}
                >
                  <span aria-hidden="true">{meta.glyph}</span>
                  <span>{isHi ? meta.hi : meta.en}</span>
                  <span aria-hidden="true" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    · {Math.round(r.score)}%
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
