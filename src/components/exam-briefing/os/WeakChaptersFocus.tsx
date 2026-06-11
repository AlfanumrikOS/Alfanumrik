'use client';

/**
 * WeakChaptersFocus — the exam's weakest chapters (readiness not_yet/building),
 * ranked weakest-first, with a deep-link into the EXISTING /learn and /quiz
 * surfaces for each chapter. For the Alfa OS briefing hub (ff_test_os_v1,
 * Tier 1 / presentation-only).
 *
 * Pure presentation over the existing useSubjectReadiness reader. The engine
 * OWNS what readiness means; we only re-rank and deep-link. Both /quiz and
 * /learn already read the `subject` + `chapter` scoping params (verified in
 * src/app/quiz/page.tsx and src/app/exams/page.tsx), so no engine change is
 * needed — these are plain navigations into surfaces that already exist.
 *
 * Readiness is encoded as number + glyph (never colour alone — A11y).
 *
 * States: loading (skeleton), error (visually DISTINCT from empty), empty
 * (nothing weak → an encouraging zero-state, NOT an error).
 */

import { Skeleton } from '@/components/ui';
import { useSubjectReadiness } from '@/lib/useSubjectReadiness';
import type { ChapterReadinessLevel } from '@/lib/useChapterReadiness';
import type { UpcomingExam } from './useUpcomingExams';

interface WeakChaptersFocusProps {
  exam: UpcomingExam;
  isHi: boolean;
}

const MAX_ROWS = 5;
const WEAK_LEVELS: ChapterReadinessLevel[] = ['not_yet', 'building'];

const LEVEL_META: Record<'not_yet' | 'building', { en: string; hi: string; glyph: string; color: string }> = {
  not_yet:  { en: 'Not yet',  hi: 'अभी नहीं', glyph: '○', color: '#DC2626' },
  building: { en: 'Building',  hi: 'बन रहा',   glyph: '◐', color: '#E8581C' },
};

export default function WeakChaptersFocus({ exam, isHi }: WeakChaptersFocusProps) {
  const { readiness, isLoading, error } = useSubjectReadiness(exam.subject);

  const heading = (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'कमज़ोर अध्यायों पर ध्यान' : 'Focus on weak chapters'}
    </h2>
  );

  if (isLoading && !readiness) {
    return (
      <section aria-busy="true" aria-label={isHi ? 'कमज़ोर अध्याय लोड हो रहे हैं' : 'Loading weak chapters'}>
        {heading}
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} height={72} rounded="rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  if (error && !readiness) {
    return (
      <section aria-label={isHi ? 'कमज़ोर अध्यायों पर ध्यान' : 'Focus on weak chapters'}>
        {heading}
        {/* ERROR — distinct from empty: orange text + solid border. */}
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'कमज़ोर अध्याय अभी लोड नहीं हो पाए।'
            : "Couldn't load weak chapters right now."}
        </div>
      </section>
    );
  }

  // Only the exam's chapters, restricted to weak readiness, ranked weakest-first.
  const examChapterNums = new Set(exam.exam_chapters.map((c) => c.chapter_number));
  const weak = (readiness?.chapters ?? [])
    .filter((r) => examChapterNums.has(r.chapter_number) && WEAK_LEVELS.includes(r.level))
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_ROWS);

  const chapterTitle = (num: number) =>
    exam.exam_chapters.find((c) => c.chapter_number === num)?.chapter_title ||
    `${isHi ? 'अध्याय' : 'Ch'} ${num}`;

  const subjectParam = encodeURIComponent(exam.subject);

  if (weak.length === 0) {
    return (
      <section aria-label={isHi ? 'कमज़ोर अध्यायों पर ध्यान' : 'Focus on weak chapters'}>
        {heading}
        {/* EMPTY — distinct from error: muted text + dashed border. */}
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'कोई कमज़ोर अध्याय नहीं — शानदार तैयारी! 🎉'
            : 'No weak chapters — great prep! 🎉'}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={isHi ? 'कमज़ोर अध्यायों पर ध्यान' : 'Focus on weak chapters'}>
      {heading}
      <ul className="space-y-2">
        {weak.map((r) => {
          const meta = LEVEL_META[r.level as 'not_yet' | 'building'];
          const title = chapterTitle(r.chapter_number);
          const learnHref = `/learn?subject=${subjectParam}&chapter=${r.chapter_number}`;
          const quizHref = `/quiz?subject=${subjectParam}&chapter=${r.chapter_number}`;
          return (
            <li
              key={r.chapter_number}
              className="rounded-2xl px-4 py-3 flex flex-col gap-2.5"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                  {title}
                </span>
                <span
                  className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ background: `${meta.color}12`, border: `1px solid ${meta.color}25`, color: meta.color }}
                >
                  <span aria-hidden="true">{meta.glyph}</span>
                  <span>{isHi ? meta.hi : meta.en}</span>
                  <span aria-hidden="true" style={{ fontVariantNumeric: 'tabular-nums' }}>· {Math.round(r.score)}%</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={learnHref}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{ minHeight: 48, background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.2)', color: '#7C3AED' }}
                  aria-label={isHi ? `${title} सीखो` : `Learn ${title}`}
                >
                  📖 {isHi ? 'सीखो' : 'Learn'}
                </a>
                <a
                  href={quizHref}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{ minHeight: 48, background: 'rgba(232,88,28,0.10)', border: '1px solid rgba(232,88,28,0.2)', color: 'var(--orange, #E8581C)' }}
                  aria-label={isHi ? `${title} का अभ्यास करो` : `Practise ${title}`}
                >
                  ✏️ {isHi ? 'अभ्यास' : 'Practise'}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
