'use client';

/**
 * NextStepCard — the single primary CTA for the Alfa OS Subjects hub
 * (ff_subjects_os_v1, Tier 1 / presentation-only).
 *
 * Picks the "focus chapter" from the EXISTING subject-readiness rows (lowest
 * readiness among chapters with some activity, else the first chapter), then
 * reads that chapter's `next_action` + bilingual messages from the EXISTING
 * useChapterReadiness RPC. It deep-links to existing quiz / read / Foxy routes
 * via nextActionRoute() — it never changes quiz or Foxy code, and computes no
 * mastery.
 *
 * States: loading (skeleton), error (distinct), empty (no chapters → gentle
 * start CTA into the chapter list / Foxy).
 */

import { useRouter } from 'next/navigation';
import { Skeleton } from '@alfanumrik/ui/ui';
import { useChapterReadiness } from '@alfanumrik/lib/useChapterReadiness';
import type { ChapterReadinessSummaryRow } from '@alfanumrik/lib/useSubjectReadiness';
import { nextActionRoute, nextActionLabel } from './readiness-map';

interface NextStepCardProps {
  subjectCode: string;
  subjectColor?: string;
  /** Per-chapter readiness rows from useSubjectReadiness (may be empty). */
  chapters: ChapterReadinessSummaryRow[];
  summaryLoading: boolean;
  summaryError: unknown;
  isHi: boolean;
}

/** Lowest-readiness chapter with some activity, else the first chapter. */
function pickFocusChapter(rows: ChapterReadinessSummaryRow[]): number | null {
  if (rows.length === 0) return null;
  const order: Record<string, number> = { not_yet: 0, building: 1, almost: 2, ready: 3 };
  const withActivity = rows.filter((r) => r.recent_quiz_count > 0 || r.concepts_mastered > 0);
  const pool = withActivity.length > 0 ? withActivity : rows;
  const sorted = [...pool].sort((a, b) => {
    const lvl = (order[a.level] ?? 0) - (order[b.level] ?? 0);
    if (lvl !== 0) return lvl;
    return a.score - b.score;
  });
  return sorted[0]?.chapter_number ?? null;
}

export default function NextStepCard({
  subjectCode,
  subjectColor = 'var(--orange)',
  chapters,
  summaryLoading,
  summaryError,
  isHi,
}: NextStepCardProps) {
  const router = useRouter();
  const focusChapter = pickFocusChapter(chapters);
  const { readiness, isLoading, error } = useChapterReadiness(subjectCode, focusChapter);

  const loading = summaryLoading || (focusChapter != null && isLoading && !readiness);

  if (loading) {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        <Skeleton width="40%" height={12} className="mb-2" />
        <Skeleton width="80%" height={16} className="mb-3" />
        <Skeleton width="50%" height={44} rounded="rounded-xl" />
      </div>
    );
  }

  // Error state — distinct from empty. Surfaced only when both data sources
  // failed; otherwise fall through to a usable CTA.
  if ((summaryError || error) && !readiness && chapters.length === 0) {
    return (
      <div
        className="rounded-2xl p-4 text-center"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        role="status"
      >
        <p className="text-sm" style={{ color: 'var(--orange)' }}>
          {isHi
            ? 'अगला कदम अभी लोड नहीं हो पाया — फिर से कोशिश करो।'
            : "Couldn't load your next step — please try again."}
        </p>
      </div>
    );
  }

  // Empty — no chapters / no signal yet. Gentle start CTA into Foxy.
  if (focusChapter == null || !readiness) {
    return (
      <div className="rounded-2xl p-4" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-semibold mb-1" style={{ color: subjectColor }}>
          {isHi ? '🚀 यहाँ से शुरू करो' : '🚀 Start here'}
        </div>
        <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>
          {isHi
            ? 'पहला अध्याय चुनो या Foxy से इस विषय के बारे में पूछो।'
            : 'Pick your first chapter or ask Foxy about this subject.'}
        </p>
        <button
          onClick={() => router.push(`/foxy?subject=${encodeURIComponent(subjectCode)}&mode=learn`)}
          className="w-full rounded-xl px-4 font-bold text-white transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ background: subjectColor, minHeight: 48 }}
        >
          🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
        </button>
      </div>
    );
  }

  const message = isHi ? readiness.message_hi : readiness.message_en;
  const ctaLabel = nextActionLabel(readiness.next_action, isHi);
  const route = nextActionRoute(readiness.next_action, subjectCode, focusChapter);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface-1)', border: `1.5px solid ${subjectColor}33`, boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: subjectColor }}>
        {isHi ? '👉 अगला कदम' : '👉 Your next step'}
      </div>
      <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-1)' }}>
        {message}
      </p>
      <button
        onClick={() => router.push(route)}
        className="w-full rounded-xl px-4 font-bold text-white transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ background: subjectColor, minHeight: 48 }}
        aria-label={`${ctaLabel} — ${isHi ? 'अध्याय' : 'Chapter'} ${focusChapter}`}
      >
        {ctaLabel} →
      </button>
    </div>
  );
}
