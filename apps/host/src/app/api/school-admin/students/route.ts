import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { logger } from '@alfanumrik/lib/logger';
import { capture as posthogCapture } from '@alfanumrik/lib/posthog/server';
import { logSchoolAudit } from '@alfanumrik/lib/audit';
import { createSchoolAdminStudentAuthUser } from '@alfanumrik/lib/school-admin/student-auth-admin';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
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

interface SchoolAdminStudentsListRpcResponse {
  success: boolean;
  error?: string;
  status?: number;
  data?: unknown[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface SchoolAdminToggleStudentRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  code?: string;
  seats_used?: number;
  seats_purchased?: number;
  was_active?: boolean;
  data?: {
    id: string;
    name: string | null;
    email: string | null;
    grade: string | null;
    is_active: boolean;
  };
}

interface SchoolAdminAttachCreatedStudentRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: {
    studentId: string;
  };
}

interface SchoolAdminStudentCreatePreflightRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: {
    emailExists: boolean;
    seatsUsed: number;
    seatsPurchased: number | null;
    seatCapViolation: boolean;
  };
}

type RlsScopedClient = Awaited<ReturnType<typeof createRlsScopedClient>>;

async function createRlsScopedClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // RLS-scoped roster reads only; this route does not mutate auth cookies.
      },
    },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}

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

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const grade = url.searchParams.get('grade') ?? '';
    const search = url.searchParams.get('search')?.trim() ?? '';

    // Validate grade filter if provided (P5: grades are strings "6"-"12")
    if (grade && !VALID_GRADES.includes(grade)) {
      return NextResponse.json(
        { success: false, error: `Invalid grade filter: "${grade}". Must be "6" through "12"` },
        { status: 400 }
      );
    }

    const rlsClient = await createRlsScopedClient(request);
    const { data, error } = await rlsClient.rpc('school_admin_list_students', {
      p_school_id: schoolId,
      p_page: page,
      p_limit: limit,
      p_grade: grade || null,
      p_search: search || null,
    });

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

    const payload = data as SchoolAdminStudentsListRpcResponse | null;
    if (!payload?.success) {
      return NextResponse.json(
        { success: false, error: payload?.error ?? 'Failed to fetch students' },
        { status: payload?.status ?? 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: payload.data ?? [],
      pagination: payload.pagination ?? {
        page,
        limit,
        total: 0,
        totalPages: 0,
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

    const rlsClient = await createRlsScopedClient(request);
    const { data: toggleData, error: updateError } = await rlsClient.rpc(
      'school_admin_toggle_student_active',
      {
        p_school_id: schoolId,
        p_student_id: body.id,
        p_is_active: body.is_active,
      },
    );

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

    const toggleResult = toggleData as SchoolAdminToggleStudentRpcResponse | null;
    if (!toggleResult?.success) {
      if (toggleResult?.code === 'seat_cap_violation') {
        await posthogCapture('school_seat_cap_hit', auth.userId!, {
          school_id: schoolId,
          source: 'student_add',
          seats_purchased: toggleResult.seats_purchased ?? 0,
          seats_used: toggleResult.seats_used ?? 0,
        });
        return NextResponse.json(
          {
            success: false,
            code: 'seat_cap_violation',
            error:
              toggleResult.error ??
              `Cannot activate this student. Your school has used ${toggleResult.seats_used ?? 0} of ${toggleResult.seats_purchased ?? 0} seats. Upgrade your subscription to add more.`,
            seats_used: toggleResult.seats_used ?? 0,
            seats_purchased: toggleResult.seats_purchased ?? 0,
          },
          { status: toggleResult.status ?? 422 },
        );
      }
      return NextResponse.json(
        { success: false, error: toggleResult?.error ?? 'Failed to update student' },
        { status: toggleResult?.status ?? 500 },
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

    return NextResponse.json({ success: true, data: toggleResult.data });
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
  rlsClient: RlsScopedClient,
  schoolId: string,
  row: NormalizedRow,
  classId: string | null = null,
): Promise<{ ok: true; studentId: string } | { ok: false; message: string }> {
  const tempPassword = `Alf${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 100)}`;

  const authUser = await createSchoolAdminStudentAuthUser({
    email: row.email,
    password: tempPassword,
    name: row.name,
    grade: row.grade,
  });

  if (!authUser.ok) {
    return { ok: false, message: authUser.message };
  }

  const { data: attachData, error: attachError } = await rlsClient.rpc('school_admin_attach_created_student', {
    p_school_id: schoolId,
    p_student_auth_user_id: authUser.authUserId,
    p_phone: row.phone ?? null,
    p_class_id: classId,
  });

  if (attachError) {
    return { ok: false, message: attachError.message };
  }

  const attachResult = attachData as SchoolAdminAttachCreatedStudentRpcResponse | null;
  if (!attachResult?.success || !attachResult.data?.studentId) {
    return { ok: false, message: attachResult?.error ?? 'Failed to attach student to school' };
  }

  return { ok: true, studentId: attachResult.data.studentId };
}

/**
 * Parse a CSV body into NormalizedRow input objects. Caller still runs
 * validateRow() per entry. Returns parsed dict rows in upload order.
 */
function parseCsv(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      record.push(cleanCsvCell(field));
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      record.push(cleanCsvCell(field));
      if (record.some((cell) => cell.trim().length > 0)) records.push(record);
      record = [];
      field = '';
      continue;
    }

    field += ch;
  }

  record.push(cleanCsvCell(field));
  if (record.some((cell) => cell.trim().length > 0)) records.push(record);

  if (records.length < 2) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    rows.push(obj);
  }
  return { headers, rows };
}

function cleanCsvCell(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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

    const url = new URL(request.url);
    const bulkParam = url.searchParams.get('bulk') === 'true';
    const contentType = request.headers.get('content-type') ?? '';

    // ── Branch 1: multipart CSV upload ──────────────────────────
    if (contentType.includes('multipart/form-data')) {
      return handleBulkCsv(request, schoolId, auth.userId!);
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
      return handleBulkJson(body, schoolId, auth.userId!, request);
    }

    // ── Branch 3: single-student create ────────────────────────
    return handleSingle(body, schoolId, auth.userId!, request);
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

async function runCreatePreflight(
  rlsClient: RlsScopedClient,
  schoolId: string,
  email: string,
  attemptedCount = 1,
  classId: string | null = null,
): Promise<
  | {
      ok: true;
      emailExists: boolean;
      seatsUsed: number;
      seatsPurchased: number | null;
      seatCapViolation: boolean;
    }
  | { ok: false; message: string; status: number }
> {
  const { data, error } = await rlsClient.rpc('school_admin_student_create_preflight', {
    p_school_id: schoolId,
    p_email: email,
    p_attempted_count: attemptedCount,
    p_class_id: classId,
  });

  if (error) {
    logger.error('school_admin_student_create_preflight_failed', {
      error: new Error(error.message),
      route: '/api/school-admin/students',
    });
    return { ok: false, message: 'Student preflight check failed. Please retry.', status: 503 };
  }

  const payload = data as SchoolAdminStudentCreatePreflightRpcResponse | null;
  if (!payload?.success) {
    return {
      ok: false,
      message: payload?.error ?? 'Student preflight check failed. Please retry.',
      status: payload?.status ?? 500,
    };
  }

  return {
    ok: true,
    emailExists: !!payload.data?.emailExists,
    seatsUsed: payload.data?.seatsUsed ?? 0,
    seatsPurchased: payload.data?.seatsPurchased ?? null,
    seatCapViolation: !!payload.data?.seatCapViolation,
  };
}

async function handleSingle(
  body: unknown,
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

  // ── Seat-policy gate (Phase 3B Wave B) ─────────────────────────────
  // When ff_school_provisioning is ON, the canonical roster-based hybrid
  // policy is the authoritative gate and replaces the legacy seats_purchased
  // soft-check below. The roster-based RPC only consumes a seat when the
  // student is placed on a class roster, so enforcement is meaningful only
  // when class_id is provided; a student created with no class_id holds no
  // roster row and consumes no seat (documented). Flag OFF → the legacy
  // pre-check runs unchanged (byte-identical to today).
  const seatEnforced = await isSeatEnforcementEnabled();
  const rlsClient = await createRlsScopedClient(request);
  const preflight = await runCreatePreflight(
    rlsClient,
    schoolId,
    validation.row.email,
    1,
    input.class_id ?? null,
  );
  if (!preflight.ok) {
    return NextResponse.json(
      { success: false, error: preflight.message },
      { status: preflight.status },
    );
  }
  if (preflight.emailExists) {
    return NextResponse.json(
      { success: false, error: 'Student with this email already exists' },
      { status: 400 },
    );
  }

  if (!seatEnforced) {
    // ── Legacy seat-cap pre-check (unchanged OFF path) ────────────
    if (preflight.seatCapViolation) {
      await posthogCapture('school_seat_cap_hit', actorId, {
        school_id: schoolId,
        // Reuse the existing 'student_add' source — same as PATCH activation
        // (typed in src/lib/posthog/types.ts: SchoolSeatCapHitPayload).
        source: 'student_add',
        seats_purchased: preflight.seatsPurchased ?? 0,
        seats_used: preflight.seatsUsed,
      });
      return NextResponse.json(
        {
          success: false,
          code: 'seat_cap_violation',
          error: `Cannot add student. School has used ${preflight.seatsUsed} of ${preflight.seatsPurchased} seats. Upgrade the subscription to add more.`,
          seats_used: preflight.seatsUsed,
          seats_purchased: preflight.seatsPurchased,
        },
        { status: 409 },
      );
    }

    const result = await createOneStudent(rlsClient, schoolId, validation.row, input.class_id ?? null);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.message },
        { status: 400 },
      );
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
            preflight.seatsPurchased === null
              ? null
              : preflight.seatsPurchased - (preflight.seatsUsed + 1),
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
  const result = await createOneStudent(rlsClient, schoolId, validation.row);
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
    schoolId,
    actorId,
    request,
  );
}

async function handleBulkCsv(
  request: NextRequest,
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

  return processBulkRows(rows, schoolId, actorId, request);
}

async function processBulkRows(
  rows: Record<string, unknown>[],
  schoolId: string,
  actorId: string,
  request: NextRequest,
): Promise<NextResponse> {
  const seatEnforced = await isSeatEnforcementEnabled();

  // ── Legacy whole-batch seat-cap pre-check (unchanged OFF path) ────────
  // Flag OFF → behaves byte-identically to today: reject the WHOLE batch if it
  // would exceed seats_purchased (no partial accept).
  if (!seatEnforced) {
    const rlsClient = await createRlsScopedClient(request);
    const bulkPreflight = await runCreatePreflight(rlsClient, schoolId, '', rows.length);
    if (!bulkPreflight.ok) {
      return NextResponse.json(
        { success: false, error: bulkPreflight.message },
        { status: bulkPreflight.status },
      );
    }
    if (bulkPreflight.seatCapViolation) {
      await posthogCapture('school_seat_cap_hit', actorId, {
        school_id: schoolId,
        // Reuse 'bulk_upload' — same source the super-admin bulk-upload route
        // uses (typed in src/lib/posthog/types.ts).
        source: 'bulk_upload',
        seats_purchased: bulkPreflight.seatsPurchased ?? 0,
        seats_used: bulkPreflight.seatsUsed,
        attempted_to_add: rows.length,
      });
      return NextResponse.json(
        {
          success: false,
          code: 'seat_cap_violation',
          error: `Cannot add ${rows.length} students. School has used ${bulkPreflight.seatsUsed} of ${bulkPreflight.seatsPurchased} seats. Upgrade the subscription before uploading.`,
          seats_used: bulkPreflight.seatsUsed,
          seats_purchased: bulkPreflight.seatsPurchased,
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

      const rowPreflight = await runCreatePreflight(rlsClient, schoolId, validation.row.email, 1);
      if (!rowPreflight.ok) {
        errors.push({ row: rowNum, message: rowPreflight.message });
        continue;
      }
      if (rowPreflight.emailExists) {
        errors.push({ row: rowNum, message: 'Student with this email already exists' });
        continue;
      }

      const result = await createOneStudent(rlsClient, schoolId, validation.row);
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
  const rlsClient = await createRlsScopedClient(request);

  for (let idx = 0; idx < validated.length; idx++) {
    const { rowNum, row } = validated[idx];
    if (!row.ok) continue; // type guard (already filtered)

    if (idx >= acceptCount) {
      // Overflow beyond remaining capacity → reject with a clear reason.
      errors.push({ row: rowNum, message: 'seat_limit_reached' });
      continue;
    }

    const rowPreflight = await runCreatePreflight(rlsClient, schoolId, row.row.email, 1);
    if (!rowPreflight.ok) {
      errors.push({ row: rowNum, message: rowPreflight.message });
      continue;
    }
    if (rowPreflight.emailExists) {
      errors.push({ row: rowNum, message: 'Student with this email already exists' });
      continue;
    }

    const result = await createOneStudent(rlsClient, schoolId, row.row);
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
