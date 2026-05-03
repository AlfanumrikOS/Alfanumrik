/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 0
 * Goal Profile Resolver
 *
 * Owner: assessment
 * Founder constraint: this file MUST NOT modify any existing file. Pure new module.
 * Other agents will wire callers in behind feature flags.
 *
 * Single source of truth for the academic-goal persona table. Every downstream
 * consumer (Foxy persona, scorecard sentence, quiz selection mix, study-plan
 * pacing, progress dashboard callouts) MUST read from `GOAL_PROFILES` here
 * rather than hardcoding values per surface.
 *
 * Consumers (will read this in later wiring PRs):
 *  - src/lib/ai/prompts/foxy-system.ts  (replace single-line GOAL_PROMPT_MAP entry
 *                                        with buildExpandedGoalSection(...) when
 *                                        ff_goal_aware_foxy is on)
 *  - src/lib/goals/goal-personas.ts     (Phase 1 expanded persona — same dir)
 *  - src/lib/goals/scorecard-sentence.ts (Phase 1 scorecard tone — same dir)
 *  - src/components/quiz/QuizResults.tsx (scorecard sentence display — Phase 1)
 *  - src/lib/cognitive-engine.ts        (Phase 2 — difficultyMix + bloomBand
 *                                        weighting in question selection)
 *  - supabase/functions/quiz-generator/  (Phase 2 — sourcePriority filter)
 *
 * Feature flags that gate this module's effect:
 *  - ff_goal_profiles      (master switch — when off, callers fall back to legacy)
 *  - ff_goal_aware_foxy    (Phase 1 — Foxy persona uses buildExpandedGoalSection)
 *  - ff_goal_aware_scoring (Phase 1 — QuizResults shows goal-aware sentence)
 *
 * Pure data + types. ZERO IO, ZERO React, ZERO side effects, ZERO PII handling.
 * All strings are author-written literals — no LLM-generated text in this file.
 *
 * Invariants:
 *  - difficultyMix.{easy,medium,hard} sums to 1.0 within ±1e-9
 *  - bloomBand.min ≤ bloomBand.max, both in {1..6}
 *  - masteryThreshold ∈ (0, 1]
 *  - dailyTargetMinutes > 0
 *  - resolveGoalProfile NEVER throws — returns null on any unknown input
 *  - GOAL_PROFILES is deeply Readonly (TS) and frozen at runtime
 *
 * P5: grade-format invariant is unaffected — this module doesn't carry grade values.
 * P7: bilingual labels and callouts authored in pairs (en + hi).
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type GoalCode =
  | 'board_topper'
  | 'school_topper'
  | 'pass_comfortably'
  | 'competitive_exam'
  | 'olympiad'
  | 'improve_basics';

/** Probabilities sum to 1.0 (within ±1e-9). */
export type DifficultyMix = {
  easy: number;
  medium: number;
  hard: number;
};

/** Bloom's taxonomy levels: 1=remember, 2=understand, 3=apply, 4=analyze,
 *  5=evaluate, 6=create. min ≤ max. */
export type BloomBand = {
  min: 1 | 2 | 3 | 4 | 5 | 6;
  max: 1 | 2 | 3 | 4 | 5 | 6;
};

/** Question-source tags consulted in priority order (first = highest priority). */
export type SourceTag =
  | 'ncert'
  | 'pyq'
  | 'jee_archive'
  | 'neet_archive'
  | 'olympiad'
  | 'curated';

/** Pacing policy for study plans + Foxy mode-selection bias. */
export type PacePolicy =
  | 'patient'
  | 'steady'
  | 'push'
  | 'campaign'
  | 'selective';

/** Tone applied to scorecard sentences after a quiz attempt. */
export type ScorecardTone = 'encouraging' | 'analytical' | 'examiner';

export interface GoalProfile {
  code: GoalCode;
  labelEn: string;
  labelHi: string;
  difficultyMix: DifficultyMix;
  bloomBand: BloomBand;
  sourcePriority: SourceTag[];
  /** Mastery cutoff for "concept mastered" decisions, 0-1. */
  masteryThreshold: number;
  /** Daily study-time recommendation surfaced by progress + study-plan UIs. */
  dailyTargetMinutes: number;
  pacePolicy: PacePolicy;
  scorecardTone: ScorecardTone;
  /** Short EN sentence shown in the dashboard goal callout strip. */
  dashboardCalloutEn: string;
  /** Short HI sentence shown in the dashboard goal callout strip. */
  dashboardCalloutHi: string;
}

// ─── Profile table ────────────────────────────────────────────────────────
//
// Author-written. Edit ONLY with assessment-agent sign-off. Mirrors the
// founder-approved persona table for the Goal-Adaptive Learning Layers spec.

const PROFILES: Record<GoalCode, GoalProfile> = {
  improve_basics: {
    code: 'improve_basics',
    labelEn: 'Improve Basics',
    labelHi: 'बेसिक्स सुधारें',
    difficultyMix: { easy: 0.6, medium: 0.35, hard: 0.05 },
    bloomBand: { min: 1, max: 3 },
    sourcePriority: ['ncert', 'curated'],
    masteryThreshold: 0.6,
    dailyTargetMinutes: 10,
    pacePolicy: 'patient',
    scorecardTone: 'encouraging',
    dashboardCalloutEn: 'Small steps today: 10 minutes is enough to build your base.',
    dashboardCalloutHi: 'आज छोटे कदम: बेसिक्स पक्के करने के लिए 10 मिनट काफी हैं।',
  },
  pass_comfortably: {
    code: 'pass_comfortably',
    labelEn: 'Pass Comfortably',
    labelHi: 'आराम से पास',
    difficultyMix: { easy: 0.4, medium: 0.45, hard: 0.15 },
    bloomBand: { min: 1, max: 4 },
    sourcePriority: ['ncert', 'pyq'],
    masteryThreshold: 0.7,
    dailyTargetMinutes: 20,
    pacePolicy: 'steady',
    scorecardTone: 'encouraging',
    dashboardCalloutEn: 'Steady wins boards: 20 focused minutes on high-frequency topics today.',
    dashboardCalloutHi: 'धीरे-धीरे बोर्ड पक्का: आज 20 मिनट ज़रूरी टॉपिक्स पर लगाओ।',
  },
  school_topper: {
    code: 'school_topper',
    labelEn: 'School Topper',
    labelHi: 'स्कूल टॉपर',
    difficultyMix: { easy: 0.3, medium: 0.5, hard: 0.2 },
    bloomBand: { min: 1, max: 5 },
    sourcePriority: ['ncert', 'pyq', 'curated'],
    masteryThreshold: 0.8,
    dailyTargetMinutes: 30,
    pacePolicy: 'push',
    scorecardTone: 'analytical',
    dashboardCalloutEn: '30 minutes today — push past textbook into application questions.',
    dashboardCalloutHi: 'आज 30 मिनट — किताब से आगे एप्लीकेशन सवालों पर जाओ।',
  },
  board_topper: {
    code: 'board_topper',
    labelEn: 'Board Topper (90%+)',
    labelHi: 'बोर्ड टॉपर (90%+)',
    difficultyMix: { easy: 0.2, medium: 0.45, hard: 0.35 },
    bloomBand: { min: 2, max: 6 },
    sourcePriority: ['pyq', 'ncert', 'curated'],
    masteryThreshold: 0.85,
    dailyTargetMinutes: 45,
    pacePolicy: 'campaign',
    scorecardTone: 'examiner',
    dashboardCalloutEn: "Today's PYQ streak: 5 board questions — examiner mindset on.",
    dashboardCalloutHi: 'आज की PYQ स्ट्रीक: 5 बोर्ड सवाल — एग्ज़ामिनर माइंडसेट।',
  },
  competitive_exam: {
    code: 'competitive_exam',
    labelEn: 'JEE/NEET Preparation',
    labelHi: 'JEE/NEET तैयारी',
    difficultyMix: { easy: 0.1, medium: 0.4, hard: 0.5 },
    bloomBand: { min: 3, max: 6 },
    sourcePriority: ['jee_archive', 'neet_archive', 'ncert', 'curated'],
    masteryThreshold: 0.85,
    dailyTargetMinutes: 60,
    pacePolicy: 'campaign',
    scorecardTone: 'analytical',
    dashboardCalloutEn: '60 minutes today — timed JEE/NEET archive set, watch your pace.',
    dashboardCalloutHi: 'आज 60 मिनट — JEE/NEET आर्काइव सेट, रफ़्तार पर ध्यान दो।',
  },
  olympiad: {
    code: 'olympiad',
    labelEn: 'Olympiad',
    labelHi: 'ओलंपियाड',
    difficultyMix: { easy: 0.05, medium: 0.25, hard: 0.7 },
    bloomBand: { min: 4, max: 6 },
    sourcePriority: ['olympiad', 'ncert', 'curated'],
    masteryThreshold: 0.9,
    dailyTargetMinutes: 60,
    pacePolicy: 'selective',
    scorecardTone: 'analytical',
    dashboardCalloutEn: 'One olympiad-grade problem today — multiple solution paths welcome.',
    dashboardCalloutHi: 'आज एक ओलंपियाड-स्तर का सवाल — कई हल अप्रोच आज़माओ।',
  },
};

// Deep-freeze: Readonly type at compile time, Object.freeze at runtime so any
// accidental mutation throws in dev/test (catches bugs in callers).
function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const value = (obj as Record<string, unknown>)[key];
      if (value && typeof value === 'object') {
        deepFreeze(value);
      }
    }
    Object.freeze(obj);
  }
  return obj as Readonly<T>;
}

export const GOAL_PROFILES: Readonly<Record<GoalCode, GoalProfile>> =
  deepFreeze(PROFILES);

// ─── Helpers ──────────────────────────────────────────────────────────────

const KNOWN_GOAL_CODES = new Set<GoalCode>([
  'board_topper',
  'school_topper',
  'pass_comfortably',
  'competitive_exam',
  'olympiad',
  'improve_basics',
]);

/**
 * True if `value` is a recognized GoalCode string. Discriminating type guard.
 * Safe to call on any input — never throws.
 */
export function isKnownGoalCode(value: unknown): value is GoalCode {
  return typeof value === 'string' && KNOWN_GOAL_CODES.has(value as GoalCode);
}

/**
 * Resolve a stored `students.academic_goal` value to its frozen GoalProfile.
 * Returns null for null/undefined/empty/unknown — callers MUST handle null
 * by falling back to legacy behavior (single-line GOAL_PROMPT_MAP, default
 * scorecard line, etc). Never throws.
 */
export function resolveGoalProfile(
  code: string | null | undefined,
): GoalProfile | null {
  if (!code) return null;
  if (!isKnownGoalCode(code)) return null;
  return GOAL_PROFILES[code];
}
