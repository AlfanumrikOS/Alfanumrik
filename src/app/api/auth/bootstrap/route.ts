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
import { acquireIdempotencyLock, releaseIdempotencyLock } from '@/lib/redis';

// Dedup guard: prevent concurrent bootstrap calls for the same user.
// The bootstrap_user_profile RPC is idempotent (ON CONFLICT), but concurrent
// calls from SWR retries waste DB resources. This map tracks in-flight requests
// so duplicate calls await the existing promise instead of firing a new RPC.
const pendingBootstraps = new Map<string, Promise<NextResponse>>();

/**
 * Resolve the authenticated user from either:
 *   1. The cookie-based server client (works when SSR/middleware has hydrated
 *      the session into cookies), OR
 *   2. An `Authorization: Bearer <access_token>` header (works when the
 *      browser holds the session in localStorage — the default for
 *      `signInWithPassword` — and explicitly forwards the token).
 *
 * Cookies win when both are present (preserves existing behaviour). Returns
 * null if neither path produces a user. Never throws. The token itself is
 * never logged (P13).
 *
 * 2026-06-10 (audit finding M3): mirrors resolveAuthUser in
 * src/app/api/auth/session/route.ts. Password-login users have no sb-*
 * cookies, so the cookie-only path 401'd the P15 profile-creation failsafe
 * for the majority login path.
 */
async function resolveAuthUser(
  request: NextRequest,
): Promise<{ id: string; email?: string } | null> {
  // Path 1: cookie-based (preferred — cookies still win if both present).
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { id: user.id, email: user.email };
  } catch { /* fall through to Bearer */ }

  // Path 2: Authorization: Bearer <jwt>
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const admin = getSupabaseAdmin();
        const { data: { user } } = await admin.auth.getUser(token);
        if (user) return { id: user.id, email: user.email };
      } catch { /* token invalid/expired/network */ }
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate: cookie session first, Bearer-token fallback (M3)
    const user = await resolveAuthUser(request);

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    // Dedup: if a bootstrap is already in progress for this user, await it
    // Layer 1: In-memory dedup (same Vercel instance)
    const existingPromise = pendingBootstraps.get(user.id);
    if (existingPromise) {
      return existingPromise;
    }

    // Layer 2: Distributed Redis dedup (across Vercel instances)
    // 30s TTL — short enough that a failed bootstrap can be retried quickly,
    // long enough to cover the RPC round-trip time.
    const isFirstBootstrap = await acquireIdempotencyLock(`bootstrap:${user.id}`, 30);
    if (!isFirstBootstrap) {
      console.warn('[Bootstrap] duplicate bootstrap blocked by Redis:', user.id);
      return NextResponse.json({ success: true, data: { status: 'deduplicated', role: 'unknown', redirect: '/dashboard' } });
    }

    const bootstrapPromise = handleBootstrap(request, user);
    pendingBootstraps.set(user.id, bootstrapPromise);
    try {
      return await bootstrapPromise;
    } catch (err) {
      // Release Redis lock so a retry can proceed
      await releaseIdempotencyLock(`bootstrap:${user.id}`);
      throw err;
    } finally {
      pendingBootstraps.delete(user.id);
    }
  } catch (error) {
    console.error('[Bootstrap] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

async function handleBootstrap(
  request: NextRequest,
  user: { id: string; email?: string },
): Promise<NextResponse> {
  try {
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

    // 3b. AO-4 (P15 hardening): the bootstrap_user_profile RPC has a DUAL
    // error channel. Besides RAISING (surfaced above as rpcError), its
    // invalid-role ELSE branch and its `EXCEPTION WHEN OTHERS` branch RETURN a
    // logical-error payload `{ status: 'error', error: <message>, ... }`
    // WITHOUT raising — see 20260610090100_bootstrap_link_code.sql:224-225
    // (invalid role) and :233-234 (insert failure). Success/idempotent paths
    // return `{ status: 'success'|'already_completed', profile_id: <uuid>, ... }`
    // (:316-317 and :177-178), both carrying a non-null profile_id.
    //
    // The route previously branched ONLY on rpcError, so an in-body logical
    // failure returned HTTP 200 `success:true` with profile_id undefined —
    // silently defeating the P15 3-layer failsafe (the client's AuthContext
    // runtime fallback never got a chance to recover) and inflating the
    // `signup_complete` activation metric. Treat a `status:'error'` OR a
    // missing profile_id as a failure and hand control back to the client's
    // next failsafe layer with a non-200. We deliberately do NOT retry the RPC
    // in-route: it is idempotent, so an immediate re-call would just reproduce
    // the same logical failure; delegating to the client fallback (which can
    // re-resolve identity and rebuild the profile) is the established P15
    // recovery path. Happy paths are unchanged.
    const rpcStatus = typeof result?.status === 'string' ? result.status : undefined;
    const profileId = result?.profile_id;
    if (rpcStatus === 'error' || !profileId) {
      // Best-effort audit. P13: metadata only — role + the RPC's logical
      // status; never name/email/grade and never the raw SQLERRM string
      // (which can embed a conflicting column value).
      const failureCtx = extractAuditContext(request, admin, user.id);
      await logIdentityEvent(failureCtx, 'bootstrap_failure', {
        error: rpcStatus === 'error' ? 'rpc_logical_error' : 'missing_profile_id',
        role,
        rpc_status: rpcStatus ?? 'unknown',
      });

      console.error('[Bootstrap] RPC logical failure (no profile created):', {
        userId: user.id,
        role,
        rpcStatus: rpcStatus ?? 'unknown',
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Profile creation failed. Please try again.',
          code: 'BOOTSTRAP_FAILED',
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

    // 4b. Track B (Feature 1): minor parental-consent auto-invite.
    // If a student bootstrapped as a minor with a parent_consent_email captured
    // at signup, enqueue the guardian invite. FIRE-AND-FORGET (P15): this must
    // NEVER block or fail signup — enqueueGuardianInvite never throws and is not
    // awaited. We read is_minor / parent_consent_email from the auth-user
    // metadata that AuthScreen wrote at signup. P13: the parent email is passed
    // straight to the invite helper (which uses it only as the email `to`) and
    // is never logged here.
    if (role === 'student' && result?.profile_id) {
      try {
        const { data: authUser } = await admin.auth.admin.getUserById(user.id);
        const meta = (authUser?.user?.user_metadata ?? {}) as Record<string, unknown>;
        const isMinor = meta.is_minor === true || meta.is_minor === 'true';
        const consentEmail =
          typeof meta.parent_consent_email === 'string' ? meta.parent_consent_email.trim() : '';
        if (isMinor && consentEmail) {
          // Lazy import keeps the server-only email/admin deps out of the hot
          // bootstrap path for non-minor signups.
          const { enqueueGuardianInvite } = await import('@/lib/identity/guardian-invite');
          enqueueGuardianInvite(String(result.profile_id), consentEmail, 'en');
        }
      } catch (inviteErr) {
        // Swallow — P15: a minor-invite hiccup can never break signup.
        console.warn('[Bootstrap] minor guardian-invite enqueue skipped:', inviteErr);
      }
    }

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
