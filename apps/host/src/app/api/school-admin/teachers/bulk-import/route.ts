/**
 * POST /api/school-admin/teachers/bulk-import — Track A.4
 *
 * Day-1 bulk teacher import for a school admin. Accepts an array of teacher rows
 * and, for each: validates → create-or-links the teacher (scoped to the caller's
 * school) → optionally assigns to classes (class_teachers).
 *
 * Body:
 *   { teachers: [{ name, email, subjects_taught?: string[], grades_taught?: string[],
 *                  employee_id?, class_refs?: string[] }, ...] }
 *
 * SEAT CEILING (P11-adjacent, RACE-SAFE): active teachers count toward the
 * school's ceiling (alongside enrolled students). Creating a NEW active teacher
 * consumes a seat. Each create goes through the ATOMIC RPC
 * `register_teacher_with_seat_check` (migration 20260621000500), which takes a
 * per-school advisory lock, recomputes the ceiling UNDER the lock (the same
 * assert_seat_capacity math), and creates-or-blocks in ONE transaction. This
 * replaces the previous probe-once + local-budget loop, which had a cross-request
 * TOCTOU race. Overflow rows are returned `blocked: seat_limit_reached` and NOT
 * created. Re-linking an EXISTING teacher (idempotent) consumes no new seat.
 *
 * IDEMPOTENCY: dedupe by (school_id, email). Re-running never duplicates a
 * teacher or a (class_id, teacher_id) assignment.
 *
 * Permission: institution.manage_teachers. Tenant isolation: school_id from
 * authorizeSchoolAdmin ONLY (never the body). P5: grades are strings. P13: logs
 * carry counts + indices + codes only — never name/email/phone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logSchoolAudit } from '@alfanumrik/lib/audit';
import {
  MAX_BULK_ROWS,
  validateTeacherRow,
  loadClassIndex,
  resolveClassId,
  atomicRegisterTeacher,
  probeSeatCapacity,
  type RowResult,
  type NormalizedTeacher,
} from '@alfanumrik/lib/school-admin/bulk-roster';

const BodySchema = z.object({
  teachers: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_BULK_ROWS),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_teachers');
  if (!auth.authorized) return auth.errorResponse!;
  const schoolId = auth.schoolId!;
  const supabase = getSupabaseAdmin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const tooMany = Array.isArray((body as { teachers?: unknown[] })?.teachers)
      && ((body as { teachers: unknown[] }).teachers.length > MAX_BULK_ROWS);
    return NextResponse.json(
      {
        success: false,
        error: tooMany
          ? `Maximum ${MAX_BULK_ROWS} teachers per request. Split the file.`
          : 'Body must be { teachers: [ ... ] } (1..500 rows).',
      },
      { status: tooMany ? 413 : 400 },
    );
  }
  const rawRows = parsed.data.teachers;

  // ── Validate every row first ───────────────────────────────────────────────
  const valid: Array<{ index: number; row: NormalizedTeacher }> = [];
  const results: RowResult[] = [];
  const seenEmails = new Set<string>();

  for (let i = 0; i < rawRows.length; i++) {
    const v = validateTeacherRow(rawRows[i]);
    if (!v.ok) {
      results.push({ index: i, status: 'failed', code: v.code });
      continue;
    }
    if (seenEmails.has(v.value.email)) {
      results.push({ index: i, status: 'skipped', code: 'duplicate_in_batch' });
      continue;
    }
    seenEmails.add(v.value.email);
    valid.push({ index: i, row: v.value });
  }

  const classIndex = await loadClassIndex(schoolId);

  // ── Seat ceiling: enforced ATOMICALLY per row (fix S1) ─────────────────────
  // register_teacher_with_seat_check takes a per-school advisory lock, recomputes
  // the ceiling under the lock, and creates-or-blocks in one transaction. No local
  // budget — concurrent same-school imports serialise and cannot over-commit.
  let created = 0;
  let skipped = 0;
  let blocked = 0;
  let failed = 0;

  for (const { index, row } of valid) {
    // Atomic create-or-reuse with the seat check held under the lock. A brand-new
    // active teacher consumes a seat; an existing (school,email) teacher is reused
    // (no new seat). The RPC returns the teacher_id either way.
    const reg = await atomicRegisterTeacher(
      schoolId,
      row.name,
      row.email,
      row.subjects_taught,
      row.grades_taught,
    );
    if (reg.ok === false) {
      results.push({ index, status: 'failed', code: 'create_failed' });
      failed++;
      continue;
    }
    if (reg.granted === false) {
      // Ceiling reached under the lock — nothing was created.
      results.push({ index, status: 'blocked', code: 'seat_limit_reached' });
      blocked++;
      continue;
    }
    const isCreated = reg.status === 'created';
    const teacherId = reg.teacherId;
    if (!teacherId) {
      results.push({ index, status: 'failed', code: 'create_failed' });
      failed++;
      continue;
    }

    // Assign to classes (idempotent on (class_id, teacher_id)). A missing class
    // ref is non-fatal: the teacher is still created; we record enroll_failed
    // only on a genuine DB error, not a soft "ref not found".
    let assignFailed = false;
    for (const ref of row.class_refs) {
      const classId = resolveClassId(ref, classIndex);
      if (!classId) continue; // unknown ref — skip silently (teacher still created)
      const { error: assignErr } = await supabase
        .from('class_teachers')
        .upsert(
          { class_id: classId, teacher_id: teacherId, role: 'teacher', is_active: true },
          { onConflict: 'class_id,teacher_id', ignoreDuplicates: true },
        );
      if (assignErr) assignFailed = true;
    }

    if (assignFailed) {
      results.push({ index, status: 'failed', code: 'enroll_failed', id: teacherId });
      failed++;
      continue;
    }

    results.push({
      index,
      status: isCreated ? 'created' : 'skipped',
      code: isCreated ? 'created' : 'already_exists',
      id: teacherId,
    });
    if (isCreated) created++;
    else skipped++;
  }

  // ── Phase 4 tenant claim — INTENTIONALLY DEFERRED for bulk-imported teachers ──
  // The staff link points (school-admin onboarding / staff-create / provisioning /
  // claim) wire `setSchoolClaim(authUserId, schoolId)` so a single-school staff
  // member's app_metadata.school_id is stamped and get_jwt_school_id() RLS can fire.
  // We do NOT wire it here, by design:
  //   1. `register_teacher_with_seat_check` creates a `teachers` roster row with NO
  //      auth_user_id — a bulk-imported teacher has no auth user (hence no JWT) yet,
  //      so there is nothing to carry a claim. Teachers gain their auth_user_id LATER
  //      when they self-onboard with the invite code (POST /api/schools/join UPDATEs
  //      teachers by auth_user_id). That join step is the correct future home for the
  //      teacher tenant claim (frontend/backend follow-up — see report).
  //   2. This route keeps ALL `teachers`-table I/O inside the atomic RPC (a direct
  //      teachers read/write here is a deliberate design regression). The RPC returns
  //      only teacher_id — never an auth_user_id — so there is no single-school auth
  //      user to resolve without violating that boundary.
  // The service-role read paths remain the safety net for teacher data regardless.
  // (Per the architect condition we also do NOT wire the STUDENT bulk-import route.)

  // Final read-only headroom snapshot for the response (non-authoritative; the
  // ceiling is enforced atomically per row above). Best-effort.
  const finalProbe = await probeSeatCapacity(schoolId);
  const seatsRemaining = finalProbe.ok ? finalProbe.snapshot.remaining : 0;

  logger.info('school_admin_teachers_bulk_import', {
    route: '/api/school-admin/teachers/bulk-import',
    total: rawRows.length,
    created,
    skipped,
    blocked,
    failed,
  });

  void logSchoolAudit({
    schoolId,
    actorId: auth.userId ?? 'unknown',
    action: 'teacher.invited',
    resourceType: 'teacher',
    resourceId: 'bulk',
    metadata: { source: 'bulk_import', total: rawRows.length, created, skipped, blocked, failed },
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({
    success: true,
    data: {
      total: rawRows.length,
      created,
      skipped,
      blocked,
      failed,
      seats_remaining: Math.max(seatsRemaining, 0),
      rows: results,
    },
  });
}
