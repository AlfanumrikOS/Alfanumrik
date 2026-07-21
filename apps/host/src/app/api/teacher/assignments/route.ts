/**
 * POST /api/teacher/assignments
 *
 * Phase B.5 (ADR-005). Creates an assignment row owned by the
 * authenticated teacher and emits `teacher.assignment_created`.
 * Replaces the direct `supabase.from('assignments').insert(...)` call
 * in src/app/teacher/assignments/page.tsx (handleCreateAssignment).
 *
 * Body fields mirror the legacy direct-insert payload from the page:
 *   { class_id, title, subject?, grade?, chapter?, difficulty?,
 *     question_count?, due_date?, type? }
 *
 * Ownership: class_id MUST be a class the teacher owns (verified via
 * class_teachers). Cross-class assignment is rejected.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';

const BodySchema = z.object({
  class_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  subject: z.string().trim().max(64).nullable().optional(),
  grade: z.string().trim().max(4).nullable().optional(),
  chapter: z.string().trim().max(200).nullable().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  question_count: z.number().int().min(1).max(200).optional(),
  due_date: z.string().nullable().optional(),
  type: z.enum(['quiz', 'worksheet']).optional(),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  // Resolve teacher row.
  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_assignments_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/assignments',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // Ownership of class_id.
  const { data: link, error: linkErr } = await supabaseAdmin
    .from('class_teachers')
    .select('class_id')
    .eq('class_id', body.class_id)
    .eq('teacher_id', teacher.id)
    .maybeSingle();
  if (linkErr) {
    logger.error('teacher_assignments_link_lookup_failed', {
      error: new Error(linkErr.message),
      route: 'teacher/assignments',
    });
    return err('Failed to verify class ownership', 500);
  }
  if (!link) return err('You do not own this class', 403);

  const assignmentId = randomUUID();
  const now = new Date().toISOString();
  const type = body.type ?? 'quiz';
  const difficulty = body.difficulty ?? 'medium';
  const questionCount = body.question_count ?? 10;
  const dueAt = body.due_date && body.due_date.length > 0 ? body.due_date : null;
  const subjectCode = body.subject ?? null;
  const grade = body.grade ?? null;
  const chapter = body.chapter && body.chapter.length > 0 ? body.chapter : null;

  // Emit event first. The catalog already had `teacher.assignment_created`;
  // we now wire it live. Subscribers can pick it up to fan out
  // notifications to enrolled students.
  try {
    // chapterNumbers comes from the chapter free-text field — parse a
    // leading positive integer when present. Empty array if we can't
    // extract one.
    const chapterNumbers: number[] = [];
    if (chapter) {
      const m = chapter.match(/(?:chapter\s+)?(\d{1,3})\b/i);
      const n = m ? parseInt(m[1], 10) : NaN;
      if (Number.isFinite(n) && n > 0) chapterNumbers.push(n);
    }
    await publishEvent(supabaseAdmin, {
      kind: 'teacher.assignment_created',
      eventId: randomUUID(),
      occurredAt: now,
      actorAuthUserId: auth.userId!,
      tenantId: (teacher as { school_id?: string | null }).school_id ?? null,
      idempotencyKey: `assignment_created:${assignmentId}`,
      payload: {
        assignmentId,
        classId: body.class_id,
        subjectCode: subjectCode ?? '',
        chapterNumbers,
        dueAt,
      },
    });
  } catch (e) {
    logger.warn('teacher_assignment_created_publish_failed', {
      route: 'teacher/assignments',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // TODO: extract to projector subscriber. `assignments` is a
  // route-owned operational table today.
  //
  // Column-name note (production incident, 2026-07-21): `assignments` has NO
  // `type` or `is_active` column — it has `assignment_type` (default
  // 'practice') and `status` (default 'active') instead. This insert
  // previously wrote `type`/`is_active`/`chapter`/`difficulty`, none of which
  // existed, so it 500'd on every call ("Failed to create assignment").
  // `chapter`/`difficulty` are now real columns (migration
  // 20260721000300_assignments_add_chapter_difficulty.sql); `type` maps onto
  // the existing `assignment_type` column and `is_active: true` maps onto
  // `status: 'active'` — no redundant columns added.
  const { error: insertErr } = await supabaseAdmin.from('assignments').insert({
    id: assignmentId,
    teacher_id: teacher.id,
    class_id: body.class_id,
    title: body.title,
    assignment_type: type,
    subject: subjectCode,
    grade,
    chapter,
    difficulty,
    question_count: questionCount,
    due_date: dueAt,
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  if (insertErr) {
    logger.error('teacher_assignments_insert_failed', {
      error: new Error(insertErr.message),
      route: 'teacher/assignments',
    });
    return err('Failed to create assignment', 500);
  }

  return NextResponse.json({ success: true, assignmentId });
}
