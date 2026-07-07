import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { capture as posthogCapture } from '@alfanumrik/lib/posthog/server';
import { logSchoolAudit } from '@alfanumrik/lib/audit';
import {
  isSeatEnforcementEnabled,
  enrollWithSeatCheck,
  refreshSeatUsage,
  seatCapViolationResponse,
  flagGraceWarn,
  previewSeatPolicy,
  type SeatVerdict,
} from '@alfanumrik/lib/school-admin/seat-enforcement';

// ── Constants (mirror super-admin/bulk-upload) ──────────────────
const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_BULK_ROWS = 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/school-admin/students?page=1&limit=20&grade=8&search=name
 *
 * Paginated, filterable list of students for the admin's school.
 * Permission: institution.manage_students
 *
 * Query params:
 *   page    — page number (default 1)
 *   limit   — items per page (default 20, max 100)
 *   grade   — filter by grade string "6"-"12" (P5)
 *   search  — case-insensitive name search
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const offset = (page - 1) * limit;
    const grade = url.searchParams.get('grade') ?? '';
    const search = url.searchParams.get('search')?.trim() ?? '';

    // Validate grade filter if provided (P5: grades are strings "6"-"12")
    const validGrades = ['6', '7', '8', '9', '10', '11', '12'];
    if (grade && !validGrades.includes(grade)) {
      return NextResponse.json(
        { success: false, error: `Invalid grade filter: "${grade}". Must be "6" through "12"` },
        { status: 400 }
      );
    }

    // Build query — always scoped to schoolId
    let query = supabase
      .from('students')
      .select(
        'id, name, email, grade, is_active, xp_total, last_active, subscription_plan, created_at',
        { count: 'exact' }
      )
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });

    // Apply optional filters
    if (grade) {
      query = query.eq('grade', grade);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('school_admin_students_list_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/students',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch students' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (err) {
    logger.error('school_admin_students_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/students',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/school-admin/students
 *
 * Toggle a student's is_active status.
 * School admins can only toggle active/inactive — they cannot edit student profiles.
 * Permission: institution.manage_students
 *
 * Body: { id: string, is_active: boolean }
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const body = await request.json();

    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Student id is required' },
        { status: 400 }
      );
    }

    if (typeof body.is_active !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'is_active must be a boolean' },
        { status: 400 }
      );
    }

    // Verify student belongs to this school (tenant isolation)
    const { data: existingStudent } = await supabase
      .from('students')
      .select('id, is_active')
      .eq('id', body.id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (!existingStudent) {
      return NextResponse.json(
        { success: false, error: 'Student not found' },
        { status: 404 }
      );
    }

    // ── Seat-cap enforcement (Phase 3-B) ───────────────────────────────
    // Activating a previously-inactive student consumes a seat. Refuse if
    // the school is at or above its purchased cap. Reactivation of an
    // already-active student is a no-op for seat counting; deactivation
    // never hits the cap. Trial schools have school_subscriptions.seats_purchased
    // defaulted to 50 (per the table CHECK), so the gate applies uniformly.
    const isActivating = body.is_active === true && existingStudent.is_active !== true;
    if (isActivating) {
      const [{ count: activeCount }, { data: sub }] = await Promise.all([
        supabase
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', schoolId)
          .eq('is_active', true),
        supabase
          .from('school_subscriptions')
          .select('seats_purchased')
          .eq('school_id', schoolId)
          .maybeSingle(),
      ]);
      const seatsUsed = activeCount ?? 0;
      const seatsPurchased = (sub?.seats_purchased as number | undefined) ?? null;
      if (seatsPurchased !== null && seatsUsed + 1 > seatsPurchased) {
        await posthogCapture('school_seat_cap_hit', auth.userId!, {
          school_id: schoolId,
          source: 'student_add',
          seats_purchased: seatsPurchased,
          seats_used: seatsUsed,
        });
        return NextResponse.json(
          {
            success: false,
            code: 'seat_cap_violation',
            error: `Cannot activate this student. Your school has used ${seatsUsed} of ${seatsPurchased} seats. Upgrade your subscription to add more.`,
            seats_used: seatsUsed,
            seats_purchased: seatsPurchased,
          },
          { status: 422 },
        );
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('students')
      .update({ is_active: body.is_active })
      .eq('id', body.id)
      .eq('school_id', schoolId) // double-check tenant isolation
      .select('id, name, email, grade, is_active')
      .single();

    if (updateError) {
      logger.error('school_admin_student_toggle_failed', {
        error: new Error(updateError.message),
        route: '/api/school-admin/students',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update student' },
        { status: 500 }
      );
    }

    // ── Seat-usage refresh after a deactivation (Phase 3B Wave B) ──────
    // Deactivating a student frees a seat + may reset the grace clock. When
    // ff_school_provisioning is ON, refresh the canonical snapshot + grace
    // state immediately so the freed seat is reflected for the next add.
    // Flag OFF → this is skipped entirely (byte-identical to today).
    if (body.is_active === false && (await isSeatEnforcementEnabled())) {
      await refreshSeatUsage(schoolId);
    }

    // is_active=false uses the existing 'student.deactivated' action so the
    // audit log keeps a consistent vocabulary with /students/[id] DELETE.
    void logSchoolAudit({
      schoolId,
      actorId: auth.userId ?? 'unknown',
      action: body.is_active === false ? 'student.deactivated' : 'student.updated',
      resourceType: 'student',
      resourceId: body.id,
      metadata: { is_active: !!body.is_active },
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    logger.error('school_admin_students_patch_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/students',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Read the school's current active-student count + purchased seats.
 * `seats_purchased = null` means "no subscription row → uncapped".
 */
async function readSeatStatus(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
): Promise<{ seatsUsed: number; seatsPurchased: number | null }> {
  const [{ count: activeCount }, { data: sub }] = await Promise.all([
    supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('is_active', true),
    supabase
      .from('school_subscriptions')
      .select('seats_purchased')
      .eq('school_id', schoolId)
      .maybeSingle(),
  ]);
  return {
    seatsUsed: activeCount ?? 0,
    seatsPurchased: (sub?.seats_purchased as number | undefined) ?? null,
  };
}

interface NormalizedRow {
  name: string;
  email: string;
  grade: string;
  phone?: string;
}

interface RowError {
  row: number;
  message: string;
}

/**
 * Validate a single row's name/email/grade. Returns either a normalized
 * record or the validation error message. Pure — no I/O.
 */
function validateRow(
  row: { name?: string; email?: string; grade?: string; phone?: string },
): { ok: true; row: NormalizedRow } | { ok: false; message: string } {
  if (!row.name || typeof row.name !== 'string' || row.name.trim().length < 2) {
    return { ok: false, message: 'Name is required (min 2 chars)' };
  }
  if (!row.email || typeof row.email !== 'string' || !EMAIL_REGEX.test(row.email.trim())) {
    return { ok: false, message: 'Valid email is required' };
  }
  if (!row.grade || !VALID_GRADES.includes(String(row.grade))) {
    return { ok: false, message: `Invalid grade "${row.grade}". Must be 6-12` };
  }
  return {
    ok: true,
    row: {
      name: row.name.trim(),
      email: row.email.trim().toLowerCase(),
      grade: String(row.grade),
      phone: row.phone?.toString().trim() || undefined,
    },
  };
}

/**
 * Create one student via auth.admin.createUser. The handle_new_user trigger
 * inserts the students row; we then patch school_id (and optionally phone)
 * so the student is scoped to this admin's school.
 *
 * Returns the new student row's id on success, or an error message string.
 */
async function createOneStudent(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  row: NormalizedRow,
): Promise<{ ok: true; studentId: string } | { ok: false; message: string }> {
  // Check email is not already in use (matches super-admin bulk-upload).
  const { data: existing } = await supabase
    .from('students')
    .select('id')
    .eq('email', row.email)
    .maybeSingle();

  if (existing) {
    return { ok: false, message: 'Student with this email already exists' };
  }

  const tempPassword = `Alf${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 100)}`;

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: row.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { name: row.name, role: 'student', grade: row.grade },
  });

  if (authError || !authUser?.user?.id) {
    return { ok: false, message: authError?.message ?? 'Failed to create auth user' };
  }

  // TODO(B.5): extract this students-row mutation to a `learner.created`
  // projector once that event kind is added to EVENT_CATALOG v2. Today
  // there is no `learner.created` (or equivalent) event kind in the
  // registry, so we write directly per ADR-005 §"escape hatch when no
  // event kind exists". The students row itself is created by the
  // handle_new_user trigger; we only patch school_id (+ optional phone).
  const updates: Record<string, unknown> = { school_id: schoolId };
  if (row.phone) updates.phone = row.phone;

  const { data: studentRow, error: updateError } = await supabase
    .from('students')
    .update(updates)
    .eq('auth_user_id', authUser.user.id)
    .select('id')
    .single();

  if (updateError || !studentRow) {
    return { ok: false, message: updateError?.message ?? 'Failed to attach student to school' };
  }

  return { ok: true, studentId: studentRow.id as string };
}

/**
 * Parse a CSV body into NormalizedRow input objects. Caller still runs
 * validateRow() per entry. Returns parsed dict rows in upload order.
 */
function parseCsv(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    rows.push(obj);
  }
  return { headers, rows };
}

// ─── POST ───────────────────────────────────────────────────────

/**
 * POST /api/school-admin/students
 *
 * Two modes (chosen at request time):
 *
 *   1) **Single student** — Content-Type: application/json. Body:
 *      `{ name, email, grade, phone?, class_id? }`. Returns 201 with
 *      `{ student_id, remaining_seats }`.
 *
 *   2) **Bulk** — either `?bulk=true` with a JSON body
 *      `{ rows: [{name, email, grade, phone?}, ...] }`, or
 *      Content-Type: multipart/form-data with a `file` CSV attachment
 *      (≤5MB, ≤1000 rows). Returns 200 with
 *      `{ created, errors: [{row, message}] }`.
 *
 * Authorization: institution.manage_students. The school_id is taken
 * from the caller's school_admins record — NEVER from the request body.
 * If `class_id` is provided, it must belong to the caller's school.
 *
 * Phase B.1 of the multi-school prod-readiness plan. Mirrors the
 * super-admin/bulk-upload pattern but scopes every write to one tenant.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const url = new URL(request.url);
    const bulkParam = url.searchParams.get('bulk') === 'true';
    const contentType = request.headers.get('content-type') ?? '';

    // ── Branch 1: multipart CSV upload ──────────────────────────
    if (contentType.includes('multipart/form-data')) {
      return handleBulkCsv(request, supabase, schoolId, auth.userId!);
    }

    // ── Read JSON body once ────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    // ── Branch 2: JSON bulk ────────────────────────────────────
    if (bulkParam || (typeof body === 'object' && body !== null && 'rows' in body)) {
      return handleBulkJson(body, supabase, schoolId, auth.userId!, request);
    }

    // ── Branch 3: single-student create ────────────────────────
    return handleSingle(body, supabase, schoolId, auth.userId!, request);
  } catch (err) {
    logger.error('school_admin_students_post_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/students',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function handleSingle(
  body: unknown,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  actorId: string,
  request: NextRequest,
): Promise<NextResponse> {
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { success: false, error: 'Body must be a JSON object' },
      { status: 400 },
    );
  }
  const input = body as {
    name?: string;
    email?: string;
    grade?: string;
    phone?: string;
    class_id?: string;
    parent_emails?: string[];
  };

  const validation = validateRow(input);
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.message },
      { status: 400 },
    );
  }

  // ── Cross-tenant class_id rejection ────────────────────────
  if (input.class_id) {
    const { data: cls } = await supabase
      .from('classes')
      .select('id, school_id')
      .eq('id', input.class_id)
      .maybeSingle();
    if (!cls || cls.school_id !== schoolId) {
      return NextResponse.json(
        { success: false, error: 'class_id does not belong to your school' },
        { status: 403 },
      );
    }
  }

  // ── Seat-policy gate (Phase 3B Wave B) ─────────────────────────────
  // When ff_school_provisioning is ON, the canonical roster-based hybrid
  // policy is the authoritative gate and replaces the legacy seats_purchased
  // soft-check below. The roster-based RPC only consumes a seat when the
  // student is placed on a class roster, so enforcement is meaningful only
  // when class_id is provided; a student created with no class_id holds no
  // roster row and consumes no seat (documented). Flag OFF → the legacy
  // pre-check runs unchanged (byte-identical to today).
  const seatEnforced = await isSeatEnforcementEnabled();

  if (!seatEnforced) {
    // ── Legacy seat-cap pre-check (unchanged OFF path) ────────────
    const { seatsUsed, seatsPurchased } = await readSeatStatus(supabase, schoolId);
    if (seatsPurchased !== null && seatsUsed + 1 > seatsPurchased) {
      await posthogCapture('school_seat_cap_hit', actorId, {
        school_id: schoolId,
        // Reuse the existing 'student_add' source — same as PATCH activation
        // (typed in src/lib/posthog/types.ts: SchoolSeatCapHitPayload).
        source: 'student_add',
        seats_purchased: seatsPurchased,
        seats_used: seatsUsed,
      });
      return NextResponse.json(
        {
          success: false,
          code: 'seat_cap_violation',
          error: `Cannot add student. School has used ${seatsUsed} of ${seatsPurchased} seats. Upgrade the subscription to add more.`,
          seats_used: seatsUsed,
          seats_purchased: seatsPurchased,
        },
        { status: 409 },
      );
    }

    const result = await createOneStudent(supabase, schoolId, validation.row);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.message },
        { status: 400 },
      );
    }

    // Attach to class if provided (and it passed the cross-tenant gate above).
    if (input.class_id) {
      await supabase.from('class_students').insert({
        class_id: input.class_id,
        student_id: result.studentId,
      });
    }

    void logSchoolAudit({
      schoolId,
      actorId,
      action: 'student.invited',
      resourceType: 'student',
      resourceId: result.studentId,
      metadata: { source: 'school_admin_post_single' },
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          student_id: result.studentId,
          remaining_seats:
            seatsPurchased === null ? null : seatsPurchased - (seatsUsed + 1),
        },
      },
      { status: 201 },
    );
  }

  // ── ENFORCED path (ff_school_provisioning ON) ──────────────────────
  // Create the auth user + students row first (these do not consume a seat
  // under the canonical roster definition), then — if a class_id is given —
  // place the student on the roster through the ATOMIC seat-checked RPC. If
  // the seat policy hard-blocks the roster placement, the student row still
  // exists (it consumes no seat without a roster row) and the admin gets a
  // clear 409 to act on (upgrade / deactivate / pick a class later).
  const result = await createOneStudent(supabase, schoolId, validation.row);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.message },
      { status: 400 },
    );
  }

  let enrolledVerdict: SeatVerdict | null = null;
  if (input.class_id) {
    const enroll = await enrollWithSeatCheck(schoolId, [
      { student_id: result.studentId, class_id: input.class_id },
    ]);

    if (enroll.kind === 'blocked') {
      await posthogCapture('school_seat_cap_hit', actorId, {
        school_id: schoolId,
        source: 'student_add',
        seats_purchased: enroll.verdict?.seats_purchased ?? 0,
        seats_used: enroll.verdict?.current_active ?? 0,
      });
      return seatCapViolationResponse(enroll.verdict, enroll.status);
    }
    if (enroll.kind === 'error') {
      // RPC failure (not a policy block) → 503 so the caller can retry; never
      // leak SQL (already logged server-side by the helper).
      return NextResponse.json(
        { success: false, error: 'Seat check temporarily unavailable. Please retry.' },
        { status: 503 },
      );
    }

    enrolledVerdict = enroll.verdict;
    // Soft-allow: flag school admin + super-admin on grace_warn.
    if (enroll.verdict.status === 'grace_warn') {
      await flagGraceWarn(schoolId, enroll.verdict);
    }
  }

  void logSchoolAudit({
    schoolId,
    actorId,
    action: 'student.invited',
    resourceType: 'student',
    resourceId: result.studentId,
    metadata: { source: 'school_admin_post_single', seat_enforced: true },
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  });

  const responseBody: Record<string, unknown> = {
    success: true,
    data: {
      student_id: result.studentId,
      remaining_seats:
        enrolledVerdict === null
          ? null
          : Math.max(enrolledVerdict.grace_ceiling - enrolledVerdict.current_active, 0),
    },
  };
  if (enrolledVerdict?.status === 'grace_warn') {
    responseBody.warning = {
      status: 'grace_warn',
      grace_expires_at: enrolledVerdict.grace_expires_at,
      grace_ceiling: enrolledVerdict.grace_ceiling,
    };
  }

  return NextResponse.json(responseBody, { status: 201 });
}

async function handleBulkJson(
  body: unknown,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  actorId: string,
  request: NextRequest,
): Promise<NextResponse> {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('rows' in body) ||
    !Array.isArray((body as { rows: unknown }).rows)
  ) {
    return NextResponse.json(
      { success: false, error: 'Bulk body must be { rows: [...] }' },
      { status: 400 },
    );
  }
  const rows = (body as { rows: unknown[] }).rows;
  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: 'rows must be non-empty' },
      { status: 400 },
    );
  }
  if (rows.length > MAX_BULK_ROWS) {
    return NextResponse.json(
      { success: false, error: `Maximum ${MAX_BULK_ROWS} students per upload` },
      { status: 413 },
    );
  }

  return processBulkRows(
    rows as Record<string, unknown>[],
    supabase,
    schoolId,
    actorId,
    request,
  );
}

async function handleBulkCsv(
  request: NextRequest,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  actorId: string,
): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file || !file.name.endsWith('.csv')) {
    return NextResponse.json(
      { success: false, error: 'Please upload a CSV file' },
      { status: 400 },
    );
  }
  if (file.size > MAX_CSV_SIZE_BYTES) {
    return NextResponse.json(
      { success: false, error: 'CSV file exceeds 5MB limit. Split into smaller batches.' },
      { status: 413 },
    );
  }
  const text = await file.text();
  const { headers, rows } = parseCsv(text);
  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: 'CSV must have a header row and at least one data row' },
      { status: 400 },
    );
  }
  if (rows.length > MAX_BULK_ROWS) {
    return NextResponse.json(
      { success: false, error: `Maximum ${MAX_BULK_ROWS} students per upload` },
      { status: 413 },
    );
  }
  const missing = ['name', 'email', 'grade'].filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return NextResponse.json(
      { success: false, error: `Missing required columns: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  return processBulkRows(rows, supabase, schoolId, actorId, request);
}

async function processBulkRows(
  rows: Record<string, unknown>[],
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  actorId: string,
  request: NextRequest,
): Promise<NextResponse> {
  const seatEnforced = await isSeatEnforcementEnabled();

  // ── Legacy whole-batch seat-cap pre-check (unchanged OFF path) ────────
  // Flag OFF → behaves byte-identically to today: reject the WHOLE batch if it
  // would exceed seats_purchased (no partial accept).
  if (!seatEnforced) {
    const { seatsUsed, seatsPurchased } = await readSeatStatus(supabase, schoolId);
    if (seatsPurchased !== null && seatsUsed + rows.length > seatsPurchased) {
      await posthogCapture('school_seat_cap_hit', actorId, {
        school_id: schoolId,
        // Reuse 'bulk_upload' — same source the super-admin bulk-upload route
        // uses (typed in src/lib/posthog/types.ts).
        source: 'bulk_upload',
        seats_purchased: seatsPurchased,
        seats_used: seatsUsed,
        attempted_to_add: rows.length,
      });
      return NextResponse.json(
        {
          success: false,
          code: 'seat_cap_violation',
          error: `Cannot add ${rows.length} students. School has used ${seatsUsed} of ${seatsPurchased} seats. Upgrade the subscription before uploading.`,
          seats_used: seatsUsed,
          seats_purchased: seatsPurchased,
          attempted_to_add: rows.length,
        },
        { status: 409 },
      );
    }

    const errors: RowError[] = [];
    const seenEmails = new Set<string>();
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // CSV-style: row 1 is header, data starts at row 2
      const raw = rows[i];
      const validation = validateRow({
        name: typeof raw.name === 'string' ? raw.name : undefined,
        email: typeof raw.email === 'string' ? raw.email : undefined,
        grade: raw.grade != null ? String(raw.grade) : undefined,
        phone: typeof raw.phone === 'string' ? raw.phone : undefined,
      });
      if (!validation.ok) {
        errors.push({ row: rowNum, message: validation.message });
        continue;
      }
      if (seenEmails.has(validation.row.email)) {
        errors.push({ row: rowNum, message: 'Duplicate email in this upload' });
        continue;
      }
      seenEmails.add(validation.row.email);

      const result = await createOneStudent(supabase, schoolId, validation.row);
      if (!result.ok) {
        errors.push({ row: rowNum, message: result.message });
        continue;
      }
      created++;
    }

    void logSchoolAudit({
      schoolId,
      actorId,
      action: 'student.invited',
      resourceType: 'student',
      resourceId: 'bulk',
      metadata: {
        source: 'school_admin_post_bulk',
        total_rows: rows.length,
        created,
        error_count: errors.length,
      },
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        created,
        total_rows: rows.length,
        errors: errors.slice(0, 50), // cap response payload
        error_count: errors.length,
      },
    });
  }

  // ── ENFORCED bulk path (ff_school_provisioning ON) ────────────────────
  // "Accept the rows that fit, reject the overflow with a per-row reason."
  //  1. Validate every row first (validation errors are reported per-row and
  //     do NOT count against capacity).
  //  2. Preview remaining capacity via a SINGLE policy read (no N+1).
  //  3. Accept up to capacity, reject overflow rows with `seat_limit_reached`.
  //  4. Create the accepted students (this bulk route does not place students
  //     on class rosters, so no seat is consumed at create time — the preview
  //     is the authoritative cap here; roster placement + the atomic RPC gate
  //     happen on the enroll surface that supplies class_id).
  const validated: Array<{ rowNum: number; row: ReturnType<typeof validateRow> }> = [];
  const errors: RowError[] = [];
  const seenEmails = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // CSV row 1 = header
    const raw = rows[i];
    const validation = validateRow({
      name: typeof raw.name === 'string' ? raw.name : undefined,
      email: typeof raw.email === 'string' ? raw.email : undefined,
      grade: raw.grade != null ? String(raw.grade) : undefined,
      phone: typeof raw.phone === 'string' ? raw.phone : undefined,
    });
    if (!validation.ok) {
      errors.push({ row: rowNum, message: validation.message });
      continue;
    }
    if (seenEmails.has(validation.row.email)) {
      errors.push({ row: rowNum, message: 'Duplicate email in this upload' });
      continue;
    }
    seenEmails.add(validation.row.email);
    validated.push({ rowNum, row: validation });
  }

  const validCount = validated.length;

  // SINGLE preview read for the whole batch (no per-row RPC).
  const preview = await previewSeatPolicy(schoolId, validCount);
  if (!preview.ok) {
    return NextResponse.json(
      { success: false, error: 'Seat check temporarily unavailable. Please retry.' },
      { status: 503 },
    );
  }

  const { grace_ceiling, current_active } = preview.verdict;
  const remaining = Math.max(grace_ceiling - current_active, 0);
  const acceptCount = Math.min(validCount, remaining);

  // Whether the accepted batch tips the school into the grace band.
  const willEnterGrace =
    current_active + acceptCount > preview.verdict.seats_purchased;

  const acceptedRowNums: number[] = [];
  let created = 0;

  for (let idx = 0; idx < validated.length; idx++) {
    const { rowNum, row } = validated[idx];
    if (!row.ok) continue; // type guard (already filtered)

    if (idx >= acceptCount) {
      // Overflow beyond remaining capacity → reject with a clear reason.
      errors.push({ row: rowNum, message: 'seat_limit_reached' });
      continue;
    }

    const result = await createOneStudent(supabase, schoolId, row.row);
    if (!result.ok) {
      errors.push({ row: rowNum, message: result.message });
      continue;
    }
    created++;
    acceptedRowNums.push(rowNum);
  }

  const overflowRejected = validCount - acceptCount;
  if (overflowRejected > 0) {
    await posthogCapture('school_seat_cap_hit', actorId, {
      school_id: schoolId,
      source: 'bulk_upload',
      seats_purchased: preview.verdict.seats_purchased,
      seats_used: current_active,
      attempted_to_add: validCount,
    });
  }

  // Soft-allow grace flag if the accepted rows pushed into the grace band.
  if (willEnterGrace && created > 0) {
    // Re-read so grace_started_at/expires reflect the just-created state.
    const post = await previewSeatPolicy(schoolId, 0);
    if (post.ok && post.verdict.status === 'grace_warn') {
      await flagGraceWarn(schoolId, post.verdict);
    } else if (preview.verdict.status === 'grace_warn') {
      await flagGraceWarn(schoolId, preview.verdict);
    }
  }

  void logSchoolAudit({
    schoolId,
    actorId,
    action: 'student.invited',
    resourceType: 'student',
    resourceId: 'bulk',
    metadata: {
      source: 'school_admin_post_bulk',
      seat_enforced: true,
      total_rows: rows.length,
      created,
      error_count: errors.length,
    },
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({
    success: true,
    data: {
      created,
      total_rows: rows.length,
      accepted: acceptedRowNums,
      rejected: errors.slice(0, 100), // per-row { row, reason } report (cap payload)
      errors: errors.slice(0, 50), // legacy field retained for back-compat
      error_count: errors.length,
    },
  });
}
