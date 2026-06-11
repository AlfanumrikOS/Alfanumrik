/**
 * Pure presentation mappers for the Alfa OS Subjects experience (Tier 1).
 *
 * These helpers translate the EXISTING readiness signal (from
 * useSubjectReadiness / useChapterReadiness — the Exam-Ready 360° RPCs) into
 * presentation primitives. They compute NO mastery, NO scoring, NO XP. They
 * only re-shape values the engine already decided into glyph + label + status
 * for the UI. Bilingual labels are resolved by callers via `isHi`.
 */

import type { ChapterReadinessLevel } from '@/lib/useChapterReadiness';
import type { RoadmapNodeStatus } from '@/components/ui/RoadmapNode';

/** Overall readiness buckets returned by useSubjectReadiness().summary. */
export type ReadinessBucket = 'ready' | 'almost' | 'building' | 'not_yet';

/**
 * Map a chapter's readiness level (engine output) to a RoadmapNode status.
 * Tier-1 partial signal: there is no prerequisite graph, so "locked" is only
 * used for chapters with no signal at all (not_yet + zero score).
 */
export function nodeStatusForLevel(
  level: ChapterReadinessLevel,
  score: number,
): RoadmapNodeStatus {
  if (level === 'ready') return 'mastered';
  if (level === 'almost') return 'learning';
  if (level === 'building') return 'needs-revision';
  // not_yet: nothing attempted → locked (greyed). Some score → still learning.
  return score > 0 ? 'learning' : 'locked';
}

/** Bilingual status word for a RoadmapNode (glyph carries the rest). */
export function statusLabel(status: RoadmapNodeStatus, isHi: boolean): string {
  switch (status) {
    case 'mastered':
      return isHi ? 'तैयार' : 'Ready';
    case 'learning':
      return isHi ? 'सीख रहे' : 'Learning';
    case 'needs-revision':
      return isHi ? 'दोहराओ' : 'Revise';
    case 'locked':
    default:
      return isHi ? 'अभी बाकी' : 'Not started';
  }
}

/** Glyph + bilingual label for an overall readiness bucket (never colour-only). */
export function bucketMeta(
  bucket: ReadinessBucket,
  isHi: boolean,
): { glyph: string; label: string; color: string } {
  switch (bucket) {
    case 'ready':
      return { glyph: '✓', label: isHi ? 'परीक्षा के लिए तैयार' : 'Exam-ready', color: 'var(--green, #16A34A)' };
    case 'almost':
      return { glyph: '◑', label: isHi ? 'लगभग तैयार' : 'Almost there', color: 'var(--orange, #E8581C)' };
    case 'building':
      return { glyph: '↻', label: isHi ? 'बन रहा है' : 'Building up', color: '#8B5CF6' };
    case 'not_yet':
    default:
      return { glyph: '○', label: isHi ? 'अभी शुरू करो' : 'Just getting started', color: 'var(--text-3, #9CA3AF)' };
  }
}

/**
 * Collapse the per-bucket counts into one overall readiness bucket + percent.
 * Percent = share of chapters that are "ready". Pure display — not a score.
 */
export function overallReadiness(summary: {
  ready: number;
  almost: number;
  building: number;
  not_yet: number;
}): { bucket: ReadinessBucket; percent: number; total: number } {
  const total = summary.ready + summary.almost + summary.building + summary.not_yet;
  if (total === 0) return { bucket: 'not_yet', percent: 0, total: 0 };
  const percent = Math.round((summary.ready / total) * 100);
  let bucket: ReadinessBucket;
  if (summary.ready / total >= 0.6) bucket = 'ready';
  else if ((summary.ready + summary.almost) / total >= 0.5) bucket = 'almost';
  else if (summary.ready + summary.almost + summary.building > summary.not_yet) bucket = 'building';
  else bucket = 'not_yet';
  return { bucket, percent, total };
}

/**
 * Deep-link target for a chapter's "next action". Reuses existing routes only
 * (quiz / learn-read / foxy) — never invents new URLs or changes quiz/Foxy.
 */
export function nextActionRoute(
  action: string,
  subject: string,
  chapter: number,
): string {
  const s = encodeURIComponent(subject);
  switch (action) {
    case 'mock_exam':
    case 'take_quiz':
      return `/quiz?subject=${s}&chapter=${chapter}`;
    case 'spaced_review':
      return `/quiz?subject=${s}&chapter=${chapter}&mode=review`;
    case 'introduce_concept':
    case 'review_concept':
      return `/learn/${s}/${chapter}`;
    default:
      return `/foxy?subject=${s}&chapter=${chapter}&mode=doubt`;
  }
}

/** Bilingual CTA verb for a next action. */
export function nextActionLabel(action: string, isHi: boolean): string {
  switch (action) {
    case 'mock_exam':
      return isHi ? 'मॉक परीक्षा दो' : 'Take mock exam';
    case 'take_quiz':
      return isHi ? 'क्विज़ दो' : 'Take a quiz';
    case 'spaced_review':
      return isHi ? 'दोहराई करो' : 'Quick revision';
    case 'introduce_concept':
      return isHi ? 'अध्याय पढ़ो' : 'Read the chapter';
    case 'review_concept':
      return isHi ? 'अवधारणा दोहराओ' : 'Review concept';
    default:
      return isHi ? 'Foxy से पूछो' : 'Ask Foxy';
  }
}
