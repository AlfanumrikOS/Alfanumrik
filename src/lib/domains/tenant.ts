/**
 * Tenant Domain — school and class context (server-only typed reads).
 *
 * CONTRACT:
 *   - Server-only. Uses `supabaseAdmin` (service-role) and is not safe to
 *     import from client components. The ESLint allow-list for
 *     `@/lib/supabase-admin` keeps this contained to `src/lib/domains/**`.
 *   - All functions return `ServiceResult<T>` so callers handle failures
 *     explicitly. Single-row lookups return `ok(null)` (not an error) when
 *     nothing matches, mirroring the identity module.
 *   - Reads only. Writes (insert/update/delete) stay in the owning routes
 *     until tenant write paths are extracted in a later phase.
 *   - Selects only the columns mapped onto the typed projection — never
 *     `select('*')`. New callers that need more fields should add them
 *     explicitly here and update the projection type.
 *
 * MICROSERVICE EXTRACTION PATH (per docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md):
 *   tenant/school context becomes the second service to extract after
 *   identity. Wrap the typed reads in an HTTP handler, add school-scoped
 *   JWT validation, and downstream domains call this service over HTTP
 *   instead of importing the function.
 *
 * AUTH BOUNDARY:
 *   This module does NOT enforce auth. It is a typed wrapper over
 *   `supabaseAdmin` reads. Callers MUST authorize the request (e.g. via
 *   `authorizeRequest`, `authorizeSchoolAdmin`, or `requireAdminSecret`)
 *   BEFORE calling these functions and MUST scope by `schoolId` where
 *   appropriate to prevent cross-tenant reads.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type School,
  type Class,
  type ClassStudent,
  type ClassTeacher,
} from './types';

// ── Schools ───────────────────────────────────────────────────────────────────

type SchoolRow = {
  id: string;
  name: string | null;
  code: string | null;
  slug: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  tagline: string | null;
  custom_domain: string | null;
  domain_verified: boolean | null;
  billing_email: string | null;
  is_active: boolean | null;
  settings: unknown;
};

const SCHOOL_COLUMNS =
  'id, name, code, slug, logo_url, primary_color, secondary_color, ' +
  'tagline, custom_domain, domain_verified, billing_email, is_active, settings';

function mapSchool(row: SchoolRow): School {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    slug: row.slug,
    logoUrl: row.logo_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    tagline: row.tagline,
    customDomain: row.custom_domain,
    domainVerified: row.domain_verified,
    billingEmail: row.billing_email,
    isActive: row.is_active,
    settings: row.settings,
  };
}

/**
 * Look up a school by primary key. Returns `ok(null)` (not an error) when
 * the id does not resolve — callers that need 404 semantics should check
 * for `data === null` explicitly.
 *
 * Does NOT enforce tenant scoping. Caller is responsible for verifying that
 * the requesting user has access to this school (e.g. via
 * `authorizeSchoolAdmin` which already binds `auth.schoolId` to the
 * authenticated admin's school).
 */
export async function getSchoolById(
  schoolId: string
): Promise<ServiceResult<School | null>> {
  if (!schoolId) return fail('schoolId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('schools')
    .select(SCHOOL_COLUMNS)
    .eq('id', schoolId)
    .maybeSingle();

  if (error) {
    logger.error('tenant_get_school_by_id_failed', {
      error: new Error(error.message),
      schoolId,
    });
    return fail(`School lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapSchool(data as SchoolRow) : null);
}

/**
 * Look up a school by its public `code`. Used during signup / invite-code
 * flows where the user supplies a school code rather than an id. Returns
 * `ok(null)` when no match is found.
 */
export async function getSchoolByCode(
  code: string
): Promise<ServiceResult<School | null>> {
  if (!code) return fail('code is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('schools')
    .select(SCHOOL_COLUMNS)
    .eq('code', code)
    .maybeSingle();

  if (error) {
    logger.error('tenant_get_school_by_code_failed', {
      error: new Error(error.message),
      code,
    });
    return fail(`School lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapSchool(data as SchoolRow) : null);
}

// ── Classes ───────────────────────────────────────────────────────────────────

type ClassRow = {
  id: string;
  school_id: string | null;
  name: string | null;
  grade: string | number | null;
  section: string | null;
  academic_year: string | null;
  subject: string | null;
  class_code: string | null;
  is_active: boolean | null;
  max_students: number | null;
  created_at: string | null;
};

const CLASS_COLUMNS =
  'id, school_id, name, grade, section, academic_year, subject, ' +
  'class_code, is_active, max_students, created_at';

function mapClass(row: ClassRow): Class {
  return {
    id: row.id,
    schoolId: row.school_id,
    name: row.name,
    // Invariant P5: grades are strings everywhere. Coerce defensively in
    // case the DB column is ever read back as a number.
    grade: row.grade == null ? null : String(row.grade),
    section: row.section,
    academicYear: row.academic_year,
    subject: row.subject,
    classCode: row.class_code,
    isActive: row.is_active,
    maxStudents: row.max_students,
    createdAt: row.created_at,
  };
}

/**
 * List classes belonging to a school. Soft-deleted rows (`deleted_at IS NOT
 * NULL`) are excluded. `activeOnly` further filters by `is_active = true`.
 *
 * Caller is responsible for tenant authorization — pass the
 * `auth.schoolId` from `authorizeSchoolAdmin`, never a user-supplied
 * value.
 */
export async function listClassesBySchool(
  schoolId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<ServiceResult<Class[]>> {
  if (!schoolId) return fail('schoolId is required', 'INVALID_INPUT');

  let query = supabaseAdmin
    .from('classes')
    .select(CLASS_COLUMNS)
    .eq('school_id', schoolId)
    .is('deleted_at', null)
    .order('grade', { ascending: true })
    .order('section', { ascending: true });

  if (opts.activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('tenant_list_classes_by_school_failed', {
      error: new Error(error.message),
      schoolId,
      activeOnly: opts.activeOnly ?? false,
    });
    return fail(`Class list failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapClass(r as ClassRow)));
}

/**
 * Look up a class by primary key. Returns `ok(null)` when no row matches.
 *
 * `opts.schoolId` performs an additional `school_id` filter — pass
 * `auth.schoolId` from `authorizeSchoolAdmin` to prevent cross-tenant
 * reads. When omitted, the lookup is unscoped (only safe behind super-
 * admin or service-role auth).
 */
export async function getClassById(
  classId: string,
  opts: { schoolId?: string } = {}
): Promise<ServiceResult<Class | null>> {
  if (!classId) return fail('classId is required', 'INVALID_INPUT');

  let query = supabaseAdmin
    .from('classes')
    .select(CLASS_COLUMNS)
    .eq('id', classId)
    .is('deleted_at', null);

  if (opts.schoolId) {
    query = query.eq('school_id', opts.schoolId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.error('tenant_get_class_by_id_failed', {
      error: new Error(error.message),
      classId,
      schoolId: opts.schoolId ?? null,
    });
    return fail(`Class lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapClass(data as ClassRow) : null);
}

// ── Class memberships ─────────────────────────────────────────────────────────

type ClassStudentRow = {
  id: string;
  class_id: string;
  student_id: string;
  is_active: boolean | null;
  enrolled_at: string | null;
};

function mapClassStudent(row: ClassStudentRow): ClassStudent {
  return {
    id: row.id,
    classId: row.class_id,
    studentId: row.student_id,
    isActive: row.is_active,
    enrolledAt: row.enrolled_at,
  };
}

/**
 * List active student enrollments for a class. Reads from the canonical
 * `class_enrollments` table (Phase 2A) — not the legacy `class_students`.
 *
 * Caller MUST verify the class belongs to the requester's school first
 * (e.g. via `getClassById(classId, { schoolId })`). This module returns the
 * raw membership rows; it does not enforce the cross-tenant boundary.
 */
export async function listStudentsInClass(
  classId: string
): Promise<ServiceResult<ClassStudent[]>> {
  if (!classId) return fail('classId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('class_enrollments')
    .select('id, class_id, student_id, is_active, enrolled_at')
    .eq('class_id', classId)
    .eq('is_active', true)
    .order('enrolled_at', { ascending: true });

  if (error) {
    logger.error('tenant_list_students_in_class_failed', {
      error: new Error(error.message),
      classId,
    });
    return fail(`Class students lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapClassStudent(r as ClassStudentRow)));
}

type ClassTeacherRow = {
  id: string;
  class_id: string;
  teacher_id: string;
  role: string | null;
  is_active: boolean | null;
  joined_at: string | null;
};

function mapClassTeacher(row: ClassTeacherRow): ClassTeacher {
  return {
    id: row.id,
    classId: row.class_id,
    teacherId: row.teacher_id,
    role: row.role,
    isActive: row.is_active,
    joinedAt: row.joined_at,
  };
}

/**
 * List teachers assigned to a class. Used by class-analytics and
 * teacher-permission checks.
 *
 * Caller is responsible for tenant authorization. Returns active rows
 * only.
 */
export async function listTeachersInClass(
  classId: string
): Promise<ServiceResult<ClassTeacher[]>> {
  if (!classId) return fail('classId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('class_teachers')
    .select('id, class_id, teacher_id, role, is_active, joined_at')
    .eq('class_id', classId)
    .eq('is_active', true);

  if (error) {
    logger.error('tenant_list_teachers_in_class_failed', {
      error: new Error(error.message),
      classId,
    });
    return fail(`Class teachers lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapClassTeacher(r as ClassTeacherRow)));
}

/**
 * Check whether a specific teacher is assigned to a specific class. Used
 * by routes that need to authorize a teacher's access to class-scoped
 * resources (e.g. exams, analytics) without pulling the full teacher list.
 *
 * Returns `ok(true)` if an active assignment exists; `ok(false)`
 * otherwise. `INVALID_INPUT` if either id is missing.
 */
export async function isTeacherAssignedToClass(
  classId: string,
  teacherId: string
): Promise<ServiceResult<boolean>> {
  if (!classId) return fail('classId is required', 'INVALID_INPUT');
  if (!teacherId) return fail('teacherId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('class_teachers')
    .select('id')
    .eq('class_id', classId)
    .eq('teacher_id', teacherId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    logger.error('tenant_is_teacher_assigned_failed', {
      error: new Error(error.message),
      classId,
      teacherId,
    });
    return fail(`Class teacher lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(Boolean(data));
}
