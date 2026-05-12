/**
 * src/lib/challenge/rank-by-weak-topics.ts — pure ranker that picks the
 * "best" daily challenge for a student given their weak-topic stack.
 *
 * Phase 5 follow-on of ADR-001. Concept Chain has historically picked
 * one approved daily_challenges row per (grade, date), arbitrary order.
 * When ff_personalised_compete_v1 is on, /challenge fetches up to N
 * challenges for the grade-date AND the student's weak topics, then
 * uses THIS function to pick the one whose `topic` / `subject` best
 * overlaps with the weak set.
 *
 * Pure: no I/O. Same inputs → same output. Tested independently.
 *
 * Ranking (highest score wins; ties broken by input order):
 *
 *   +3  challenge.subject + chapter_number matches a weak-topic row
 *   +2  challenge.subject matches a weak-topic subject (any chapter)
 *   +1  challenge.topic (text) contains a weak-topic chapter number
 *       reference like "Chapter 7" / "ch. 7" (heuristic, defensive)
 *   +0  no match — falls through to fallback ordering
 *
 * The +3 lane is strict — we only claim "personalised match" when we
 * can prove the chapter is in the weak set. The +2 lane is the
 * subject-level signal. +1 is a hedge for legacy challenges where
 * `chapter` is text not int. If no challenge scores > 0, the function
 * returns the first input (matches today's grade-wide pick behaviour).
 */

import type { WeakTopic } from '@/lib/state/learner-loop/weak-topics';

/** Subset of daily_challenges columns the ranker reads. Kept narrow so
 *  tests don't have to mock the whole jsonb chain payload. */
export interface RankableChallenge {
  id: string;
  subject: string;
  /** Stored as text — sometimes "7", sometimes "Chapter 7", sometimes null. */
  chapter: string | null;
  topic: string;
}

export interface RankResult<T extends RankableChallenge> {
  /** The picked challenge — the highest-scoring input, or the first
   *  when nothing scored above zero. Null only when the input was empty. */
  picked: T | null;
  /** The score the picked challenge earned. 0 = fallback (no weak-topic
   *  match). The /challenge page can show a "🎯 Personalised" badge
   *  when score > 0. */
  score: 0 | 1 | 2 | 3;
  /** All inputs annotated with their individual score, in input order.
   *  Useful for analytics + tests. */
  ranked: Array<{ challenge: T; score: 0 | 1 | 2 | 3 }>;
}

/**
 * Pure: parse a stored chapter string into a positive int when
 * possible. Handles "7", "Chapter 7", "ch. 7", "Chapter 7: Light", "7. Light".
 * Returns null on no-match. Same regex as parseFoxyChapterNumber +
 * parseChapterNumber (review-grade route).
 */
export function parseChapterFromText(chapter: string | null): number | null {
  if (!chapter) return null;
  const m = chapter.match(/(?:chapter\s+|ch\.?\s+)?(\d{1,3})\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function scoreChallenge<T extends RankableChallenge>(
  challenge: T,
  weakTopics: WeakTopic[],
): 0 | 1 | 2 | 3 {
  if (weakTopics.length === 0) return 0;

  const subjectLower = challenge.subject.toLowerCase();
  const chapterNum = parseChapterFromText(challenge.chapter);

  // +3: exact (subject, chapter) match.
  if (chapterNum !== null) {
    const exact = weakTopics.find(
      w => w.subjectCode === subjectLower && w.chapterNumber === chapterNum,
    );
    if (exact) return 3;
  }

  // +2: subject match (any chapter).
  const subjectMatch = weakTopics.find(w => w.subjectCode === subjectLower);
  if (subjectMatch) return 2;

  // +1: heuristic — topic text mentions a weak chapter number.
  // Only fires when the topic happens to reference a numeric chapter.
  const topic = challenge.topic.toLowerCase();
  for (const w of weakTopics) {
    const regex = new RegExp(`(?:chapter\\s+|ch\\.?\\s+)${w.chapterNumber}\\b`, 'i');
    if (regex.test(topic)) return 1;
  }

  return 0;
}

/**
 * Rank a list of challenges by weak-topic affinity and return the
 * highest-scoring one. Stable on ties: returns the first input among
 * those that share the top score (matches the legacy "first available"
 * pick behaviour for an unranked input).
 */
export function rankChallengesByWeakTopics<T extends RankableChallenge>(
  challenges: T[],
  weakTopics: WeakTopic[],
): RankResult<T> {
  if (challenges.length === 0) {
    return { picked: null, score: 0, ranked: [] };
  }

  const ranked = challenges.map(c => ({
    challenge: c,
    score: scoreChallenge(c, weakTopics),
  }));

  // Stable find-max: keep the first input among those tied for top score.
  let topIdx = 0;
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].score > ranked[topIdx].score) topIdx = i;
  }

  return {
    picked: ranked[topIdx].challenge,
    score: ranked[topIdx].score,
    ranked,
  };
}
