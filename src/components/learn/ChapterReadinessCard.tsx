'use client';

/**
 * ChapterReadinessCard — Phase 2 of "Exam-Ready 360°".
 *
 * Renders the per-chapter READINESS signal as a bilingual, token-coded card
 * above the chapter learn flow. Tells the student in plain language whether
 * they're exam-ready and what to do next.
 *
 * Bound to /api/v1/chapter-readiness via useChapterReadiness(). When data is
 * missing (loading/error/no-data), the card renders nothing rather than a
 * skeleton — the chapter page already has progress + concept indicators, so
 * an extra empty card would just add visual noise.
 *
 * IMPORTANT (assessment condition): this card shows a READINESS composite on
 * its OWN 4-level scale (not_yet / building / almost / ready) — NOT an
 * accuracy %. It is deliberately rendered in its native scale: a Badge for the
 * level + a linear composite meter. It is NEVER fed into a MasteryRing with
 * the accuracy band labels, which would conflate readiness with accuracy.
 * The honest gap display (concepts mastered / total, recent quiz avg) and the
 * `rag_ready` "Foxy still learning" caveat are preserved verbatim.
 *
 * P7 (bilingual): every label resolves through `useAuth().isHi`. The
 * server-emitted `message_en`/`message_hi` strings are rendered as-is — the
 * RPC owns voice and tone there.
 *
 * Phase 5b re-skin: presentation-only migration onto the canonical primitive
 * layer + semantic status tokens (aligned to the sibling ChapterReadinessBadge
 * / SubjectReadinessSummary pattern). Zero raw hex / rgb().
 *
 * Next-action routing (unchanged):
 *   mock_exam        → /exams (chapter-scoped mock)
 *   spaced_review    → /review (spaced repetition queue)
 *   take_quiz        → /quiz?subject=&chapter=
 *   review_concept   → scroll to first weak concept (callback)
 *   introduce_concept→ no-op (student is already on the concept page)
 */

import { memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useFeatureFlags } from '@/lib/swr';
import {
  useChapterReadiness,
  type ChapterReadinessLevel,
} from '@/lib/useChapterReadiness';
import { reviewRoute } from '@/lib/routes/study-menu-routes';
import { Card, Badge, Button, ProgressBar } from '@/components/ui/primitives';
import type { Tone } from '@/components/ui/primitives';

export interface ChapterReadinessCardProps {
  subjectCode: string;
  chapterNumber: number;
  /** Subject brand color from the subjects service — used for the composite meter fill. */
  subjectColor?: string;
  /**
   * Optional callback when the student taps a "review weak concept" CTA.
   * The chapter page wires this to scroll the carousel to the first concept
   * with mastery_score < 60.
   */
  onReviewWeakConcept?: () => void;
}

interface LevelStyle {
  /** Canonical Badge / ProgressBar tone (semantic status token). */
  tone: Tone;
  /** CSS var used as the composite-meter fill when no subjectColor is given. */
  fill: string;
  icon: string;
  labelEn: string;
  labelHi: string;
}

// Status palette maps to cosmic-aware semantic status tones (no hardcoded
// status hex) — mirrors the sibling ChapterReadinessBadge / SubjectReadiness-
// Summary. `not_yet` takes the calm neutral tone (growth-mindset framing: the
// student is at the start, not "failing").
const LEVEL_STYLES: Record<ChapterReadinessLevel, LevelStyle> = {
  not_yet: {
    tone: 'neutral',
    fill: 'var(--text-3)',
    icon: '🌱',
    labelEn: 'Not Yet Ready',
    labelHi: 'अभी तैयार नहीं',
  },
  building: {
    tone: 'warning',
    fill: 'var(--warning)',
    icon: '🛠',
    labelEn: 'Building',
    labelHi: 'बन रहा है',
  },
  almost: {
    tone: 'info',
    fill: 'var(--info)',
    icon: '⚡',
    labelEn: 'Almost Ready',
    labelHi: 'लगभग तैयार',
  },
  ready: {
    tone: 'success',
    fill: 'var(--success)',
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

  // Composite READINESS meter fill — subject brand colour when provided,
  // else the level's semantic status token. This is the readiness composite
  // in its native 0..100 scale (NOT an accuracy ring).
  const meterColor = subjectColor ?? style.fill;
  const meterPct = Math.max(2, Math.min(100, readiness.score));

  // Honest concept-gap fraction (a completion count, not an accuracy %).
  const conceptPct =
    readiness.concepts_total > 0
      ? Math.round((readiness.concepts_mastered / readiness.concepts_total) * 100)
      : 0;

  return (
    <Card variant="flat" data-testid="chapter-readiness-card" className="p-4">
      {/* Level + score + Foxy caveat + server message */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={style.tone}
            variant="soft"
            icon={<span aria-hidden="true">{style.icon}</span>}
          >
            {isHi ? style.labelHi : style.labelEn}
          </Badge>
          <span
            className="text-fluid-xs font-semibold tabular-nums text-muted-foreground"
            aria-label={
              isHi
                ? `तैयारी स्कोर ${readiness.score} में 100`
                : `Readiness score ${readiness.score} of 100`
            }
          >
            {readiness.score}/100
          </span>
          {!readiness.rag_ready && (
            <Badge
              tone="neutral"
              variant="soft"
              className="ml-auto"
              title={
                isHi
                  ? 'Foxy इस अध्याय पर अभी सीख रहा है'
                  : 'Foxy is still learning this chapter'
              }
            >
              {isHi ? 'Foxy सीख रहा' : 'Foxy learning'}
            </Badge>
          )}
        </div>
        <p className="text-fluid-sm leading-snug text-foreground">{message}</p>
      </div>

      {/* Composite READINESS meter — native 0..100 scale, NOT a mastery ring. */}
      <div className="mt-3" aria-hidden="true">
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
            style={{ width: `${meterPct}%`, background: meterColor }}
          />
        </div>
      </div>

      {/* Honest concept-gap progress + secondary signals + next-action CTA. */}
      <div className="mt-3 flex flex-col gap-2.5">
        <ProgressBar
          value={conceptPct}
          tone={style.tone}
          size="sm"
          label={
            <span>
              🎯 {isHi ? 'Concepts पूर्ण' : 'Concepts mastered'}{' '}
              {readiness.concepts_mastered}/{readiness.concepts_total}
            </span>
          }
          ariaLabel={
            isHi
              ? `Concepts पूर्ण ${readiness.concepts_mastered} में ${readiness.concepts_total}`
              : `Concepts mastered ${readiness.concepts_mastered} of ${readiness.concepts_total}`
          }
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-fluid-xs text-muted-foreground">
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
            <Button
              size="sm"
              onClick={handleAction}
              data-testid="chapter-readiness-cta"
              className="shrink-0"
              trailingIcon={<span aria-hidden="true">→</span>}
            >
              {isHi ? actionLabel.hi : actionLabel.en}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export const ChapterReadinessCard = memo(ChapterReadinessCardInner);
export default ChapterReadinessCard;
