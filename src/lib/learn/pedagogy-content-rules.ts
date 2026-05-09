/**
 * Alfanumrik — Pedagogy v2 / Wave 1
 * Persona × layer × slot → content selection policy.
 *
 * Pure-function resolver. ZERO IO, ZERO React, ZERO PII handling.
 * Single source of truth for all persona-adaptive content branching in the
 * Daily Rhythm. No persona logic should live anywhere else in
 * src/lib/learn/* or in the rhythm UI.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 *
 * Invariants:
 *  - resolvePedagogyRule NEVER throws, NEVER returns null/undefined.
 *  - For an unknown persona, resolver falls back to 'pass_comfortably' rules
 *    (the safe median behavior).
 *  - improve_basics persona is the ONLY persona where productiveFailure is
 *    flipped off (worked-example-first). Justification: confidence-fragile
 *    students need scaffolding before struggle.
 */

import type { GoalCode } from '../goals/goal-profile';
import { isKnownGoalCode } from '../goals/goal-profile';

// ─── Types ─────────────────────────────────────────────────────────────────

export type RhythmLayer = 'daily';
// Wave 1 only ships the daily layer. Wave 2 will add 'weekly'; Wave 3 'monthly'.

export type RhythmSlot = 'srs_review' | 'zpd_problem' | 'reflection';

export type ProblemFlavor =
  | 'board_pattern'
  | 'intuition_led'
  | 'prerequisite_repair'
  | 'enrichment'
  | 'puzzle';

export type DepthCeiling =
  | 'within_grade'
  | 'board_rigorous'
  | 'jee_neet'
  | 'olympiad';

export interface PedagogyRule {
  /** ZPD slot: present problem before tutorial reveal? */
  productiveFailure: boolean;
  /** ZPD slot: show worked example BEFORE the problem? (Inverts productive failure.) */
  workedExampleFirst: boolean;
  /** ZPD slot: which kind of problem to assemble. */
  problemFlavor: ProblemFlavor | null;
  /** ZPD slot: difficulty/depth ceiling for problem selection. */
  depthCeiling: DepthCeiling;
  /** SRS slot: pull from due-cards pool? (Always true today; future versions may vary.) */
  useDueCardsPool: boolean;
  /** SRS slot: allow ahead-of-grade reviews to be interleaved? */
  allowAheadOfGrade: boolean;
  /** Reflection slot: use cognitive-engine.getReflectionPrompt? */
  useReflectionPromptGenerator: boolean;
  /** XP awarded for this slot's completion (0 = no XP, mastery is signal). */
  xpAwarded: number;
}

// ─── Per-persona ZPD rules ──────────────────────────────────────────────────

const ZPD_RULES: Record<GoalCode, Pick<PedagogyRule, 'productiveFailure' | 'workedExampleFirst' | 'problemFlavor' | 'depthCeiling'>> = {
  improve_basics: {
    productiveFailure: false,
    workedExampleFirst: true,
    problemFlavor: 'prerequisite_repair',
    depthCeiling: 'within_grade',
  },
  pass_comfortably: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'board_pattern',
    depthCeiling: 'within_grade',
  },
  school_topper: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'intuition_led',
    depthCeiling: 'board_rigorous',
  },
  board_topper: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'board_pattern',
    depthCeiling: 'board_rigorous',
  },
  competitive_exam: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'enrichment',
    depthCeiling: 'jee_neet',
  },
  olympiad: {
    productiveFailure: true,
    workedExampleFirst: false,
    problemFlavor: 'puzzle',
    depthCeiling: 'olympiad',
  },
};

const FALLBACK_PERSONA: GoalCode = 'pass_comfortably';

// ─── Public API ────────────────────────────────────────────────────────────

export function resolvePedagogyRule(
  persona: GoalCode | string | null | undefined,
  layer: RhythmLayer,
  slot: RhythmSlot,
): PedagogyRule {
  const safePersona: GoalCode = (persona && isKnownGoalCode(persona))
    ? persona
    : FALLBACK_PERSONA;

  if (slot === 'zpd_problem') {
    const z = ZPD_RULES[safePersona];
    return {
      productiveFailure: z.productiveFailure,
      workedExampleFirst: z.workedExampleFirst,
      problemFlavor: z.problemFlavor,
      depthCeiling: z.depthCeiling,
      useDueCardsPool: false,
      allowAheadOfGrade: false,
      useReflectionPromptGenerator: false,
      xpAwarded: 0,
    };
  }

  if (slot === 'srs_review') {
    const allowAhead = safePersona === 'competitive_exam' || safePersona === 'olympiad';
    return {
      productiveFailure: false,
      workedExampleFirst: false,
      problemFlavor: null,
      depthCeiling: ZPD_RULES[safePersona].depthCeiling,
      useDueCardsPool: true,
      allowAheadOfGrade: allowAhead,
      useReflectionPromptGenerator: false,
      xpAwarded: 0,
    };
  }

  // slot === 'reflection'
  return {
    productiveFailure: false,
    workedExampleFirst: false,
    problemFlavor: null,
    depthCeiling: ZPD_RULES[safePersona].depthCeiling,
    useDueCardsPool: false,
    allowAheadOfGrade: false,
    useReflectionPromptGenerator: true,
    xpAwarded: 0,
  };
}
