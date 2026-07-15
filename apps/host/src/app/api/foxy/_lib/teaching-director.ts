/**
 * /api/foxy — Teaching Director wiring helpers (Phase 2.1, 2026-07-15).
 *
 * Thin, co-located adapter that plugs the PURE, assessment-owned
 * `composeTeachingPlan` (packages/lib/src/foxy/teaching-director.ts) into the
 * Foxy turn. Everything here is gated by the route behind
 * `ff_foxy_teaching_director_v1` (default OFF): when OFF none of these run and
 * the turn is byte-identical to today.
 *
 * Split of responsibilities:
 *   • loadLessonStepState  — best-effort READ of the persisted per-session
 *     lesson step from foxy_sessions → LessonState | null (cold start).
 *   • maybeComposeTeachingPlan — guarded call to the pure Director; ANY failure
 *     returns null so the turn is a safe no-op.
 *   • buildTeachingDirectorSection — PURE builder of the additive directive
 *     string. The route APPENDS it to the `cognitive_context_section` template
 *     variable — the SAME reliably-rendered slot the Digital Twin uses
 *     ({{cognitive_context_section}} exists in every foxy_tutor_* template;
 *     {{foxy_system_prompt}} does not). It ONLY tells Foxy WHAT to teach + HOW
 *     deep; it never overrides reference_material or the safety rails (P12).
 *     Bilingual whyNow (P7).
 *   • persistLessonProgress — best-effort WRITE of the advanced lesson step (+
 *     objective concept id when it is a valid chapter_concepts row) back to
 *     foxy_sessions so the lesson progresses next turn. A failure NEVER affects
 *     the turn.
 *
 * SAFETY: the Director only adds a directive string + two envelope fields. It
 * does NOT change the RAG / grounding / abstain / structured-validation path.
 * P13: logs carry enums/scope only — never concept titles, ids, or student PII.
 *
 * Owner: ai-engineer (route wiring). Reviewers (P14): assessment (pedagogy
 * correctness), testing, frontend (renders suggestedButtons next).
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  composeTeachingPlan,
  type TeachingDirectorInput,
  type TeachingPlan,
} from '@alfanumrik/lib/foxy/teaching-director';
import {
  LESSON_STEPS,
  type LessonStep,
  type LessonState,
} from '@alfanumrik/lib/cognitive-engine';

// Re-export the plan type so the route imports its whole Director surface from
// this one co-located module.
export type { TeachingPlan } from '@alfanumrik/lib/foxy/teaching-director';

// Fast membership check for the persisted lesson_step string (matches the
// foxy_sessions.lesson_step CHECK constraint value set in migration
// 20260715140000). Any value outside this set is treated as "no lesson yet".
const LESSON_STEP_SET: ReadonlySet<string> = new Set<string>(LESSON_STEPS);

// Human-readable one-line teaching guidance per lesson step. English model-
// directive prose (same family as MODE_DIRECTIVES / FOXY_SAFETY_RAILS); the
// student-facing bilingual copy lives in the plan's whyNow reason.
const LESSON_STEP_GUIDANCE: Record<LessonStep, string> = {
  hook: 'Open with a short, relatable hook that sparks curiosity about the concept.',
  visualization:
    'Build a clear mental picture — use an analogy or a concrete, worked-in-words example.',
  guided_examples: 'Work through one or two guided examples step by step.',
  active_recall:
    'Prompt the student to recall or apply the idea themselves before you continue.',
  application:
    'Give a short application/transfer problem that uses the concept in a new context.',
  spaced_revision:
    'Briefly revisit and consolidate the concept to reinforce long-term retention.',
};

/**
 * A TEACHING turn is any Foxy mode EXCEPT the MCQ-emitting practice / quiz_me
 * turns. `mode` is already promoted to 'practice' for quiz_me upstream, so the
 * single `mode !== 'practice'` check covers learn/explain/revise/doubt/
 * homework/explorer and excludes quiz_me + practice + real-practice.
 */
export function isTeachingTurn(mode: string): boolean {
  return mode !== 'practice';
}

/**
 * Reconstruct a minimal LessonState from a persisted currentStep. Only
 * `currentStep` is persisted per turn (the recall/application SCORES ride the
 * evidential-quiz path, not the session row), so those are null and
 * stepsCompleted is the prefix before currentStep. getNextLessonStep reads only
 * currentStep (+ recallScore), so this is sufficient for the Director to
 * advance the ladder next turn.
 */
export function lessonStateFromStep(step: LessonStep): LessonState {
  const idx = LESSON_STEPS.indexOf(step);
  return {
    currentStep: step,
    stepsCompleted: idx > 0 ? LESSON_STEPS.slice(0, idx) : [],
    recallScore: null,
    applicationScore: null,
  };
}

/**
 * Best-effort read of the persisted lesson step for a session → LessonState |
 * null. Returns null on ANY failure, when no lesson_step is persisted (cold
 * start → the Director starts the ladder at 'hook'), or on an env whose
 * migration has not landed yet (the SELECT errors → null → cold start). Never
 * throws.
 */
export async function loadLessonStepState(sessionId: string): Promise<LessonState | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('foxy_sessions')
      .select('lesson_step')
      .eq('id', sessionId)
      .maybeSingle();
    if (error || !data) return null;
    const step = (data as { lesson_step?: string | null }).lesson_step ?? null;
    if (!step || !LESSON_STEP_SET.has(step)) return null;
    return lessonStateFromStep(step as LessonStep);
  } catch (err) {
    logger.warn('foxy.teaching_director.lesson_state_load_failed', {
      // P13: category only — no sessionId/studentId/PII.
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Compose the teaching plan, guarded. The pure Director is deterministic and
 * side-effect-free, but ANY unexpected input shape must degrade to today's
 * behavior — so a throw here returns null (safe no-op) rather than surfacing.
 */
export function maybeComposeTeachingPlan(input: TeachingDirectorInput): TeachingPlan | null {
  try {
    return composeTeachingPlan(input);
  } catch (err) {
    logger.warn('foxy.teaching_director.compose_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build the additive Teaching Director directive string. PURE. The route
 * appends the result to the `cognitive_context_section` template variable.
 *
 * Additive-only contract: the section tells Foxy WHAT to teach this turn, WHY
 * now (bilingual, P7), which lesson step to run, and the target Bloom depth —
 * and explicitly reaffirms that the reference material remains the ONLY source
 * of facts. It does NOT restate or override the safety rails or the reference
 * material, so the P12 grounding/abstain path is untouched. P13: concept titles
 * are curriculum content, never student PII.
 */
export function buildTeachingDirectorSection(plan: TeachingPlan): string {
  const obj = plan.currentObjective;
  const concept = obj.conceptName.trim();
  const guidance = LESSON_STEP_GUIDANCE[plan.lessonStep];

  const lines: string[] = [
    '## TEACHING DIRECTOR (your plan for THIS turn — advisory, additive)',
    'This plan tells you WHAT to teach next and HOW deep to go. The reference material above stays your ONLY source of facts — never use this plan to introduce anything not grounded in that material.',
  ];

  if (concept) {
    lines.push(`Teach next: ${concept}`);
  }
  lines.push(`Why now (EN): ${obj.reason.en}`);
  lines.push(`Why now (HI): ${obj.reason.hi}`);
  lines.push(`Lesson step: ${plan.lessonStep} — ${guidance}`);
  lines.push(
    `Depth: aim for Bloom's '${plan.targetBloom}' level this turn and do not exceed it; keep within the '${plan.depthCeiling}' depth ceiling for this learner.`,
  );
  lines.push(
    'Close with at most ONE check question. Do not enumerate a menu of next actions — the student already sees action buttons on screen.',
  );

  return lines.join('\n');
}

/**
 * Best-effort persist of the advanced lesson step (+ objective concept id) back
 * to foxy_sessions so the lesson progresses next turn. NEVER blocks the turn.
 *
 * `lesson_objective_concept_id` FKs to chapter_concepts(id). The Director's
 * `conceptId` is sometimes a curriculum_topics id (see TeachingObjective in the
 * pure module), which would violate that FK — so when a conceptId is present we
 * attempt to write BOTH columns, and on ANY failure fall back to writing ONLY
 * lesson_step (nulling the pointer). The lesson step therefore ALWAYS advances,
 * while the concept pointer is written only when it is a valid chapter_concepts
 * row. Fully guarded; any error is logged (category only) and swallowed.
 */
export async function persistLessonProgress(
  sessionId: string,
  plan: TeachingPlan,
): Promise<void> {
  const conceptId = plan.currentObjective.conceptId;
  try {
    if (conceptId) {
      const { error } = await supabaseAdmin
        .from('foxy_sessions')
        .update({
          lesson_step: plan.lessonStep,
          lesson_objective_concept_id: conceptId,
        })
        .eq('id', sessionId);
      if (!error) return;
      logger.warn('foxy.teaching_director.persist_concept_id_skipped', {
        // P13: Postgres error code only (e.g. 23503 FK violation) — no ids/PII.
        reason: (error as { code?: string }).code ?? 'update_failed',
      });
    }
    // conceptId absent OR the combined write failed → persist lesson_step only
    // (nulling the concept pointer so a stale one does not linger).
    await supabaseAdmin
      .from('foxy_sessions')
      .update({
        lesson_step: plan.lessonStep,
        lesson_objective_concept_id: null,
      })
      .eq('id', sessionId);
  } catch (err) {
    logger.warn('foxy.teaching_director.persist_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
