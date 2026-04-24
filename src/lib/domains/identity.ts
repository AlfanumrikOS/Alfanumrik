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
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type StudentIdentity,
  type Student,
  type Teacher,
  type Guardian,
} from './types';

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

// ── Server-only typed read APIs ───────────────────────────────────────────────
//
// These wrap the most common `.from('students' | 'teachers' | 'guardians')`
// read patterns used across API routes. They are server-only because they
// use `supabaseAdmin` (service-role). The ESLint `no-restricted-imports`
// rule on `@/lib/supabase-admin` keeps these from being called from client
// components; `src/lib/domains/**` is in the allow-list.
//
// Contract rules:
//   - Return ServiceResult<T | null> for single-row lookups (null = not found,
//     not an error). Reserve `NOT_FOUND` for routes that want to treat
//     missing as an error.
//   - Return ServiceResult<T[]> for list endpoints; an empty array is ok.
//   - Never `select('*')`. Select exactly the columns mapped onto the
//     returned typed shape.
//   - Map raw snake_case rows to the camelCase domain type once, here, so
//     callers don't depend on database column names.

type StudentRow = {
  id: string;
  auth_user_id: string | null;
  name: string | null;
  email: string | null;
  grade: string | number | null;
  school_id: string | null;
  is_active: boolean | null;
};

function mapStudent(row: StudentRow): Student {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    name: row.name,
    email: row.email,
    // Invariant P5: grades are strings everywhere. Coerce defensively.
    grade: row.grade == null ? null : String(row.grade),
    schoolId: row.school_id,
    isActive: row.is_active,
  };
}

const STUDENT_COLUMNS =
  'id, auth_user_id, name, email, grade, school_id, is_active';

/**
 * Look up a student by auth_user_id. Returns null (not an error) when no
 * student profile exists for the account — e.g. users who signed up as
 * teacher/parent, or users mid-onboarding.
 */
export async function getStudentByAuthUserId(
  authUserId: string
): Promise<ServiceResult<Student | null>> {
  if (!authUserId) return fail('authUserId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('students')
    .select(STUDENT_COLUMNS)
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    logger.error('identity_get_student_by_auth_user_failed', {
      error: new Error(error.message),
      authUserId,
    });
    return fail(`Student lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapStudent(data as StudentRow) : null);
}

/**
 * Look up a student by primary key. Returns null (not an error) when the
 * id does not resolve — callers that need 404 semantics should check for
 * `data === null` explicitly.
 *
 * This does NOT enforce ownership. Routes that accept a user-supplied
 * studentId MUST either be super-admin-gated or use
 * `resolveStudentById` (client) which performs the ownership check.
 */
export async function getStudentById(
  studentId: string
): Promise<ServiceResult<Student | null>> {
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('students')
    .select(STUDENT_COLUMNS)
    .eq('id', studentId)
    .maybeSingle();

  if (error) {
    logger.error('identity_get_student_by_id_failed', {
      error: new Error(error.message),
      studentId,
    });
    return fail(`Student lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapStudent(data as StudentRow) : null);
}

type TeacherRow = {
  id: string;
  auth_user_id: string | null;
  name: string | null;
  email: string | null;
  school_id: string | null;
  school_name: string | null;
};

const TEACHER_COLUMNS =
  'id, auth_user_id, name, email, school_id, school_name';

function mapTeacher(row: TeacherRow): Teacher {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    name: row.name,
    email: row.email,
    schoolId: row.school_id,
    schoolName: row.school_name,
  };
}

/**
 * Look up a teacher by auth_user_id. Returns null (not an error) when no
 * teacher profile exists for the account.
 */
export async function getTeacherByAuthUserId(
  authUserId: string
): Promise<ServiceResult<Teacher | null>> {
  if (!authUserId) return fail('authUserId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('teachers')
    .select(TEACHER_COLUMNS)
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    logger.error('identity_get_teacher_by_auth_user_failed', {
      error: new Error(error.message),
      authUserId,
    });
    return fail(`Teacher lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapTeacher(data as TeacherRow) : null);
}

type GuardianRow = {
  id: string;
  auth_user_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
};

const GUARDIAN_COLUMNS = 'id, auth_user_id, name, email, phone';

function mapGuardian(row: GuardianRow): Guardian {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
  };
}

/**
 * Look up a guardian by auth_user_id. Returns null (not an error) when no
 * guardian profile exists for the account.
 */
export async function getGuardianByAuthUserId(
  authUserId: string
): Promise<ServiceResult<Guardian | null>> {
  if (!authUserId) return fail('authUserId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('guardians')
    .select(GUARDIAN_COLUMNS)
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    logger.error('identity_get_guardian_by_auth_user_failed', {
      error: new Error(error.message),
      authUserId,
    });
    return fail(`Guardian lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapGuardian(data as GuardianRow) : null);
}

/**
 * List students belonging to a school. Used by school-admin and school-
 * reporting APIs. `activeOnly` defaults to false — pass true to match the
 * `is_active = true` filter used by evaluate-alerts and school dashboards.
 */
export async function listStudentsBySchool(
  schoolId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<ServiceResult<Student[]>> {
  if (!schoolId) return fail('schoolId is required', 'INVALID_INPUT');

  let query = supabaseAdmin
    .from('students')
    .select(STUDENT_COLUMNS)
    .eq('school_id', schoolId);

  if (opts.activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('identity_list_students_by_school_failed', {
      error: new Error(error.message),
      schoolId,
      activeOnly: opts.activeOnly ?? false,
    });
    return fail(`School students lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapStudent(r as StudentRow)));
}
