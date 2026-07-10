'use client';

/**
 * ChapterReadinessCard — Phase 2 of "Exam-Ready 360°".
 *
 * Renders the per-chapter readiness signal as a bilingual, color-coded card
 * above the chapter learn flow. Tells the student in plain language whether
 * they're exam-ready and what to do next.
 *
 * Bound to /api/v1/chapter-readiness via useChapterReadiness(). When data is
 * missing (loading/error/no-data), the card renders nothing rather than a
 * skeleton — the chapter page already has progress + concept indicators, so
 * an extra empty card would just add visual noise.
 *
 * P7 (bilingual): every label resolves through `useAuth().isHi`. The
 * server-emitted `message_en`/`message_hi` strings are rendered as-is — the
 * RPC owns voice and tone there.
 *
 * Next-action routing:
 *   mock_exam        → /exams (chapter-scoped mock)
 *   spaced_review    → /review (spaced repetition queue)
 *   take_quiz        → /quiz?subject=&chapter=
 *   review_concept   → scroll to first weak concept (callback)
 *   introduce_concept→ no-op (student is already on the concept page)
 */

import { memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import {
  useChapterReadiness,
  type ChapterReadinessLevel,
} from '@alfanumrik/lib/useChapterReadiness';
import { reviewRoute } from '@alfanumrik/lib/routes/study-menu-routes';

export interface ChapterReadinessCardProps {
  subjectCode: string;
  chapterNumber: number;
  /** Subject brand color from the subjects service — used for the score bar. */
  subjectColor?: string;
  /**
   * Optional callback when the student taps a "review weak concept" CTA.
   * The chapter page wires this to scroll the carousel to the first concept
   * with mastery_score < 60.
   */
  onReviewWeakConcept?: () => void;
}

interface LevelStyle {
  bg: string;
  border: string;
  fg: string;
  icon: string;
  labelEn: string;
  labelHi: string;
}

const LEVEL_STYLES: Record<ChapterReadinessLevel, LevelStyle> = {
  not_yet: {
    bg: '#FEF3F2',
    border: '#FECDCA',
    fg: '#B42318',
    icon: '🌱',
    labelEn: 'Not Yet Ready',
    labelHi: 'अभी तैयार नहीं',
  },
  building: {
    bg: '#FFFAEB',
    border: '#FEDF89',
    fg: '#B54708',
    icon: '🛠',
    labelEn: 'Building',
    labelHi: 'बन रहा है',
  },
  almost: {
    bg: '#EFF8FF',
    border: '#B2DDFF',
    fg: '#175CD3',
    icon: '⚡',
    labelEn: 'Almost Ready',
    labelHi: 'लगभग तैयार',
  },
  ready: {
    bg: '#ECFDF3',
    border: '#A6F4C5',
    fg: '#027A48',
    icon: '✅',
    labelEn: 'Exam Ready',
    labelHi: 'परीक्षा-तैयार',
  },
};

interface NextActionLabel {
  en: string;
  hi: string;
}

const NEXT_ACTION_LABELS: Record<string, NextActionLabel> = {
  mock_exam: { en: 'Take Mock Exam', hi: 'Mock परीक्षा दो' },
  spaced_review: { en: 'Review Now', hi: 'Revision करो' },
  take_quiz: { en: 'Take Chapter Quiz', hi: 'अध्याय Quiz दो' },
  review_concept: { en: 'Review Weak Concepts', hi: 'कमज़ोर concepts देखो' },
  introduce_concept: { en: 'Start Learning', hi: 'पढ़ाई शुरू करो' },
};

function ChapterReadinessCardInner({
  subjectCode,
  chapterNumber,
  subjectColor,
  onReviewWeakConcept,
}: ChapterReadinessCardProps) {
  const router = useRouter();
  const { isHi } = useAuth();
  const { readiness, isLoading } = useChapterReadiness(subjectCode, chapterNumber);
  // Phase 5 Study-Menu v2 — route /review to /refresh when flag is on.
  const { data: flags } = useFeatureFlags();
  const flagsRecord = (flags ?? {}) as Record<string, boolean>;

  // Hide while loading or if the API returned nothing usable. The chapter
  // page already renders a progress bar + concept indicators; adding a
  // skeleton here would be visual noise.
  if (isLoading || !readiness) return null;

  const style = LEVEL_STYLES[readiness.level];
  const actionLabel =
    NEXT_ACTION_LABELS[readiness.next_action] ??
    NEXT_ACTION_LABELS.take_quiz;
  const message = isHi ? readiness.message_hi : readiness.message_en;

  // Hide the next-action button for `introduce_concept` — the student is
  // already on the concept page, so there's nothing to route them to.
  const showAction = readiness.next_action !== 'introduce_concept';

  function handleAction() {
    switch (readiness!.next_action) {
      case 'mock_exam':
        router.push(
          `/exams?subject=${encodeURIComponent(subjectCode)}&chapter=${chapterNumber}`,
        );
        return;
      case 'spaced_review':
        router.push(reviewRoute(flagsRecord));
        return;
      case 'take_quiz':
        router.push(
          `/quiz?subject=${encodeURIComponent(subjectCode)}&chapter=${chapterNumber}`,
        );
        return;
      case 'review_concept':
        // Defer to caller (scrolls the concept carousel to the first weak
        // concept) when wired; otherwise no-op so the button remains a
        // semantic CTA without throwing.
        onReviewWeakConcept?.();
        return;
      default:
        return;
    }
  }

  const scoreBarColor = subjectColor ?? style.fg;

  return (
    <div
      data-testid="chapter-readiness-card"
      className="rounded-2xl px-4 py-3"
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-lg"
          style={{ background: 'rgba(255,255,255,0.6)' }}
        >
          {style.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="text-sm font-bold"
              style={{ color: style.fg }}
            >
              {isHi ? style.labelHi : style.labelEn}
            </span>
            <span
              className="text-[11px] font-semibold tabular-nums"
              style={{ color: style.fg }}
              aria-label={isHi ? `तैयारी स्कोर ${readiness.score} में 100` : `Readiness score ${readiness.score} of 100`}
            >
              {readiness.score}/100
            </span>
            {!readiness.rag_ready && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-auto"
                style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-3)' }}
                title={isHi ? 'Foxy इस अध्याय पर अभी सीख रहा है' : 'Foxy is still learning this chapter'}
              >
                {isHi ? 'Foxy सीख रहा' : 'Foxy learning'}
              </span>
            )}
          </div>
          <p className="text-[12px] leading-snug mt-0.5" style={{ color: style.fg }}>
            {message}
          </p>
        </div>
      </div>

      {/* Composite score bar */}
      <div className="mt-3">
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ background: 'rgba(0,0,0,0.06)', height: 4 }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.max(2, Math.min(100, readiness.score))}%`,
              background: scoreBarColor,
            }}
          />
        </div>
      </div>

      {/* Stats row + CTA */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-3)]">
          <span title={isHi ? 'Concepts पूर्ण' : 'Concepts mastered'}>
            🎯 {readiness.concepts_mastered}/{readiness.concepts_total}
          </span>
          {readiness.recent_quiz_count > 0 && (
            <span title={isHi ? 'हाल के Quiz औसत' : 'Recent quiz avg'}>
              ✍️ {Math.round(readiness.recent_quiz_avg)}%
            </span>
          )}
          {readiness.spaced_reviews > 0 && (
            <span title={isHi ? 'Revisions पूर्ण' : 'Spaced reviews'}>
              🔁 {readiness.spaced_reviews}
            </span>
          )}
        </div>
        {showAction && (
          <button
            type="button"
            onClick={handleAction}
            data-testid="chapter-readiness-cta"
            className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 text-white"
            style={{ background: style.fg }}
          >
            {isHi ? actionLabel.hi : actionLabel.en} →
          </button>
        )}
      </div>
    </div>
  );
}

export const ChapterReadinessCard = memo(ChapterReadinessCardInner);
export default ChapterReadinessCard;
