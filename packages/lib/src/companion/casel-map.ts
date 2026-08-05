/**
 * ALFANUMRIK — SEL Companion (CASEL Map)
 *
 * Phase 5 S1.5 / U5. Pure, no-I/O module that maps in-session signals to
 * age-appropriate CASEL (Collaborative for Academic, Social, and Emotional
 * Learning) competency moments — a tiny bilingual reflection prompt paired
 * with a Foxy behavior tag.
 *
 * The 5 CASEL core competencies are represented verbatim:
 *   self_awareness · self_management · social_awareness ·
 *   relationship_skills · responsible_decision_making
 *
 * Design invariants:
 *   1. AT MOST ONE SEL moment per session (single rate-limit constant,
 *      enforced via `caselMomentAlreadyShown` on the input signals).
 *   2. Fail-safe: any missing signal returns `null` (never throws).
 *   3. Additive over `cognitive-engine.getReflectionPrompt`: this module
 *      is only consulted when the existing 3 prompts return null.
 *   4. Pure: takes signals, returns a value. No DB / clock / RNG.
 *   5. Bilingual: every prompt ships {en, hi}. P7-compliant.
 *   6. No XP / scoring side-effect: this is display-metadata only. Nothing
 *      here changes score_percent, xp_earned, or P1/P2 outputs.
 */

import type { BloomLevel } from '../cognitive-engine';

// ─── Types ───────────────────────────────────────────────────

export type CaselCompetency =
  | 'self_awareness'
  | 'self_management'
  | 'social_awareness'
  | 'relationship_skills'
  | 'responsible_decision_making';

export const CASEL_COMPETENCIES: readonly CaselCompetency[] = [
  'self_awareness',
  'self_management',
  'social_awareness',
  'relationship_skills',
  'responsible_decision_making',
] as const;

/**
 * The union of in-session signals a CASEL rule may inspect.
 * Keys mirror what `cognitive-engine.getReflectionPrompt` already consumes
 * (consecutiveErrors, consecutiveCorrect, bloomLevel) plus small additions
 * for streak and session-length context.
 *
 * All fields are OPTIONAL — a predicate that reads a missing field must
 * return `false` so `selectCaselMoment` fails safe.
 */
export interface CaselSignals {
  consecutiveErrors?: number;
  consecutiveCorrect?: number;
  bloomLevel?: BloomLevel;
  /** Current daily streak in days (from students.streak_days). */
  streakDays?: number;
  /** Wall-clock minutes since session start. */
  sessionLengthMinutes?: number;
  /** True when this session has already surfaced any CASEL moment. */
  caselMomentAlreadyShown?: boolean;
}

export type SignalPredicate = (signals: CaselSignals) => boolean;

export interface BilingualPrompt {
  en: string;
  hi: string;
}

export interface CaselRule {
  /**
   * A list of predicates; the rule fires when ANY predicate returns true.
   * Each predicate must be pure and MUST return false (not throw) on
   * missing signals.
   */
  triggers: SignalPredicate[];
  /**
   * Short behavior tags for the Foxy UI/tutor to reflect the competency
   * (e.g. "acknowledge feeling", "name the emotion"). Display metadata.
   */
  foxyBehaviors: string[];
  /**
   * Candidate bilingual reflection prompts. The first entry is used by
   * `selectCaselMoment` — the array shape leaves room for future rotation
   * without a schema change.
   */
  reflectionPrompts: BilingualPrompt[];
}

export interface CaselMoment {
  competency: CaselCompetency;
  behavior: string;
  prompt: BilingualPrompt;
}

// ─── Rules ───────────────────────────────────────────────────

/**
 * Safe number accessor: treats null/undefined/NaN as "signal missing"
 * and lets the predicate short-circuit to `false`.
 */
const num = (v: number | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const CASEL_BEHAVIOR_RULES: Record<CaselCompetency, CaselRule> = {
  // Noticing one's own feelings / patterns of thought.
  // Fires when the learner has just started a wrong-answer streak (1 error
  // that survived the metacognitive prompt) OR is deep into a long session.
  self_awareness: {
    triggers: [
      (s) => {
        const e = num(s.consecutiveErrors);
        return e !== null && e === 2;
      },
      (s) => {
        const m = num(s.sessionLengthMinutes);
        return m !== null && m >= 25;
      },
    ],
    foxyBehaviors: ['acknowledge feeling', 'name the emotion'],
    reflectionPrompts: [
      {
        en: 'How are you feeling right now — frustrated, curious, tired?',
        hi: 'अभी तुम कैसा महसूस कर रहे हो — निराश, जिज्ञासु, थके हुए?',
      },
    ],
  },

  // Managing effort, focus, and impulses. Fires on long unbroken sessions
  // where a short break would help — regardless of correctness.
  self_management: {
    triggers: [
      (s) => {
        const m = num(s.sessionLengthMinutes);
        return m !== null && m >= 40;
      },
      (s) => {
        // Even a strong correct streak past a certain point should trigger
        // a "take a breath" pause — protects against fatigue-masked drift.
        const c = num(s.consecutiveCorrect);
        return c !== null && c >= 8;
      },
    ],
    foxyBehaviors: ['suggest a breath', 'invite a short break'],
    reflectionPrompts: [
      {
        en: "You've been at this for a while. Want to take a slow breath before the next one?",
        hi: 'तुम काफ़ी देर से लगे हो। अगले सवाल से पहले एक गहरी साँस लोगे?',
      },
    ],
  },

  // Understanding others' perspectives. Fires at higher Bloom levels where
  // the learner is doing well and can be nudged to consider "who else"
  // this concept helps.
  social_awareness: {
    triggers: [
      (s) => {
        const c = num(s.consecutiveCorrect);
        return c !== null && c >= 3 && s.bloomLevel === 'analyze';
      },
      (s) => s.bloomLevel === 'evaluate' || s.bloomLevel === 'create',
    ],
    foxyBehaviors: ['invite perspective-taking'],
    reflectionPrompts: [
      {
        en: 'Who else in your life could use what you just figured out?',
        hi: 'तुम्हारे जीवन में और कौन इस बात से मदद पा सकता है जो तुमने अभी सीखी?',
      },
    ],
  },

  // Working well with others — Foxy included. Fires on strong streaks
  // where celebrating "learning together" reinforces the relationship.
  relationship_skills: {
    triggers: [
      (s) => {
        const c = num(s.consecutiveCorrect);
        return c !== null && c >= 5;
      },
      (s) => {
        const d = num(s.streakDays);
        return d !== null && d >= 7;
      },
    ],
    foxyBehaviors: ['celebrate together', 'invite share'],
    reflectionPrompts: [
      {
        en: 'Nice teamwork! Want to teach this to a friend or family member?',
        hi: 'बहुत बढ़िया टीमवर्क! क्या तुम इसे किसी दोस्त या घरवाले को सिखाना चाहोगे?',
      },
    ],
  },

  // Making thoughtful choices. Fires after a rough patch (3+ errors) once
  // the standard "pause" prompt has already surfaced, or after a very
  // long streak of easy wins where a strategy check is useful.
  responsible_decision_making: {
    triggers: [
      (s) => {
        const e = num(s.consecutiveErrors);
        return e !== null && e >= 4;
      },
      (s) => {
        const c = num(s.consecutiveCorrect);
        return c !== null && c >= 10;
      },
    ],
    foxyBehaviors: ['invite a plan', 'name the trade-off'],
    reflectionPrompts: [
      {
        en: 'What would be the smartest next step — try again, review the chapter, or take a break?',
        hi: 'सबसे समझदारी वाला अगला कदम क्या होगा — फिर से try, chapter दोहराओ, या break लो?',
      },
    ],
  },
};

// ─── Selector ────────────────────────────────────────────────

/**
 * Deterministic priority order. If multiple competencies fire on the same
 * signal vector, the first match wins. Ordering encodes an editorial
 * pedagogy call: safety/regulation first, cognition second, social third.
 */
const CASEL_PRIORITY: readonly CaselCompetency[] = [
  'self_management',
  'responsible_decision_making',
  'self_awareness',
  'social_awareness',
  'relationship_skills',
] as const;

/**
 * Pick at most one CASEL moment for the current signal snapshot.
 * Returns `null` when:
 *   • no rule fires,
 *   • `signals.caselMomentAlreadyShown === true` (per-session rate-limit),
 *   • `signals` is nullish (fail-safe).
 */
export function selectCaselMoment(signals: CaselSignals | null | undefined): CaselMoment | null {
  if (!signals) return null;
  if (signals.caselMomentAlreadyShown === true) return null;

  for (const competency of CASEL_PRIORITY) {
    const rule = CASEL_BEHAVIOR_RULES[competency];
    let fired = false;
    for (const predicate of rule.triggers) {
      try {
        if (predicate(signals)) {
          fired = true;
          break;
        }
      } catch {
        // Fail-safe: a mis-shaped signal never crashes the selector.
        return null;
      }
    }
    if (!fired) continue;

    const behavior = rule.foxyBehaviors[0];
    const prompt = rule.reflectionPrompts[0];
    if (!behavior || !prompt) continue;

    return { competency, behavior, prompt };
  }

  return null;
}
