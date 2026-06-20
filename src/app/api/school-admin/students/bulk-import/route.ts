/**
 * POST /api/school-admin/students/bulk-import — Track A.4
 *
 * Day-1 bulk student import for a school admin. Accepts an array of student rows
 * and, for each: validates → create-or-links the student (scoped to the caller's
 * school) → enrolls into the named class (class_students).
 *
 * Body:
 *   { students: [{ name, email, grade, section?|class_ref?|class_code?,
 *                  roll_number?, parent_email?, parent_phone? }, ...] }
 *
 * SEAT CEILING (P11-adjacent, RACE-SAFE): enrolling a student into a class
 * consumes a billable seat. Each enrollment goes through the ATOMIC RPC
 * `enroll_student_with_seat_check` (migration 20260621000500), which takes a
 * per-school advisory lock, recomputes the ceiling UNDER the lock (the same
 * assert_seat_capacity math), and inserts-or-blocks in ONE transaction. This
 * replaces the previous probe-once + local-budget loop, which had a cross-request
 * TOCTOU race (two concurrent same-school imports could collectively exceed
 * seats_purchased). Rows that hit the ceiling are returned
 * `blocked: seat_limit_reached`; their student row is still created (a student NOT
 * on a class roster consumes no seat). If a class_ref is omitted, the student is
 * created but holds no roster row and therefore consumes no seat (documented).
 *
 * IDEMPOTENCY: dedupe by (school_id, email). Re-running never duplicates a
 * student or a (class_id, student_id) enrollment (UNIQUE key + ON CONFLICT).
 *
 * Permission: institution.manage_students. Tenant isolation: school_id from
 * authorizeSchoolAdmin ONLY (never the body). P5: grades are strings. P13: logs
 * carry counts + indices + codes only — never name/email/phone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logSchoolAudit } from '@/lib/audit';
import { randomBytes } from 'crypto';
import {
  MAX_BULK_ROWS,
  validateStudentRow,
  loadClassIndex,
  resolveClassId,
  atomicEnrollStudent,
  probeSeatCapacity,
  type RowResult,
  type NormalizedStudent,
} from '@/lib/school-admin/bulk-roster';

const BodySchema = z.object({
  students: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_BULK_ROWS),
});

type Supabase = ReturnType<typeof getSupabaseAdmin>;

/**
 * Create-or-link a student scoped to `schoolId`. Idempotent by (school_id,
 * email): an existing student with this email in this school is REUSED (its id
 * returned, status 'already_exists'); a brand-new auth user + students row is
 * created otherwise (the handle_new_user trigger inserts the row; we patch
 * school_id). NEVER logs PII.
 */
async function resolveOrCreateStudent(
  supabase: Supabase,
  schoolId: string,
  row: NormalizedStudent,
): Promise<
  | { kind: 'created'; studentId: string }
  | { kind: 'exists'; studentId: string }
  | { kind: 'failed' }
> {
  // Idempotency: a student with this email already in THIS school → reuse.
  const { data: existing } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('email', row.email)
    .maybeSingle();

  if (existing) {
    const ex = existing as { id: string; school_id: string | null };
    // Cross-tenant guard: if the email belongs to another school's student, do
    // NOT touch it. Attach to THIS school only when it is unclaimed.
    if (ex.school_id && ex.school_id !== schoolId) {
      return { kind: 'failed' };
    }
    if (!ex.school_id) {
      await supabase.from('students').update({ school_id: schoolId }).eq('id', ex.id);
    }
    return { kind: 'exists', studentId: ex.id };
  }

  // Credential material MUST use a CSPRNG, never Math.random() (fix N2). This
  // temp password is immediately overwritten by the student's own reset, but
  // crypto-grade randomness is required for any secret. 24 hex chars (96 bits) of
  // entropy, shaped to satisfy upper/lower/digit/symbol complexity rules.
  const tempPassword = `Alf${randomBytes(12).toString('hex')}!9`;
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: row.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { name: row.name, role: 'student', grade: row.grade },
  });
  if (authError || !authUser?.user?.id) {
    return { kind: 'failed' };
  }

  const updates: Record<string, unknown> = { school_id: schoolId };
  const { data: studentRow, error: updateError } = await supabase
    .from('students')
    .update(updates)
    .eq('auth_user_id', authUser.user.id)
    .select('id')
    .single();

  if (updateError || !studentRow) {
    return { kind: 'failed' };
  }
  return { kind: 'created', studentId: studentRow.id as string };
}

export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
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
    const tooMany = Array.isArray((body as { students?: unknown[] })?.students)
      && ((body as { students: unknown[] }).students.length > MAX_BULK_ROWS);
    return NextResponse.json(
      {
        success: false,
        error: tooMany
          ? `Maximum ${MAX_BULK_ROWS} students per request. Split the file.`
          : 'Body must be { students: [ ... ] } (1..500 rows).',
      },
      { status: tooMany ? 413 : 400 },
    );
  }
  const rawRows = parsed.data.students;

  // ── Validate every row first; build the work list ─────────────────────────
  const valid: Array<{ index: number; row: NormalizedStudent }> = [];
  const results: RowResult[] = [];
  const seenEmails = new Set<string>();

  for (let i = 0; i < rawRows.length; i++) {
    const v = validateStudentRow(rawRows[i]);
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

  // ── Resolve class refs (tenant-scoped index) ──────────────────────────────
  const classIndex = await loadClassIndex(schoolId);

  // ── Seat ceiling: enforced ATOMICALLY per row (fix S1) ─────────────────────
  // Each enrollment goes through enroll_student_with_seat_check, which takes a
  // per-school advisory lock, recomputes the ceiling under the lock, and
  // inserts-or-blocks in one transaction. No local budget — concurrent same-school
  // imports serialise on the lock and cannot collectively over-commit seats.
  let created = 0;
  let skipped = 0;
  let blocked = 0;
  let failed = 0;

  for (const { index, row } of valid) {
    // Create-or-link the student first (does NOT consume a seat by itself).
    const student = await resolveOrCreateStudent(supabase, schoolId, row);
    if (student.kind === 'failed') {
      results.push({ index, status: 'failed', code: 'create_failed' });
      failed++;
      continue;
    }
    const studentId = student.studentId;

    // No class ref → student created but unenrolled (no seat consumed).
    if (!row.class_ref) {
      results.push({
        index,
        status: student.kind === 'created' ? 'created' : 'skipped',
        code: student.kind === 'created' ? 'created' : 'already_exists',
        id: studentId,
      });
      if (student.kind === 'created') created++;
      else skipped++;
      continue;
    }

    const classId = resolveClassId(row.class_ref, classIndex);
    if (!classId) {
      // Student exists but we can't place them — report missing class clearly.
      results.push({ index, status: 'failed', code: 'class_not_found', id: studentId });
      failed++;
      continue;
    }

    // Seat ceiling enforced ATOMICALLY (lock + recompute + insert in one txn).
    const enroll = await atomicEnrollStudent(schoolId, studentId, classId, row.roll_number);
    if (enroll.ok === false) {
      // RPC infra error → treat as an enroll failure for this row (no over-commit).
      results.push({ index, status: 'failed', code: 'enroll_failed', id: studentId });
      failed++;
      continue;
    }
    if (enroll.granted === false) {
      // Ceiling reached under the lock — nothing was written.
      results.push({ index, status: 'blocked', code: 'seat_limit_reached', id: studentId });
      blocked++;
      continue;
    }

    results.push({
      index,
      status: student.kind === 'created' ? 'created' : 'skipped',
      code: student.kind === 'created' ? 'created' : 'already_exists',
      id: studentId,
    });
    if (student.kind === 'created') created++;
    else skipped++;
  }

  // Final read-only headroom snapshot for the response (non-authoritative; the
  // ceiling is enforced atomically per row above). Best-effort: null if the probe
  // can't run — never blocks the response.
  const finalProbe = await probeSeatCapacity(schoolId);
  const seatsRemaining = finalProbe.ok ? finalProbe.snapshot.remaining : 0;

  // P13: counts + indices only — never the submitted PII.
  logger.info('school_admin_students_bulk_import', {
    route: '/api/school-admin/students/bulk-import',
    total: rawRows.length,
    created,
    skipped,
    blocked,
    failed,
  });

  void logSchoolAudit({
    schoolId,
    actorId: auth.userId ?? 'unknown',
    action: 'student.invited',
    resourceType: 'student',
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
