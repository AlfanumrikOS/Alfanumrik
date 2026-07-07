/**
 * POST /api/learner/lesson/progress — server-side chapter progress update
 *                                      with lesson_completed event publish.
 *
 * Phase 2c of ADR-001 (The Learner Loop). The legacy client-side helper
 * `updateChapterProgress()` in src/lib/supabase.ts called the
 * `update_chapter_progress` RPC directly. This route is a server-side
 * counterpart that:
 *
 *   1. Calls the same RPC so behaviour is byte-identical for the
 *      progress projection (chapter_progress row).
 *   2. Reads chapter_progress BEFORE and AFTER the RPC to detect a
 *      false → true transition on `is_completed`.
 *   3. Publishes `learner.lesson_completed` exactly once per first
 *      completion — never on subsequent activity touches.
 *
 * Auth: cookie-based session client (matches /api/learner/next), so
 * auth.uid() inside the SECURITY DEFINER RPC sees the actual learner.
 * The route refuses if the learner has no `students` row.
 *
 * Idempotency: key is `lesson_completed:{progressId}` (the
 * chapter_progress row id). The bus's UNIQUE constraint dedupes if a
 * client retry hits the same transition twice. Subsequent legitimate
 * re-completions (after re-opening the chapter) are caught by the
 * before/after check — if before.is_completed was already true, no
 * event publishes.
 *
 * Request:
 *   { subject: string, grade: string, chapterNumber: int positive,
 *     startedAt?: ISO datetime }
 *
 * Response (200):
 *   { ok: true, completed: boolean, progressId: uuid|null,
 *     transitionedToCompleted: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';

const RequestSchema = z.object({
  subject: z.string().min(1).max(64),
  grade: z.string().min(1).max(8),
  chapterNumber: z.number().int().positive().max(99),
  /** Optional — clients that track lesson session start can pass it to
   *  fill the durationSec field on the event. Missing → durationSec 0. */
  startedAt: z.string().datetime().optional(),
});

interface ProgressRowMinimal {
  id: string;
  is_completed: boolean | null;
  completed_at: string | null;
}

/**
 * Pure: given the before/after chapter_progress rows, decide whether
 * this RPC call caused the false→true transition that should publish
 * a learner.lesson_completed event. Exported for testing.
 *
 *   - Before missing (first-ever quiz on this chapter) AND after is
 *     completed → transition. Publish.
 *   - Before existed AND was not completed AND after is completed →
 *     transition. Publish.
 *   - Before already completed → no transition. Skip.
 *   - After not completed (typical partial-completion path) → no
 *     transition. Skip.
 */
export function shouldPublishLessonCompleted(
  before: ProgressRowMinimal | null,
  after: ProgressRowMinimal | null,
): boolean {
  if (!after) return false;
  if (after.is_completed !== true) return false;
  if (before === null) return true;
  return before.is_completed !== true;
}

/**
 * Pure: compute durationSec from an optional client-provided startedAt.
 * Floors at 0 (no negatives), caps at 6h (defends against pathological
 * clock skew or paused-tab carryovers). Exported for testing.
 */
export function computeDurationSec(
  startedAtIso: string | undefined,
  now: Date,
): number {
  if (!startedAtIso) return 0;
  const parsed = Date.parse(startedAtIso);
  if (!Number.isFinite(parsed)) return 0;
  const deltaMs = now.getTime() - parsed;
  if (deltaMs <= 0) return 0;
  const sec = Math.round(deltaMs / 1000);
  return Math.min(sec, 6 * 60 * 60); // 6h cap
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  // Auth.
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Body validate.
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'invalid_body', detail: (err as Error).message.slice(0, 300) },
      { status: 400 },
    );
  }
  const { subject, grade, chapterNumber, startedAt } = body;

  // Resolve student id + tenant from the learner's own students row.
  // school_id is surfaced for tenantId on the event envelope.
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (studentErr) {
    logger.warn('lesson/progress: students lookup failed', { userId, error: studentErr.message });
    return NextResponse.json({ ok: false, error: 'student_lookup_failed' }, { status: 500 });
  }
  const student = studentRow as { id: string; school_id: string | null } | null;
  if (!student) {
    return NextResponse.json({ ok: false, error: 'no_student_profile' }, { status: 404 });
  }
  const studentId = student.id;
  const tenantId = student.school_id ?? null;

  // Read the BEFORE row so we can detect a transition.
  const before = await readProgressRow(supabase, studentId, subject, grade, chapterNumber);

  // Run the RPC. Uses the cookie-bound client so auth.uid() inside the
  // SECURITY DEFINER function matches the caller, satisfying the access
  // check in update_chapter_progress.
  const { error: rpcErr } = await supabase.rpc('update_chapter_progress', {
    p_student_id: studentId,
    p_subject: subject,
    p_grade: grade,
    p_chapter_number: chapterNumber,
  });
  if (rpcErr) {
    logger.warn('lesson/progress: update_chapter_progress RPC failed', {
      userId, subject, grade, chapterNumber, error: rpcErr.message,
    });
    return NextResponse.json(
      { ok: false, error: 'rpc_failed', detail: rpcErr.message.slice(0, 300) },
      { status: 500 },
    );
  }

  // Read AFTER. If the chapter wasn't found in chapters (e.g. invalid
  // chapter_number for this grade/subject), the RPC silently RETURNs
  // without inserting; `after` will then be null and we publish nothing.
  const after = await readProgressRow(supabase, studentId, subject, grade, chapterNumber);

  const now = new Date();
  const transitionedToCompleted = shouldPublishLessonCompleted(before, after);

  if (transitionedToCompleted && after) {
    // Best-effort publish — never block the response. Gated by
    // ff_event_bus_v1 inside publishEvent.
    try {
      await publishEvent(supabaseAdmin, {
        kind: 'learner.lesson_completed',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorAuthUserId: userId,
        tenantId,
        idempotencyKey: `lesson_completed:${after.id}`,
        payload: {
          lessonId: after.id,
          subjectCode: subject.toLowerCase(),
          chapterNumber,
          durationSec: computeDurationSec(startedAt, now),
        },
      });
    } catch (err) {
      logger.warn('lesson/progress: publishEvent learner.lesson_completed failed', {
        progressId: after.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      completed: after?.is_completed === true,
      progressId: after?.id ?? null,
      transitionedToCompleted,
    },
    { status: 200 },
  );
}

async function readProgressRow(
  sb: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  studentId: string,
  subject: string,
  grade: string,
  chapterNumber: number,
): Promise<ProgressRowMinimal | null> {
  const { data, error } = await sb
    .from('chapter_progress')
    .select('id, is_completed, completed_at')
    .eq('student_id', studentId)
    .eq('subject', subject)
    .eq('grade', grade)
    .eq('chapter_number', chapterNumber)
    .maybeSingle();
  if (error) {
    logger.warn('lesson/progress: chapter_progress read failed', {
      studentId, subject, grade, chapterNumber, error: error.message,
    });
    return null;
  }
  return (data as ProgressRowMinimal | null);
}
