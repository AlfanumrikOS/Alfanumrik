/**
 * ⚠️ CRITICAL AUTH PATH
 * This file is part of the core authentication system.
 * Changes here WILL break login/signup/verify for ALL users.
 *
 * Before modifying:
 * 1. Run: npm run test -- --grep "auth"
 * 2. Run: node scripts/auth-guard.js
 *
 * SERVER-ONLY: imports the service-role supabase client + the server-only
 * school-admin helper. Never import this from client components. (Intentionally
 * NOT re-exported from the identity barrel.)
 */
/**
 * Shared signup-completion logic for the two email-verification routes.
 *
 * Phase 3b (B4): apps/host/src/app/auth/callback/route.ts (PKCE `code` flow) and
 * apps/host/src/app/auth/confirm/route.ts (token_hash + legacy token flows) each
 * carried a near-identical copy of the signup-bootstrap block —
 *   profile-existence probe → institution_admin vs bootstrap_user_profile branch
 *   → post-bootstrap role re-detection → welcome email
 * — plus a byte-identical registerSessionOnResponse. That was THREE copies of the
 * bootstrap block (callback ×1, confirm ×2) that had already drifted (only
 * callback re-detected the role from the DB and sent the welcome email). This
 * module is the single source of truth for both.
 *
 * P15 / REG-117 CONTRACT (unchanged): these helpers NEVER throw into the auth
 * flow. completeSignupBootstrap() wraps all work in try/catch and always returns
 * a role string; registerSessionOnResponse() is fail-open. The CALLING route is
 * responsible for always returning a 3xx redirect (never a 500) and for the
 * open-redirect guards / redirect destinations.
 *
 * P13: no PII is logged — only auth_user_id-free error messages.
 */

import type { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { profileParamsFromMetadata } from '@alfanumrik/lib/identity/bootstrap-profile';
import { ensureSchoolAdminOnboarding } from '@alfanumrik/lib/identity/school-admin-bootstrap';

// ── Session registration (2-device limit) ────────────────────────
const SESSION_COOKIE = 'alfanumrik_sid';
const MAX_SESSIONS = 2;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/** Minimal shape of the authenticated user both routes hand to us. */
export interface SignupUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

/**
 * Register a device session on the redirect response.
 * Fail-open: errors are logged but never block the auth flow. Extracted verbatim
 * from the two identical copies in /auth/callback + /auth/confirm.
 */
export async function registerSessionOnResponse(
  response: NextResponse,
  userId: string,
  request: NextRequest
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const deviceLabel = (request.headers.get('user-agent') || 'unknown').slice(0, 200);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    // Enforce MAX_SESSIONS — revoke oldest if at limit
    const { data: active } = await admin
      .from('user_active_sessions')
      .select('id, created_at, device_label')
      .eq('auth_user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (active && active.length >= MAX_SESSIONS) {
      const toRevoke = active.slice(0, active.length - MAX_SESSIONS + 1);
      for (const s of toRevoke) {
        await admin
          .from('user_active_sessions')
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq('id', s.id);
      }
    }

    const { data: newSession } = await admin
      .from('user_active_sessions')
      .insert({
        auth_user_id: userId,
        session_token_hash: 'sid-based', // Legacy NOT NULL column
        device_label: deviceLabel,
        ip_address: ip,
        user_agent: deviceLabel,
      })
      .select('id')
      .single();

    if (newSession) {
      response.cookies.set(SESSION_COOKIE, newSession.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_MAX_AGE,
      });
    }
  } catch (err) {
    console.error(
      '[Auth Session] Session registration failed:',
      err instanceof Error ? err.message : err
    );
    // Non-blocking: don't break the auth flow
  }
}

/**
 * Fire-and-forget welcome email. Best-effort (P15): a missing session/URL or a
 * failed fetch never blocks the flow. The fetch itself is NOT awaited — only the
 * session lookup is — matching the original /auth/callback behavior verbatim.
 */
async function sendSignupWelcomeEmail(
  supabase: SupabaseClient,
  user: SignupUser,
  name: string,
  email: string,
  role: string
): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (token && supabaseUrl) {
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const payload: Record<string, string> = { name, email, role };
      if (typeof meta.grade === 'string' && meta.grade.length > 0) payload.grade = meta.grade;
      if (typeof meta.board === 'string' && meta.board.length > 0) payload.board = meta.board;
      fetch(`${supabaseUrl}/functions/v1/send-welcome-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify(payload),
      }).catch((err: unknown) => {
        console.warn(
          '[Complete Signup] welcome email failed:',
          err instanceof Error ? err.message : String(err)
        );
      }); // Best-effort
    }
  } catch {
    // Welcome-email errors are non-fatal (P15).
  }
}

/**
 * Complete a confirmed signup: create the profile if missing (institution_admin
 * via ensureSchoolAdminOnboarding, else the bootstrap_user_profile RPC), resolve
 * the redirect role, and fire the best-effort welcome email.
 *
 * Returns the resolved role string; the caller maps it via getRoleDestination().
 * NEVER throws (P15) — on any error it returns the best role resolved so far
 * (defaulting to 'student'), and the caller always redirects.
 *
 * The `supabase` arg is the request-scoped server client (used for the profile
 * probes + the welcome-email session lookup); profile creation uses the
 * service-role admin client internally, matching the prior route behavior.
 */
export async function completeSignupBootstrap(
  supabase: SupabaseClient,
  user: SignupUser
): Promise<string> {
  let redirectRole = 'student';
  try {
    // R2 (2026-06-10): single canonical metadata→params derivation (shared by
    // both routes). Fixes teacher subjects_taught/grades_taught previously
    // dropped on the token_hash path and the per-site grade default drift.
    const params = profileParamsFromMetadata(user);
    const email = params.email;
    const name = params.name;
    redirectRole = params.role;

    // Check if a profile already exists (bootstrap may have run during signup).
    const { data: existingStudent } = await supabase
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();
    const { data: existingTeacher } = await supabase
      .from('teachers')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();
    const { data: existingGuardian } = await supabase
      .from('guardians')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();
    const { data: existingSchoolAdmin } = await supabase
      .from('school_admins')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    const hasProfile = !!(
      existingStudent ||
      existingTeacher ||
      existingGuardian ||
      existingSchoolAdmin
    );

    if (!hasProfile) {
      if (redirectRole === 'institution_admin') {
        // Unified school-admin onboarding: schools + school_admins(role=
        // 'principal') + onboarding_state, with city/state/principal_name
        // persisted. Fully fail-soft (P15).
        await ensureSchoolAdminOnboarding({
          authUserId: user.id,
          name,
          email,
          schoolName: params.school_name,
          city: params.school_city,
          state: params.school_state,
          board: params.board,
          principalName: params.principal_name,
          phone: params.phone,
        });
      } else {
        // No profile exists — run server bootstrap via the admin client.
        try {
          const admin = getSupabaseAdmin();
          await admin.rpc('bootstrap_user_profile', {
            p_auth_user_id: user.id,
            p_role: redirectRole,
            p_name: name,
            p_email: email,
            p_grade: params.grade,
            p_board: params.board,
            p_school_name: params.school_name,
            p_subjects_taught: params.subjects,
            p_grades_taught: params.grades_taught,
            p_phone: params.phone,
            p_link_code: params.link_code,
          });
          // Re-query after bootstrap to confirm the actual role from the DB.
          // Handles the case where user_metadata.role is missing (e.g. a teacher
          // invited via link without a role set in metadata). Only override
          // redirectRole if the DB confirms a specific profile — a null result
          // (network blip, test mock) keeps the meta.role value set above.
          const { data: postBootstrapTeacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('auth_user_id', user.id)
            .single();
          const { data: postBootstrapGuardian } = await supabase
            .from('guardians')
            .select('id')
            .eq('auth_user_id', user.id)
            .single();
          if (postBootstrapTeacher) redirectRole = 'teacher';
          else if (postBootstrapGuardian) redirectRole = 'parent';
        } catch (bootstrapErr) {
          console.error(
            '[Complete Signup] Bootstrap failed:',
            bootstrapErr instanceof Error ? bootstrapErr.message : bootstrapErr
          );
          // Non-fatal — AuthContext fallback will retry; role stays as meta.role.
        }
      }
    } else {
      // Detect actual role from the existing profile (pre-bootstrap probes).
      // Precedence mirrors resolveIdentity(): institution_admin > teacher >
      // parent > student.
      if (existingSchoolAdmin) redirectRole = 'institution_admin';
      else if (existingTeacher) redirectRole = 'teacher';
      else if (existingGuardian) redirectRole = 'parent';
      else redirectRole = 'student';
    }

    // Fire-and-forget welcome email (best-effort).
    await sendSignupWelcomeEmail(supabase, user, name, email, redirectRole);
  } catch {
    // Bootstrap/email errors are non-fatal — the caller always redirects (P15).
  }
  return redirectRole;
}
