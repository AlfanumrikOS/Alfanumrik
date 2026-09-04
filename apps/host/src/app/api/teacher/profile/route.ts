/**
 * PATCH /api/teacher/profile
 *
 * Updates teacher profile: name, school_name, subjects_taught.
 * Replaces direct anon-client write in teacher/profile/page.tsx.
 *
 * subjects_taught (added 2026-07-21, teacher-dashboard-deep-rca incident):
 * self-serve fix for teacher accounts whose `subjects_taught` ended up
 * empty/null (e.g. created via school-admin bulk-import without subjects, or
 * pre-fix self-signup bootstrap drift) and could previously only be fixed by
 * a school admin or support. Validated against the active `subjects` master —
 * unknown/inactive codes are rejected (400), never silently dropped, since
 * this is a teacher-initiated write (unlike the read-side GET /api/teacher/subjects
 * which silently drops stale codes for display purposes).
 *
 * Auth (P9): authorizeRequest(request, 'profile.update_own'). That permission
 * is already granted to the `teacher` role in the RBAC matrix
 * (20260612123200_rbac_matrix_conformance.sql) — the same code the sibling
 * `parent`/`student` profile routes use — so NO new permission code is
 * introduced. This route previously bypassed authorizeRequest entirely with a
 * raw hand-rolled Bearer-token check via supabaseAdmin's auth client; it now
 * follows the same house pattern every other teacher route uses. authorizeRequest accepts both
 * the Bearer JWT this route previously parsed by hand AND the Supabase cookie
 * session, so existing callers keep working.
 *
 * Self-scope (no IDOR): the update target is the caller's OWN teacher row,
 * resolved from the authorizeRequest-verified auth.userId via
 * getTeacherByAuthUserId. No body-supplied id is ever used to select the row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getTeacherByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { logger } from '@alfanumrik/lib/logger';
import { logTeacherAudit } from '@alfanumrik/lib/audit';

const BodySchema = z.object({
  name: z.string().trim().min(2, 'name must be 2–100 characters').max(100, 'name must be 2–100 characters').optional(),
  school_name: z.string().trim().max(200, 'school_name cannot exceed 200 characters').optional(),
  subjects_taught: z
    .array(z.string().trim().min(1))
    .min(1, 'subjects_taught must include at least one subject')
    .optional(),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(request: NextRequest) {
  // P9: authenticated session + permission gate (granted to the teacher role).
  const auth = await authorizeRequest(request, 'profile.update_own');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const teacherResult = await getTeacherByAuthUserId(auth.userId!);
  if (!teacherResult.ok || !teacherResult.data) {
    return err('Teacher account not found', 404);
  }
  const teacherId = teacherResult.data.id;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid request body';
    return err(msg, 400);
  }

  const { name, school_name, subjects_taught } = body;
  const updatePayload: Record<string, string | string[]> = {};

  if (name !== undefined) {
    updatePayload.name = name;
  }

  if (school_name !== undefined) {
    updatePayload.school_name = school_name;
  }

  if (subjects_taught !== undefined) {
    const codes = Array.from(new Set(subjects_taught.map((c) => c.trim())));
    if (codes.length === 0) {
      return err('subjects_taught must include at least one subject', 400);
    }
    // Validate every code exists in the active subjects master — a
    // teacher-initiated write must reject unknown/inactive codes, not
    // silently drop them.
    const { data: activeRows, error: activeErr } = await supabaseAdmin
      .from('subjects')
      .select('code')
      .eq('is_active', true)
      .in('code', codes);
    if (activeErr) {
      logger.error('teacher_profile_subjects_validation_failed', {
        error: new Error(activeErr.message),
        teacherId,
      });
      return err('Failed to validate subjects', 500);
    }
    const activeSet = new Set((activeRows ?? []).map((r: { code: string }) => r.code));
    const invalid = codes.filter((c) => !activeSet.has(c));
    if (invalid.length > 0) {
      return NextResponse.json(
        { success: false, error: `Unknown or inactive subject code(s): ${invalid.join(', ')}` },
        { status: 400 },
      );
    }
    updatePayload.subjects_taught = codes;
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ success: true, message: 'No changes' });
  }

  const { error } = await supabaseAdmin.from('teachers').update(updatePayload).eq('id', teacherId);
  if (error) {
    logger.error('teacher_profile_update_failed', { error: new Error(error.message), teacherId });
    return err('Failed to update profile', 500);
  }

  void logTeacherAudit({
    teacherAuthUserId: auth.userId!,
    action: 'profile.updated',
    resourceType: 'teacher',
    resourceId: teacherId,
    schoolId: teacherResult.data.schoolId ?? null,
    details: { fields: Object.keys(updatePayload) },
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({ success: true });
}
