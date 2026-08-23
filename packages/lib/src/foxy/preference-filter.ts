/** @license Apache-2.0 */
/**
 * Phase A.2/B.2: Preference-pair quality filter.
 *
 * Pure functions that classify a candidate preference pair as
 * 'high' | 'low' | 'discard' quality. Used by Phase B's A/B collection
 * pipeline to decide which pairs enter the training dataset.
 *
 * No I/O, no DB, no LLM. Pure functions operating on plain objects.
 * Testable, auditable, assessment-reviewable.
 */

/** A candidate preference pair captured from the A/B UI. */
export interface PreferencePairCandidate {
  /** UUID of the winning (chosen) response. */
  winningMessageId: string;
  /** UUID of the losing (not chosen) response. */
  loserMessageId: string;
  /** Which label the student chose: 'response_a' | 'response_b'. */
  chosenLabel: 'response_a' | 'response_b';
  /** Coach mode of the winning response. */
  winningCoachMode: string | null;
  /** Coach mode of the losing response. */
  loserCoachMode: string | null;
  /** Explanation format of the winning response (closed enum or null). */
  winningFormat: string | null;
  /** Explanation format of the losing response (closed enum or null). */
  loserFormat: string | null;
  /** Milliseconds between when the A/B pair was shown and when the student chose. */
  timeToChoiceMs: number;
  /** Whether the student had previously given 👎 feedback on the original message. */
  previousThumbsDown: boolean;
}

/** Quality classification for a preference pair. */
export type PreferenceQuality = 'high' | 'low' | 'discard';

/** Reason code for why a pair was classified as low or discard. */
export type QualityReason =
  | 'incomparable_coach_modes'
  | 'incomparable_formats'
  | 'too_similar'
  | 'rushed_choice'
  | 'pre_existing_negative_feedback'
  | 'out_of_scope_response'
  | 'abstain_response'
  | 'missing_context';

/** Result of classifying one preference pair candidate. */
export interface PreferenceQualityResult {
  quality: PreferenceQuality;
  /** Human-readable reason code. Present only when quality is 'low' or 'discard'. */
  reason?: QualityReason;
}

// ── Filter rules ───────────────────────────────────────────────────────────
// Assessment-reviewed. Each rule is a pure predicate on the candidate.
// Rules are applied in order; the first matching rule determines the result.
// If no rule matches, the pair is 'high' quality.

// Valid coach modes (mirrors the CHECK constraint on foxy_chat_messages.coach_mode_used).
const VALID_COACH_MODES = new Set(['socratic', 'answer', 'review']);

// Valid explanation formats (mirrors identifyExplanationFormat closed enum).
const VALID_FORMATS = new Set(['practice', 'diagram', 'steps', 'example', 'paragraph']);

/**
 * Is this response "comparable" — i.e., does it contain enough pedagogical
 * content to be meaningfully ranked against another response?
 *
 * A response is NOT comparable if it's an abstain / out-of-scope reply
 * (no real teaching content to compare).
 *
 * This is a heuristic — in a real deployment, the parallel `foxy_quality_scores`
 * table would carry this as a first-class flag (cbse_scope_score, accuracy_score).
 * Here we approximate from coach_mode + format: a response with no coach_mode
 * and no format is likely a malformed / empty response.
 */
function isComparable(candidate: PreferencePairCandidate, role: 'winning' | 'loser'): boolean {
  const mode = candidate[`${role}CoachMode`] as string | null;
  const format = candidate[`${role}Format`] as string | null;

  // Both null → likely empty/malformed response → not comparable.
  if (mode === null && format === null) return false;

  // Known abstain responses: a response that is out-of-scope or abstains
  // has no teaching content to compare. We approximate this as:
  // - coach_mode is null (unknown mode) AND format is 'paragraph' with no substance
  //   (we can't detect substance here without the content, so we flag null mode
  //    + paragraph as "possibly abstain" — assessment may tighten this later).
  //
  // For now, the conservative rule: a null coach_mode is a yellow flag, but
  // not automatic discard (the response may still have content). Assessment
  // can add a `is_abstain` column to foxy_chat_messages later if needed.
  return true;
}

/**
 * Are the two responses different enough to make the preference meaningful?
 *
 * A pair where both responses have the SAME coach_mode AND the SAME explanation
 * format is too similar — the student's choice is likely noise (e.g., picked the
 * one that appeared first, or was distracted). These are 'low' quality.
 *
 * A pair where the responses differ in coach_mode OR format is 'high' quality:
 * the student is expressing a genuine pedagogical preference.
 */
function areResponsesDifferent(candidate: PreferencePairCandidate): boolean {
  const modeDiffers = candidate.winningCoachMode !== candidate.loserCoachMode;
  const formatDiffers = candidate.winningFormat !== candidate.loserFormat;
  return modeDiffers || formatDiffers;
}

/**
 * Classify one preference pair candidate.
 *
 * Rules (applied in order):
 * 1. DISCARD if either response is not comparable (empty/abstain).
 * 2. DISCARD if timeToChoice < 2 seconds (rushed — student didn't read).
 * 3. LOW if the two responses are too similar (same mode + same format).
 * 4. DISCARD if the student had previously 👎 the original message
 *    (their preference may be retaliatory, not pedagogical).
 * 5. HIGH otherwise.
 */
export function classifyPreferencePair(candidate: PreferencePairCandidate): PreferenceQualityResult {
  // Rule 1: both responses must be comparable.
  if (!isComparable(candidate, 'winning') || !isComparable(candidate, 'loser')) {
    return { quality: 'discard', reason: 'missing_context' };
  }

  // Rule 2: rushed choice.
  if (candidate.timeToChoiceMs < 2000) {
    return { quality: 'discard', reason: 'rushed_choice' };
  }

  // Rule 3: too similar → low quality.
  if (!areResponsesDifferent(candidate)) {
    return { quality: 'low', reason: 'too_similar' };
  }

  // Rule 4: pre-existing negative feedback → discard.
  if (candidate.previousThumbsDown) {
    return { quality: 'discard', reason: 'pre_existing_negative_feedback' };
  }

  // Default: high quality.
  return { quality: 'high' };
}

/**
 * Filter an array of candidate pairs, returning only those that pass the
 * quality threshold.
 *
 * @param candidates  Raw candidates from the A/B UI.
 * @param minQuality  Minimum acceptable quality. 'high' keeps only high-quality
 *                    pairs; 'low' also keeps low-quality pairs (for a noisier
 *                    but larger dataset). 'discard' never keeps discarded pairs.
 */
export function filterPreferencePairs(
  candidates: PreferencePairCandidate[],
  minQuality: PreferenceQuality = 'high',
): PreferencePairCandidate[] {
  const qualityRank: Record<PreferenceQuality, number> = {
    discard: 0,
    low: 1,
    high: 2,
  };
  const threshold = qualityRank[minQuality];

  return candidates.filter((c) => {
    const result = classifyPreferencePair(c);
    return qualityRank[result.quality] >= threshold;
  });
}

/**
 * Compute dataset statistics for a batch of classified pairs.
 * Useful for the super-admin AI quality dashboard (Phase A.3) to show
 * how many pairs were collected vs filtered.
 */
export interface PreferenceDatasetStats {
  totalCandidates: number;
  highQuality: number;
  lowQuality: number;
  discarded: number;
  discardReasons: Record<QualityReason, number>;
  lowReasons: Record<QualityReason, number>;
}

export function computePreferenceDatasetStats(
  candidates: PreferencePairCandidate[],
): PreferenceDatasetStats {
  const stats: PreferenceDatasetStats = {
    totalCandidates: candidates.length,
    highQuality: 0,
    lowQuality: 0,
    discarded: 0,
    discardReasons: {} as Record<QualityReason, number>,
    lowReasons: {} as Record<QualityReason, number>,
  };

  for (const c of candidates) {
    const result = classifyPreferencePair(c);
    if (result.quality === 'high') {
      stats.highQuality++;
    } else if (result.quality === 'low') {
      stats.lowQuality++;
      stats.lowReasons[result.reason!] = (stats.lowReasons[result.reason!] ?? 0) + 1;
    } else {
      stats.discarded++;
      stats.discardReasons[result.reason!] = (stats.discardReasons[result.reason!] ?? 0) + 1;
    }
  }

  return stats;
}
