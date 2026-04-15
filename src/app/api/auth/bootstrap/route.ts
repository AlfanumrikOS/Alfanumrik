/**
 * POST /api/auth/bootstrap
 *
 * Server-controlled user onboarding bootstrap.
 * Called after signup to create profile, assign role, and track onboarding state.
 *
 * WARNING: Do not modify this route without updating auth/onboarding tests.
 * Changes here can break signup for all users.
 *
 * Request body:
 * {
 *   role: 'student' | 'teacher' | 'parent',
 *   name: string,
 *   grade?: string,           // for students (string "6"-"12", per P5)
 *   board?: string,           // for students
 *   school_name?: string,     // for teachers
 *   subjects_taught?: string[], // for teachers
 *   grades_taught?: string[],   // for teachers
 *   phone?: string,           // for parents
 *   link_code?: string,       // for parents
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { sanitizeText } from '@/lib/sanitize';
import { logIdentityEvent, extractAuditContext } from '@/lib/identity/audit';
import {
  VALID_BOARDS,
  isValidRole,
  isValidGrade,
  isValidBoard,
  normalizeGrade,
  getRoleDestination,
  type ValidRole,
} from '@/lib/identity';

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate: get the current user from the session
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    // 2. Parse and validate request body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', code: 'INVALID_BODY' },
        { status: 400 }
      );
    }

    const role = body.role as string;
    const name =
      typeof body.name === 'string' ? sanitizeText(body.name.trim()) : '';

    if (!role || !isValidRole(role)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid role. Must be student, teacher, or parent.',
          code: 'INVALID_ROLE',
        },
        { status: 400 }
      );
    }

    if (!name || name.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: 'Name is required (minimum 2 characters)',
          code: 'INVALID_NAME',
        },
        { status: 400 }
      );
    }

    // Role-specific validation
    if (role === 'student') {
      // P5: Grades must be strings "6"-"12". Validate raw input, then normalizeGrade coerces numbers to strings.
      // Coerce number to string for validation (matching normalizeGrade logic), but reject truly invalid values.
      const rawGrade = typeof body.grade === 'number' ? String(body.grade) : body.grade;
      if (rawGrade !== undefined && !isValidGrade(rawGrade)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid grade. Must be 6-12.',
            code: 'INVALID_GRADE',
          },
          { status: 400 }
        );
      }

      const board = typeof body.board === 'string' ? body.board : 'CBSE';
      if (!isValidBoard(board)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid board. Must be one of: ${VALID_BOARDS.join(', ')}`,
            code: 'INVALID_BOARD',
          },
          { status: 400 }
        );
      }
    }

    if (role === 'teacher') {
      const gradesTought = body.grades_taught;
      if (Array.isArray(gradesTought)) {
        const allValid = gradesTought.every(
          (g) => isValidGrade(g)
        );
        if (!allValid) {
          return NextResponse.json(
            {
              success: false,
              error: 'grades_taught must contain valid grades (6-12 as strings)',
              code: 'INVALID_GRADES_TAUGHT',
            },
            { status: 400 }
          );
        }
      }

      // Subject governance: validate subjects_taught against active master list.
      // The teacher record doesn't exist yet, so we cannot use validateSubjectsBulk
      // (which requires a student_id). Instead, query the subjects master table
      // directly and verify every requested code is present and active.
      const subjectsTaught = body.subjects_taught;
      if (Array.isArray(subjectsTaught) && subjectsTaught.length > 0) {
        if (!subjectsTaught.every((s) => typeof s === 'string' && s.trim().length > 0)) {
          return NextResponse.json(
            {
              success: false,
              error: 'subjects_taught must contain only non-empty strings',
              code: 'INVALID_SUBJECTS_TAUGHT',
            },
            { status: 400 }
          );
        }
        const bootstrapAdmin = getSupabaseAdmin();
        const { data: activeSubjects, error: subjectsErr } = await bootstrapAdmin
          .from('subjects')
          .select('code')
          .eq('is_active', true);
        if (subjectsErr) {
          return NextResponse.json(
            {
              success: false,
              error: 'Failed to load subject master list',
              code: 'SUBJECTS_LOOKUP_FAILED',
            },
            { status: 500 }
          );
        }
        const allowedCodes = new Set((activeSubjects ?? []).map((r: { code: string }) => r.code));
        for (const s of subjectsTaught as string[]) {
          if (!allowedCodes.has(s)) {
            return NextResponse.json(
              {
                error: 'subject_not_allowed',
                subject: s,
                reason: 'inactive',
                allowed: Array.from(allowedCodes),
              },
              { status: 422 }
            );
          }
        }
      }
    }

    // Student: if client supplies selected_subjects, reject unknown codes using
    // the active subjects master table (student record does not exist yet so
    // we cannot call get_available_subjects). Governance by grade/plan is
    // re-applied post-bootstrap via /api/student/preferences.
    if (role === 'student') {
      const selectedSubjects = body.selected_subjects;
      if (Array.isArray(selectedSubjects) && selectedSubjects.length > 0) {
        if (!selectedSubjects.every((s) => typeof s === 'string' && s.trim().length > 0)) {
          return NextResponse.json(
            {
              success: false,
              error: 'selected_subjects must contain only non-empty strings',
              code: 'INVALID_SELECTED_SUBJECTS',
            },
            { status: 400 }
          );
        }
        const bootstrapAdmin = getSupabaseAdmin();
        const { data: activeSubjects, error: subjectsErr } = await bootstrapAdmin
          .from('subjects')
          .select('code')
          .eq('is_active', true);
        if (subjectsErr) {
          return NextResponse.json(
            {
              success: false,
              error: 'Failed to load subject master list',
              code: 'SUBJECTS_LOOKUP_FAILED',
            },
            { status: 500 }
          );
        }
        const allowedCodes = new Set((activeSubjects ?? []).map((r: { code: string }) => r.code));
        for (const s of selectedSubjects as string[]) {
          if (!allowedCodes.has(s)) {
            return NextResponse.json(
              {
                error: 'subject_not_allowed',
                subject: s,
                reason: 'inactive',
                allowed: Array.from(allowedCodes),
              },
              { status: 422 }
            );
          }
        }
      }
    }

    // 3. Call the bootstrap RPC via admin client (bypasses RLS for profile creation reliability)
    const admin = getSupabaseAdmin();

    const { data: result, error: rpcError } = await admin.rpc(
      'bootstrap_user_profile',
      {
        p_auth_user_id: user.id,
        p_role: role,
        p_name: name,
        p_email: user.email || '',
        p_grade: role === 'student' ? normalizeGrade(body.grade) : null,
        p_board: role === 'student' ? String(body.board || 'CBSE') : null,
        p_school_name:
          role === 'teacher' ? ((body.school_name as string) || '') : null,
        p_subjects_taught:
          role === 'teacher'
            ? ((body.subjects_taught as string[]) || [])
            : null,
        p_grades_taught:
          role === 'teacher'
            ? ((body.grades_taught as string[]) || [])
            : null,
        p_phone: role === 'parent' ? ((body.phone as string) || null) : null,
        p_link_code:
          role === 'parent' ? ((body.link_code as string) || null) : null,
      }
    );

    if (rpcError) {
      // Log the failure (best-effort)
      const auditCtx = extractAuditContext(request, admin, user.id);
      await logIdentityEvent(auditCtx, 'bootstrap_failure', { error: rpcError.message, role, name });

      console.error('[Bootstrap] RPC failed:', rpcError.message, {
        userId: user.id,
        role,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Profile creation failed. Please try again.',
          code: 'BOOTSTRAP_FAILED',
          details: rpcError.message,
        },
        { status: 500 }
      );
    }

    // 4. Log success (best-effort)
    const auditCtx = extractAuditContext(request, admin, user.id);
    await logIdentityEvent(
      auditCtx,
      result?.status === 'already_completed' ? 'bootstrap_idempotent' : 'bootstrap_success',
      { role, profile_id: result?.profile_id }
    );

    // 5. Determine redirect destination based on role
    const destination = getRoleDestination(role);

    return NextResponse.json({
      success: true,
      data: {
        status: result?.status || 'success',
        profile_id: result?.profile_id,
        role,
        redirect: destination,
      },
    });
  } catch (error) {
    console.error('[Bootstrap] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
