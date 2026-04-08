/**
 * Identity Domain — student resolution, auth token helpers, feature flags.
 *
 * CONTRACT:
 *   - resolveCurrentStudent is the SINGLE place where auth.getUser() is called
 *     and mapped to a student record. All other domains call this function.
 *   - Feature flag reads are cached per-request (not cached at module level)
 *     so wave changes take effect without redeploy.
 *   - No writes happen here — identity is read-only from the client side.
 *
 * MICROSERVICE EXTRACTION PATH:
 *   auth/identity becomes the first service to extract because it has
 *   no write-side coupling. Wrap in an HTTP handler, add JWT validation,
 *   and the other domains call it via HTTP instead of import.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { ok, fail, type ServiceResult, type StudentIdentity } from './types';

// ── Student resolution ────────────────────────────────────────────────────────

/**
 * Resolve the currently authenticated user to their student record.
 *
 * This is the authoritative student resolution path. All client-side page
 * components that need studentId should call this, not read from local state
 * or parse the JWT directly.
 */
export async function resolveCurrentStudent(): Promise<ServiceResult<StudentIdentity>> {
  let authUserId: string;

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return fail('No authenticated session', 'UNAUTHORIZED');
    }
    authUserId = user.id;
  } catch (e) {
    return fail(
      `Auth check failed: ${e instanceof Error ? e.message : String(e)}`,
      'UNAUTHORIZED'
    );
  }

  const { data: student, error: dbErr } = await supabase
    .from('students')
    .select('id, grade, name, auth_user_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (dbErr) {
    logger.error('identity_domain_student_lookup_failed', {
      error: new Error(dbErr.message),
      authUserId,
    });
    return fail(`Student lookup failed: ${dbErr.message}`, 'DB_ERROR');
  }

  if (!student) {
    return fail('Student profile not found for this account', 'NOT_FOUND');
  }

  return ok({
    studentId: student.id,
    authUserId,
    grade: String(student.grade),
    name: student.name,
  });
}

/**
 * Resolve a specific student by ID, verifying it belongs to the
 * current authenticated user. Use this for any route that accepts
 * a student_id parameter to prevent IDOR.
 */
export async function resolveStudentById(
  studentId: string
): Promise<ServiceResult<StudentIdentity>> {
  let authUserId: string;

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return fail('No authenticated session', 'UNAUTHORIZED');
    }
    authUserId = user.id;
  } catch (e) {
    return fail(
      `Auth check failed: ${e instanceof Error ? e.message : String(e)}`,
      'UNAUTHORIZED'
    );
  }

  const { data: student, error: dbErr } = await supabase
    .from('students')
    .select('id, grade, name, auth_user_id')
    .eq('id', studentId)
    .eq('auth_user_id', authUserId) // ownership check — prevents IDOR
    .maybeSingle();

  if (dbErr) {
    return fail(`Student lookup failed: ${dbErr.message}`, 'DB_ERROR');
  }

  if (!student) {
    // Either not found or belongs to different user — same 404 to prevent enumeration
    return fail('Student not found', 'NOT_FOUND');
  }

  return ok({
    studentId: student.id,
    authUserId,
    grade: String(student.grade),
    name: student.name,
  });
}

// ── Auth token ────────────────────────────────────────────────────────────────

/**
 * Get the current session JWT for edge function calls.
 * Never reads from local storage directly — always goes through getSession().
 */
export async function getAuthToken(): Promise<ServiceResult<string>> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      return fail('No active session', 'UNAUTHORIZED');
    }
    return ok(session.access_token);
  } catch (e) {
    return fail(
      `Session fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      'UNAUTHORIZED'
    );
  }
}

// ── Feature flags ─────────────────────────────────────────────────────────────

export interface FeatureFlag {
  flag_name: string;
  is_enabled: boolean;
  wave: number | null;
  target_subjects: string[] | null;
  target_languages: string[] | null;
}

/**
 * Read feature flags for the current context.
 * No caching at this layer — caching belongs in the component or a
 * React context, not in a domain function.
 */
export async function getFeatureFlags(
  role?: string,
  institutionId?: string
): Promise<ServiceResult<Record<string, boolean>>> {
  let query = supabase
    .from('feature_flags')
    .select('flag_name, is_enabled, rollout_percentage, target_roles, target_institution_ids');

  const { data, error } = await query;

  if (error) {
    logger.warn('identity_domain_feature_flags_failed', { error: error.message });
    return fail(`Feature flags fetch failed: ${error.message}`, 'DB_ERROR');
  }

  const flags: Record<string, boolean> = {};

  for (const flag of data ?? []) {
    let enabled = flag.is_enabled;

    // Role targeting
    if (enabled && flag.target_roles?.length && role) {
      enabled = flag.target_roles.includes(role);
    }

    // Institution targeting
    if (enabled && flag.target_institution_ids?.length && institutionId) {
      enabled = flag.target_institution_ids.includes(institutionId);
    }

    // Rollout percentage (deterministic by flag name hash — same user always sees same result)
    if (enabled && flag.rollout_percentage != null && flag.rollout_percentage < 100) {
      const hash = flag.flag_name.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
      enabled = (hash % 100) < flag.rollout_percentage;
    }

    flags[flag.flag_name] = enabled;
  }

  return ok(flags);
}
