import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  isSeatEnforcementEnabled,
  previewSeatPolicy,
  flagGraceWarn,
  enrollSectionWithSeatCheck,
  seatCapViolationResponse,
  type EnrollPair,
} from '@/lib/school-admin/seat-enforcement';

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EnrollRow {
  name: string;
  email: string;
  grade: string;
  section?: string;
  parent_email?: string;
}

interface RowError {
  row: number;
  field: string;
  message: string;
}

/**
 * POST /api/schools/enroll — Bulk enroll students into a school
 * Permission: institution.manage_students
 *
 * Body: {
 *   school_id: string,
 *   students: [{ name, email, grade, section?, parent_email? }]
 * }
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'institution.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json();
    const { school_id, students } = body;

    if (!school_id || typeof school_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'school_id is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(students) || students.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one student is required' },
        { status: 400 }
      );
    }

    if (students.length > 200) {
      return NextResponse.json(
        { success: false, error: 'Maximum 200 students per batch' },
        { status: 400 }
      );
    }

    // Verify the user is admin of this school
    const { data: adminRecord } = await supabaseAdmin
      .from('school_admins')
      .select('school_id')
      .eq('auth_user_id', auth.userId)
      .eq('school_id', school_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!adminRecord) {
      return NextResponse.json(
        { success: false, error: 'Not authorized for this school' },
        { status: 403 }
      );
    }

    const seatEnforced = await isSeatEnforcementEnabled();

    // ── Legacy whole-batch seat check (unchanged OFF path) ──────────────
    // Flag OFF → byte-identical to today: reject the WHOLE batch if it exceeds
    // seats_purchased (counts every student row, status='active' subscription).
    if (!seatEnforced) {
      const { data: subscription } = await supabaseAdmin
        .from('school_subscriptions')
        .select('seats_purchased')
        .eq('school_id', school_id)
        .eq('status', 'active')
        .maybeSingle();

      if (subscription) {
        const { count: currentStudents } = await supabaseAdmin
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', school_id);

        const seatsRemaining = subscription.seats_purchased - (currentStudents ?? 0);
        if (students.length > seatsRemaining) {
          return NextResponse.json(
            {
              success: false,
              error: `Only ${seatsRemaining} seats remaining (${subscription.seats_purchased} purchased, ${currentStudents ?? 0} enrolled). Cannot add ${students.length} students.`,
            },
            { status: 403 }
          );
        }
      }
    }

    // Validate rows. `validRows` preserves the original 1-based row number so
    // the seat-overflow rejection (ON path) can report a per-row reason.
    const errors: RowError[] = [];
    const validRows: Array<EnrollRow & { rowNum: number }> = [];

    students.forEach((row: Record<string, string>, idx: number) => {
      const rowNum = idx + 1;
      const name = row.name?.trim();
      const email = row.email?.trim();
      const grade = String(row.grade ?? '').trim();
      const section = row.section?.trim() || undefined;
      const parentEmail = row.parent_email?.trim() || undefined;

      if (!name || name.length < 2) {
        errors.push({ row: rowNum, field: 'name', message: 'Name must be at least 2 characters' });
      }
      if (!email || !EMAIL_REGEX.test(email)) {
        errors.push({ row: rowNum, field: 'email', message: 'Invalid email format' });
      }
      if (!VALID_GRADES.includes(grade)) {
        errors.push({ row: rowNum, field: 'grade', message: `Grade must be one of ${VALID_GRADES.join(', ')}` });
      }
      if (parentEmail && !EMAIL_REGEX.test(parentEmail)) {
        errors.push({ row: rowNum, field: 'parent_email', message: 'Invalid parent email format' });
      }

      if (name && name.length >= 2 && email && EMAIL_REGEX.test(email) && VALID_GRADES.includes(grade)) {
        validRows.push({ rowNum, name, email, grade, section, parent_email: parentEmail });
      }
    });

    if (validRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No valid rows to import',
          errors,
        },
        { status: 400 }
      );
    }

    // ── ENFORCED capacity gate (ff_school_provisioning ON) ──────────────
    // "All-or-validated-rows that fit, per-row error report for the rest."
    // SINGLE policy preview (no N+1): compute remaining capacity within the
    // grace ceiling, accept up to that many valid rows, reject the overflow
    // with `seat_limit_reached` — so we NEVER create student rows for rows that
    // will be rejected for capacity (no orphans). Trim validRows in place so the
    // create loop below only commits the capacity-sized batch. The authoritative
    // seat re-check + grace determination happens later in the ATOMIC RPC commit
    // (which re-evaluates under the per-school lock against the live count); this
    // preview is the cheap upfront fit so we don't create soon-to-be-rejected
    // students. `graceVerdictToFlag` is set from the COMMIT verdict, not here.
    let graceVerdictToFlag: Awaited<ReturnType<typeof previewSeatPolicy>> | null = null;
    if (seatEnforced) {
      const preview = await previewSeatPolicy(school_id, validRows.length);
      if (!preview.ok) {
        return NextResponse.json(
          { success: false, error: 'Seat check temporarily unavailable. Please retry.' },
          { status: 503 }
        );
      }
      const { grace_ceiling, current_active } = preview.verdict;
      const remaining = Math.max(grace_ceiling - current_active, 0);
      const overflow = validRows.splice(remaining); // remove rows beyond capacity
      for (const o of overflow) {
        errors.push({ row: o.rowNum, field: 'seat', message: 'seat_limit_reached' });
      }
    }

    // Create student records
    // Note: This creates pre-registration records. Students still need to sign up.
    // The school_id is set so when they sign up with this email, they'll be linked.
    let successCount = 0;
    const importErrors: RowError[] = [...errors];

    // ON path only: accumulate the resolved (student_id, class_id) roster pairs
    // for the accepted, section-placed students. The actual roster write is NOT
    // done inline (as the OFF path does) — it is committed in ONE atomic,
    // seat-checked RPC after the create loop, so the live seat re-check and the
    // class_enrollments insert share one transaction + one advisory lock.
    const sectionPairs: EnrollPair[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];

      // Check if student already exists in this school
      const { data: existing } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('email', row.email)
        .eq('school_id', school_id)
        .maybeSingle();

      if (existing) {
        // Preserve the original (legacy) row-number semantics so the OFF path
        // response stays byte-identical. The ON path reports overflow rows via
        // the dedicated `seat_limit_reached` entries (which carry row.rowNum).
        importErrors.push({
          row: i + 1,
          field: 'email',
          message: `Student with email already exists in this school`,
        });
        continue;
      }

      // Create a pre-registration record
      // This creates a student record without an auth_user_id
      // When the student signs up with this email, the auth flow will link them
      const { error: insertErr } = await supabaseAdmin
        .from('students')
        .insert({
          name: row.name,
          email: row.email,
          grade: row.grade,
          school_id,
          board: 'CBSE',
          is_active: true,
        });

      if (insertErr) {
        importErrors.push({
          row: i + 1,
          field: 'email',
          message: insertErr.message,
        });
        continue;
      }

      successCount++;

      // If section specified, enroll in matching class
      if (row.section) {
        const { data: matchingClass } = await supabaseAdmin
          .from('classes')
          .select('id')
          .eq('school_id', school_id)
          .eq('grade', row.grade)
          .eq('section', row.section)
          .maybeSingle();

        if (matchingClass) {
          const { data: newStudent } = await supabaseAdmin
            .from('students')
            .select('id')
            .eq('email', row.email)
            .eq('school_id', school_id)
            .single();

          if (newStudent) {
            if (seatEnforced) {
              // ON path: defer the roster write to the atomic seat-checked RPC.
              sectionPairs.push({
                class_id: matchingClass.id as string,
                student_id: newStudent.id as string,
              });
            } else {
              await supabaseAdmin
                .from('class_enrollments')
                .upsert(
                  {
                    class_id: matchingClass.id,
                    student_id: newStudent.id,
                    enrolled_at: new Date().toISOString(),
                    is_active: true,
                  },
                  { onConflict: 'class_id,student_id' }
                );
            }
          }
        }
      }
    }

    // ── ATOMIC roster commit + grace flag (ON path only) ────────────────
    // Commit the accepted, section-placed students onto class_enrollments via
    // the race-safe RPC: it re-takes the per-school advisory lock, re-evaluates
    // the unified hybrid policy against the LIVE count, and UPSERTs all pairs in
    // one transaction (all-or-nothing). The preview gate above already trimmed
    // the batch to remaining capacity, so this commit normally succeeds; the RPC
    // is the authoritative race check for the window between preview and commit.
    if (seatEnforced && sectionPairs.length > 0) {
      const commit = await enrollSectionWithSeatCheck(school_id, sectionPairs);

      if (commit.kind === 'blocked') {
        // Race: the count moved between preview and commit (e.g. a concurrent
        // import for the same school landed first). The RPC inserted NOTHING
        // (P3B01 rolls its txn back), so there is no partial/corrupt roster
        // state — surface a retryable 409 seat_cap_violation. The student rows
        // already created consume no seat without a roster row, so the admin can
        // retry placement (or upgrade / deactivate) cleanly.
        return seatCapViolationResponse(commit.verdict, commit.status);
      }
      if (commit.kind === 'error') {
        // RPC failure (not a policy block) → 503 so the caller retries; never
        // leak SQL (already logged server-side by the helper).
        return NextResponse.json(
          { success: false, error: 'Seat check temporarily unavailable. Please retry.' },
          { status: 503 }
        );
      }

      // Soft-allow: flag school admin + super-admin on grace_warn (P7 bilingual,
      // P13 no PII), and surface grace_expires_at in the response below.
      if (commit.verdict.status === 'grace_warn') {
        await flagGraceWarn(school_id, commit.verdict);
        graceVerdictToFlag = { ok: true, verdict: commit.verdict };
      }
    } else if (seatEnforced && successCount > 0) {
      // Accepted students were created but none were section-placed (no roster
      // row ⇒ no seat consumed under the canonical roster count), so there is no
      // atomic RPC to run. Still refresh the snapshot/grace clock in case the
      // school is already in the grace band, and flag grace_warn if so.
      const post = await previewSeatPolicy(school_id, 0);
      if (post.ok && post.verdict.status === 'grace_warn') {
        await flagGraceWarn(school_id, post.verdict);
        graceVerdictToFlag = post;
      }
    }

    logAudit(auth.userId, {
      action: 'bulk_enroll',
      resourceType: 'students',
      resourceId: school_id,
    });

    // Preserve the legacy response shape; add the explicit accepted/rejected
    // per-row report when enforcement is ON.
    const responseData: Record<string, unknown> = {
      total: students.length,
      success_count: successCount,
      error_count: importErrors.length,
      errors: importErrors,
    };
    if (seatEnforced) {
      responseData.accepted = validRows.map((r) => r.rowNum);
      responseData.rejected = importErrors
        .filter((e) => e.field === 'seat')
        .map((e) => ({ row: e.row, reason: e.message }));
      // Soft-allow surface: when the accepted batch entered the 14-day grace
      // band, return the grace details so the UI can warn the admin to upgrade.
      if (graceVerdictToFlag?.ok && graceVerdictToFlag.verdict.status === 'grace_warn') {
        responseData.warning = {
          status: 'grace_warn',
          grace_expires_at: graceVerdictToFlag.verdict.grace_expires_at,
          grace_ceiling: graceVerdictToFlag.verdict.grace_ceiling,
        };
      }
    }

    return NextResponse.json({ success: true, data: responseData });
  } catch (err) {
    logger.error('school_enroll_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/schools/enroll',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
