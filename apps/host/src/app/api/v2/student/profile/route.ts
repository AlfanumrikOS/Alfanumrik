/**
 * GET /api/v2/student/profile — authenticated student profile (mobile + web).
 *
 * Thin read. Reuses the same identity/profile domain pattern the existing
 * /api/student/profile route uses (server-side `students` read keyed by the
 * authenticated user). No new query logic — the columns returned are the
 * profile fields the mobile app needs.
 *
 * P5: grade is returned as a STRING (coerced defensively).
 * P13: no PII logged.
 *
 * Auth: profile.view_own (same permission the oauth-manager profile read uses).
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getStudentByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'profile.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized || !auth.userId) return auth.errorResponse!;

    // Reuse the identity domain read to resolve the student (id + base fields).
    const identity = await getStudentByAuthUserId(auth.userId);
    if (!identity.ok) {
      return v2Error('Profile lookup failed', 500, 'INTERNAL_ERROR');
    }
    if (!identity.data) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }
    const student = identity.data;

    // The identity Student type omits stream/plan/language — read those columns
    // server-side (same `students` table, no new query logic).
    const admin = getSupabaseAdmin();
    const { data: extra } = await admin
      .from('students')
      .select('board, stream, subscription_plan, preferred_language')
      .eq('id', student.id)
      .maybeSingle();

    return v2Success({
      schemaVersion: 1 as const,
      student_id: student.id,
      name: student.name,
      // P5: grade is a string.
      grade: student.grade == null ? null : String(student.grade),
      board: (extra?.board as string | null) ?? null,
      stream: (extra?.stream as string | null) ?? null,
      plan: (extra?.subscription_plan as string | null) ?? null,
      language: (extra?.preferred_language as string | null) ?? null,
    });
  } catch (err) {
    logger.error('v2_student_profile_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/student/profile',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
