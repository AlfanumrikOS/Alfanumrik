/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 1
 * Goal-Aware Scorecard Sentence
 *
 * Owner: assessment
 * Founder constraint: this file MUST NOT modify any existing file. Pure new module.
 * Other agents will wire callers in behind feature flags.
 *
 * Generates the post-quiz scorecard sentence (en + hi) tailored to the
 * student's academic goal. When `ff_goal_aware_scoring` is ON, QuizResults.tsx
 * will display this sentence in place of (or alongside) the legacy generic
 * line. When the flag is OFF, the existing scorecard text remains unchanged.
 *
 * Pure function. ZERO IO, ZERO React, ZERO LLM. All strings author-written.
 *
 * P1 (score accuracy): this module DOES NOT recompute the score — it accepts
 *   `correct`, `total`, and `scorePercent` from the caller (which sourced
 *   them from the submission response). It MUST NOT recalculate
 *   `Math.round((correct / total) * 100)` here; the caller is the authority.
 * P2 (XP economy): this module DOES NOT recompute XP — it accepts `xpEarned`
 *   from the submission response.
 * P7 (bilingual UI): every output ships en + hi pair. Tone matches the goal's
 *   `scorecardTone` from GOAL_PROFILES.
 *
 * Consumers (will read this in later wiring PRs):
 *  - src/components/quiz/QuizResults.tsx (Phase 1, gated by ff_goal_aware_scoring)
 */

import type { GoalCode } from './goal-profile';
import { GOAL_PROFILES } from './goal-profile';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ScorecardInput {
  goal: GoalCode;
  /** From submission response — DO NOT recompute. */
  correct: number;
  /** From submission response — DO NOT recompute. */
  total: number;
  /** From submission response (already Math.round'd by submitQuizResults). */
  scorePercent: number;
  /** From submission response. */
  xpEarned: number;
  /** AuthContext.isHi — controls language order (Hi first when true). */
  isHi: boolean;
}

export interface ScorecardSentence {
  en: string;
  hi: string;
  /** Tone derived from GOAL_PROFILES[goal].scorecardTone. */
  tone: 'encouraging' | 'analytical' | 'examiner';
}

// ─── Per-goal sentence templates ──────────────────────────────────────────
//
// Author-written. Templates take (correct, total, scorePercent) and return
// the en + hi pair. Score% is included for goals where the spec calls for it
// (everyone except `improve_basics`, which leads with the count to avoid
// fixating beginners on percentage).

type Builder = (
  correct: number,
  total: number,
  scorePercent: number,
) => { en: string; hi: string };

const SENTENCE_BUILDERS: Record<GoalCode, Builder> = {
  improve_basics: (correct, total) => ({
    en: `You're getting it! ${correct}/${total} correct — same concept, slightly harder next time.`,
    hi: `तुम सीख रहे हो! ${correct}/${total} सही — अगली बार थोड़ा कठिन वही टॉपिक।`,
  }),
  pass_comfortably: (_correct, _total, scorePercent) => ({
    en: `${scorePercent}% — solid work. You're on track for board exams.`,
    hi: `${scorePercent}% — मेहनत रंग ला रही है। बोर्ड के लिए तैयार हो रहे हो।`,
  }),
  school_topper: (_correct, _total, scorePercent) => ({
    en: `${scorePercent}% — analyse: which questions cost you the most? Aim for 90% next time.`,
    hi: `${scorePercent}% — सोचो: कौन से सवाल भारी पड़े? अगली बार 90% का लक्ष्य।`,
  }),
  board_topper: (_correct, _total, scorePercent) => ({
    en: `${scorePercent}% — Board-Ready outlook: keep this up across PYQ practice. Examiner tip: re-read your incorrect questions and identify the marking-scheme gap.`,
    hi: `${scorePercent}% — बोर्ड-तैयार रफ़्तार: PYQ प्रैक्टिस में यही जारी रखो। एग्ज़ामिनर टिप: गलत सवाल दोबारा पढ़ो और मार्किंग-स्कीम का गैप पकड़ो।`,
  }),
  competitive_exam: (_correct, _total, scorePercent) => ({
    en: `${scorePercent}% — JEE/NEET pace check: track which chapters slow you down. Targeted IRT set tomorrow.`,
    hi: `${scorePercent}% — JEE/NEET रफ़्तार जांच: देखो कौन से चैप्टर्स धीमा कर रहे हैं। कल टार्गेटेड IRT सेट।`,
  }),
  olympiad: (_correct, _total, scorePercent) => ({
    en: `${scorePercent}% — challenge accepted. For each missed question, try the alternate solution path.`,
    hi: `${scorePercent}% — चुनौती कबूल। हर छूटे सवाल पर वैकल्पिक हल अप्रोच आज़माओ।`,
  }),
};

// ─── Builder ──────────────────────────────────────────────────────────────

/**
 * Build the goal-aware scorecard sentence. Pure function. All numeric inputs
 * are taken AS-IS from the submission response — this function does NOT
 * recompute score or XP (P1, P2).
 *
 * The `isHi` flag does NOT swap which string lives in `en`/`hi` (those are
 * stable language slots so callers can render side-by-side). It is reserved
 * for callers that want to log/announce in the active language; the
 * tone field is always derived from GOAL_PROFILES.
 */
export function buildScorecardSentence(
  input: ScorecardInput,
): ScorecardSentence {
  const { goal, correct, total, scorePercent } = input;
  const profile = GOAL_PROFILES[goal];
  const builder = SENTENCE_BUILDERS[goal];
  const { en, hi } = builder(correct, total, scorePercent);
  return {
    en,
    hi,
    tone: profile.scorecardTone,
  };
}
