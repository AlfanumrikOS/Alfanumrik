/**
 * /api/learner/memory — student-facing Unified Student Memory surface.
 *
 * Foxy North-Star Phase 1 ("show me what you know about me").
 *
 * GET ?subject=&chapter=
 *   Auth: authorizeRequest(request, 'memory.view_own', { requireStudentId: true })
 *   — the student can ONLY read their own memory (studentId comes from the
 *   RBAC resolution, never from the client). Grade is read from the
 *   server-fetched students row (P5: string "6".."12", normalized via the
 *   shared enrollment-scope helper — never trusted from the client).
 *
 *   Returns a WHITELISTED projection of `getStudentMemory(...)`:
 *     - cognitive:   weakTopics / strongTopics / revisionDue / recentErrors
 *                    (labels + counts only — knowledgeGaps, nextAction,
 *                    loSkills, masteryLevel and recentMisconceptions internals
 *                    are NOT student-facing in v1)
 *     - longMemory:  summary + highConcepts / lowConcepts / topMisconceptions
 *                    (curated labels only)
 *     - preferences: learningStyle + preferredExplanationDepth
 *     - twin:        ALWAYS null in v1 — twin cohort internals carry
 *                    never-disclose guardrails (cohort percentile etc.) and
 *                    are deliberately not projected to students.
 *
 * (The "forget it" DELETE endpoint that used to live here was removed
 * 2026-08-30 along with the DPDP erasure subsystem it was built on — see
 * supabase/migrations/20260830172610_remove_dpdp_erasure_system.sql.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { resolveFoxyEnrollmentScope } from '@alfanumrik/lib/foxy-scope';
import { getStudentMemory } from '@/lib/memory/student-memory';

export const runtime = 'nodejs';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// ─── Whitelisted student-facing projection ───────────────────────────────────
// Explicit field-by-field copies — NEVER a spread of the internal memory
// object, so a new internal field can never leak to students by default.

interface MemoryProjection {
  cognitive: {
    weakTopics: Array<{ title: string; mastery: number; attempts: number }>;
    strongTopics: Array<{ title: string; mastery: number }>;
    revisionDue: Array<{ title: string; lastReviewed: string; mastery: number }>;
    recentErrors: Array<{ errorType: string; count: number }>;
  };
  longMemory: {
    summary: string | null;
    highConcepts: string[];
    lowConcepts: string[];
    topMisconceptions: string[];
  };
  preferences: {
    learningStyle: string | null;
    preferredExplanationDepth: string | null;
  };
  /** Always null in v1 — twin cohort internals are never student-disclosed. */
  twin: null;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'memory.view_own', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;
  const studentId = auth.studentId!;

  const params = request.nextUrl.searchParams;
  const subject = (params.get('subject') ?? '').trim();
  const chapter = (params.get('chapter') ?? '').trim() || null;
  if (!subject) return err('subject is required', 400);

  // Grade comes from the SERVER-fetched students row (P5: string), normalized
  // through the same shared scope helper the Foxy route uses.
  let grade: string | null = null;
  try {
    const { data: studentRow } = await supabaseAdmin
      .from('students')
      .select('subscription_plan, grade')
      .eq('id', studentId)
      .maybeSingle();
    grade = resolveFoxyEnrollmentScope(studentRow ?? null).grade;
  } catch (e) {
    logger.warn('learner_memory_student_fetch_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  if (!grade) {
    // Pre-onboarding (or corrupted) profile — there is no enrolled grade to
    // scope memory reads by. No learner-state read happens.
    return err('Complete onboarding to view your learning memory', 409);
  }

  const memory = await getStudentMemory(studentId, { subject, grade, chapter });

  const projection: MemoryProjection = {
    cognitive: {
      weakTopics: memory.cognitive.weakTopics.map((t) => ({
        title: t.title,
        mastery: t.mastery,
        attempts: t.attempts,
      })),
      strongTopics: memory.cognitive.strongTopics.map((t) => ({
        title: t.title,
        mastery: t.mastery,
      })),
      revisionDue: memory.cognitive.revisionDue.map((t) => ({
        title: t.title,
        lastReviewed: t.lastReviewed,
        mastery: t.mastery,
      })),
      recentErrors: memory.cognitive.recentErrors.map((e) => ({
        errorType: e.errorType,
        count: e.count,
      })),
    },
    longMemory: {
      summary: memory.longMemory.synthesis_summary,
      highConcepts: [...memory.longMemory.high_concepts],
      lowConcepts: [...memory.longMemory.low_concepts],
      topMisconceptions: [...memory.longMemory.top_misconceptions],
    },
    preferences: {
      learningStyle: memory.preferences.learningStyle,
      preferredExplanationDepth: memory.preferences.preferredExplanationDepth,
    },
    // v1: cohort/decay internals stay server-side (never-disclose guardrails).
    twin: null,
  };

  return NextResponse.json({
    success: true,
    data: projection,
  });
}
