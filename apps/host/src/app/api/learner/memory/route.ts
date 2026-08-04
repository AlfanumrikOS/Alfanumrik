/**
 * /api/learner/memory — student-facing Unified Student Memory surface.
 *
 * Foxy North-Star Phase 1 ("show me what you know about me / forget it").
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
 *   When the DPDP erasure guard trips (in-flight erasure request), returns
 *   fully-empty layers + `erasurePending: true` without touching any
 *   learner-state table.
 *
 * DELETE { scope: { layer: 'preferences'|'long_memory'|'twin'|'cognitive', subject? } }
 *   Auth: authorizeRequest(request, 'memory.erase_own', { requireStudentId: true }).
 *   Inserts a `data_erasure_requests` row (status 'pending') carrying the
 *   scope JSONB. Effect is two-fold:
 *     1. IMMEDIATE: the pending row trips the fail-closed erasure guard in
 *        getStudentMemory, so every memory read (including Foxy prompt
 *        assembly) goes empty right away.
 *     2. DEFERRED: physical purge within 30 days (purge_at = now()+30d) by
 *        the erasure worker. NOTE: the worker's cascade is the SQL function
 *        `execute_data_erasure_purge` — the scoped (per-layer) purge branch
 *        is an architect follow-up on that function; see the PR report.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { resolveFoxyEnrollmentScope } from '@alfanumrik/lib/foxy-scope';
import { isErasurePending } from '@alfanumrik/lib/memory/erasure-guard';
import { getStudentMemory } from '@/lib/memory/student-memory';

export const runtime = 'nodejs';

const SCOPE_LAYERS = ['preferences', 'long_memory', 'twin', 'cognitive'] as const;

const DeleteBodySchema = z.object({
  scope: z.object({
    layer: z.enum(SCOPE_LAYERS),
    subject: z.string().trim().min(1).max(100).optional(),
  }),
});

/** Physical purge SLA surfaced to the student (purge_at = now() + 30 days). */
const SCOPED_PURGE_DAYS = 30;

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

const EMPTY_PROJECTION: MemoryProjection = {
  cognitive: { weakTopics: [], strongTopics: [], revisionDue: [], recentErrors: [] },
  longMemory: { summary: null, highConcepts: [], lowConcepts: [], topMisconceptions: [] },
  preferences: { learningStyle: null, preferredExplanationDepth: null },
  twin: null,
};

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

  // DPDP erasure guard FIRST (fail-closed inside the helper): when an erasure
  // is in flight we return empty layers + the flag, touching nothing else.
  const erasurePending = await isErasurePending(studentId);
  if (erasurePending) {
    return NextResponse.json({
      success: true,
      data: { ...EMPTY_PROJECTION, erasurePending: true },
    });
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
    data: { ...projection, erasurePending: false },
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await authorizeRequest(request, 'memory.erase_own', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;
  const studentId = auth.studentId!;

  let body: z.infer<typeof DeleteBodySchema>;
  try {
    body = DeleteBodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }
  const scope = {
    layer: body.scope.layer,
    ...(body.scope.subject ? { subject: body.scope.subject } : {}),
  };

  const purgeAt = new Date(Date.now() + SCOPED_PURGE_DAYS * 86_400_000).toISOString();

  // Insert the scoped erasure request. status 'pending' immediately trips the
  // fail-closed erasure guard (memory reads go empty NOW); the physical purge
  // happens within 30 days via the erasure worker.
  //
  // guardian_id is null for student-initiated scoped requests — this is a
  // self-service DPDP action, not the parent-initiated full-account flow.
  // (guardian_id nullability: migration 20260806000600; `scope` JSONB column:
  // migration 20260806000300.)
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('data_erasure_requests')
    .insert({
      student_id: studentId,
      guardian_id: null,
      status: 'pending',
      purge_at: purgeAt,
      reason: 'student_scoped_memory_erasure',
      scope,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    logger.error('learner_memory_erasure_insert_failed', {
      error: new Error(insertErr?.message ?? 'no row returned'),
      route: 'learner/memory',
    });
    return err('Failed to record erasure request', 500);
  }

  // Audit — metadata only: layer + subject flag, never memory content (P13).
  try {
    await logAudit(auth.userId!, {
      action: 'memory.erase_own',
      resourceType: 'data_erasure_requests',
      resourceId: (inserted as { id: string }).id,
      details: {
        layer: scope.layer,
        has_subject: Boolean(body.scope.subject),
        purge_at: purgeAt,
      },
      status: 'success',
    });
  } catch {
    /* audit failures must never break the request */
  }

  return NextResponse.json({
    accepted: true,
    note: 'memory blanked immediately; purge within 30 days',
  });
}
