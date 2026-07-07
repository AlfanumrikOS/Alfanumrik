/**
 * bulk-roster.ts — Track A.4 shared helpers for day-1 bulk roster + class import.
 *
 * Backend-owned. Powers four school-admin endpoints:
 *   - POST /api/school-admin/classes/bulk-create
 *   - POST /api/school-admin/students/bulk-import
 *   - POST /api/school-admin/teachers/bulk-import
 *   - POST /api/school-admin/roster/validate   (dry-run, no writes)
 *
 * ─── HARD CONSTRAINTS THIS MODULE ENFORCES ───────────────────────────────────
 *   - TENANT ISOLATION (P8/P13): every read/write is scoped to the `schoolId`
 *     passed by the route (resolved from `authorizeSchoolAdmin`). NO function
 *     here trusts a `school_id` from the request body — the routes never pass one
 *     through. A bulk import can only touch the caller's own school.
 *   - SEAT CEILING (P11-adjacent, RACE-SAFE): the ceiling math is owned by the SQL
 *     RPCs (migration 20260621000100 `assert_seat_capacity` for the READ-ONLY
 *     dry-run preview; migration 20260621000500 `enroll_student_with_seat_check` /
 *     `register_teacher_with_seat_check` for the ATOMIC real writes). The REAL
 *     write path NO LONGER probes-once-then-decrements-a-local-budget (that was a
 *     cross-request TOCTOU race: two concurrent same-school imports each read the
 *     same `remaining` and could collectively exceed the ceiling). Instead each row
 *     calls the atomic enroll RPC, which takes a per-school advisory lock,
 *     recomputes the ceiling UNDER the lock (the SAME assert_seat_capacity math),
 *     and inserts-or-blocks in ONE transaction. The dry-run preview MAY stay a
 *     non-locking estimate (`probeSeatCapacity`) — only the real writes must be
 *     race-safe. We NEVER re-implement the ceiling in TypeScript.
 *   - P13 (no PII in logs): per-row results returned to the CALLER carry the
 *     submitted row's identifying fields; LOGS carry only counts + row indices +
 *     stable error codes. NO name/email/phone is ever logged.
 *   - P5: grades are STRINGS "6".."12" everywhere.
 *   - IDEMPOTENCY: re-running a bulk import never duplicates — students/teachers
 *     dedupe by (school_id, email); classes by (school_id, grade, section,
 *     academic_year); enrollment by the (class_id, student_id) UNIQUE key.
 */

import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';

// ─── Shared constants ────────────────────────────────────────────────────────

/** Hard cap on rows per bulk request (students/teachers). Larger → 413. */
export const MAX_BULK_ROWS = 500;

/** Hard cap on classes per bulk-create request. */
export const MAX_BULK_CLASSES = 200;

/** Canonical CBSE grade strings (P5 — strings, never integers). */
export const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;

/** Sections used by the template preset (grades × sections). */
export const TEMPLATE_SECTIONS = ['A', 'B', 'C', 'D'] as const;

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Custom SQLSTATE-mapped marker raised by assert_seat_capacity on a hard block. */
export const SEAT_CAPACITY_EXCEEDED = 'seat_capacity_exceeded';

// ─── Per-row result vocabulary (returned to the CALLER, never logged with PII) ─

export type RowStatus = 'created' | 'skipped' | 'blocked' | 'failed';

/** Stable machine-readable codes. Safe to log (no PII). */
export type RowCode =
  // success / idempotent
  | 'created'
  | 'already_exists'
  | 'duplicate_in_batch'
  // validation
  | 'invalid_name'
  | 'invalid_email'
  | 'invalid_grade'
  | 'invalid_section'
  | 'invalid_subjects'
  | 'invalid_roll_number'
  | 'missing_class'
  | 'class_not_found'
  // capacity / infra
  | 'seat_limit_reached'
  | 'create_failed'
  | 'enroll_failed'
  | 'seat_check_unavailable';

export interface RowResult {
  /** 0-based index into the submitted array (stable, never PII). */
  index: number;
  status: RowStatus;
  code: RowCode;
  /** Optional resource id created (student/teacher/class). */
  id?: string;
}

// ─── Seat-capacity gate (single source of truth = assert_seat_capacity RPC) ───

export interface SeatSnapshot {
  ceiling: number;
  used: number;
  remaining: number;
}

export type SeatProbe =
  | { ok: true; snapshot: SeatSnapshot }
  | { ok: false; reason: 'at_ceiling'; snapshot: SeatSnapshot | null }
  | { ok: false; reason: 'unavailable' };

/**
 * Probe current seat capacity for a school via the authoritative RPC.
 *
 * `assert_seat_capacity` RAISES 'seat_capacity_exceeded' (SQLSTATE P0001) when
 * the school is AT or ABOVE its ceiling, otherwise it returns
 * `{ ok, ceiling, used, remaining }`. We translate the raise into a structured
 * `at_ceiling` probe (remaining = 0) so the caller can mark overflow rows
 * `blocked` WITHOUT leaking SQL (P13). Any other error → `unavailable` (503).
 *
 * This is the ONLY place the ceiling is read. The bulk-import routes call it
 * ONCE per batch and then decrement a local budget, so the loop can never
 * exceed the ceiling and we avoid an N+1 of RPC calls.
 */
export async function probeSeatCapacity(schoolId: string): Promise<SeatProbe> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('assert_seat_capacity', {
    p_school_id: schoolId,
  });

  if (error) {
    const pgErr = error as { code?: string; message?: string };
    // P0001 with the seat_capacity_exceeded marker = hard block at ceiling.
    if (
      pgErr.code === 'P0001' &&
      (pgErr.message ?? '').includes(SEAT_CAPACITY_EXCEEDED)
    ) {
      return { ok: false, reason: 'at_ceiling', snapshot: { ceiling: 0, used: 0, remaining: 0 } };
    }
    return { ok: false, reason: 'unavailable' };
  }

  const v = (data ?? {}) as {
    ok?: boolean;
    ceiling?: number;
    used?: number;
    remaining?: number;
  };
  return {
    ok: true,
    snapshot: {
      ceiling: Number(v.ceiling ?? 0),
      used: Number(v.used ?? 0),
      remaining: Math.max(Number(v.remaining ?? 0), 0),
    },
  };
}

// ─── Atomic, race-safe seat-checked writes (fix S1) ──────────────────────────
// The REAL write path serialises per school via these RPCs (migration
// 20260621000500). Each takes the per-school advisory lock, recomputes the
// assert_seat_capacity ceiling UNDER the lock, and inserts-or-blocks atomically —
// so two concurrent same-school imports can never collectively over-commit seats.

/** Verdict from an atomic seat-checked enroll/register RPC. */
export type AtomicSeatOutcome =
  /** Row written (or already active). granted=true. */
  | { ok: true; granted: true; status: string; teacherId?: string }
  /** Ceiling reached under the lock — nothing written. granted=false. */
  | { ok: true; granted: false; status: 'blocked' }
  /** RPC errored (infra). Caller maps to a 'failed'/503 path. */
  | { ok: false };

/**
 * Atomically enroll ONE student into ONE class with a seat check held under a
 * per-school advisory lock. Idempotent on (class_id, student_id). Returns granted
 * (created/already_active) or blocked (ceiling reached). Never leaks SQL (P13).
 */
export async function atomicEnrollStudent(
  schoolId: string,
  studentId: string,
  classId: string,
  rollNumber: string | null,
): Promise<AtomicSeatOutcome> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('enroll_student_with_seat_check', {
    p_school_id: schoolId,
    p_student_id: studentId,
    p_class_id: classId,
    p_roll_number: rollNumber,
  });
  if (error) return { ok: false };
  const v = (data ?? {}) as { granted?: boolean; status?: string };
  if (v.granted) return { ok: true, granted: true, status: String(v.status ?? 'created') };
  return { ok: true, granted: false, status: 'blocked' };
}

/**
 * Atomically create-or-reactivate ONE teacher with a seat check held under a
 * per-school advisory lock. Idempotent by (school_id, email). Returns granted
 * (created/already_exists) with the teacher_id, or blocked (ceiling reached).
 */
export async function atomicRegisterTeacher(
  schoolId: string,
  name: string,
  email: string,
  subjects: string[],
  grades: string[],
): Promise<AtomicSeatOutcome> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('register_teacher_with_seat_check', {
    p_school_id: schoolId,
    p_name: name,
    p_email: email,
    p_subjects: subjects,
    p_grades: grades,
  });
  if (error) return { ok: false };
  const v = (data ?? {}) as { granted?: boolean; status?: string; teacher_id?: string };
  if (v.granted) {
    return { ok: true, granted: true, status: String(v.status ?? 'created'), teacherId: v.teacher_id };
  }
  return { ok: true, granted: false, status: 'blocked' };
}

// ─── Validation (pure — no I/O, no logging) ──────────────────────────────────

export function isValidGrade(grade: unknown): grade is (typeof VALID_GRADES)[number] {
  return typeof grade === 'string' && (VALID_GRADES as readonly string[]).includes(grade);
}

export function isValidEmail(email: unknown): boolean {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

// ─── Class normalization + idempotency key ───────────────────────────────────

export interface NormalizedClass {
  name: string;
  grade: string;
  section: string;
  academic_year: string;
  subject: string | null;
  max_students: number;
}

/** Stable idempotency key for a class within a school. */
export function classKey(c: { grade: string; section: string; academic_year: string }): string {
  return `${c.grade}::${(c.section || '').toUpperCase()}::${c.academic_year}`;
}

// ─── Student / teacher normalization ─────────────────────────────────────────

export interface NormalizedStudent {
  name: string;
  email: string;
  grade: string;
  /** Section name or class_code used to resolve the target class (optional). */
  class_ref: string | null;
  roll_number: string | null;
  parent_email: string | null;
  parent_phone: string | null;
}

export interface NormalizedTeacher {
  name: string;
  email: string;
  subjects_taught: string[];
  grades_taught: string[];
  employee_id: string | null;
  /** Section names / class_codes the teacher is assigned to (optional). */
  class_refs: string[];
}

export type ValidationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: RowCode };

export function validateStudentRow(raw: Record<string, unknown>): ValidationOutcome<NormalizedStudent> {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name.length < 2) return { ok: false, code: 'invalid_name' };

  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return { ok: false, code: 'invalid_email' };

  const grade = raw.grade != null ? String(raw.grade).trim() : '';
  if (!isValidGrade(grade)) return { ok: false, code: 'invalid_grade' };

  const classRefRaw =
    (typeof raw.class_ref === 'string' && raw.class_ref) ||
    (typeof raw.section === 'string' && raw.section) ||
    (typeof raw.class_code === 'string' && raw.class_code) ||
    '';
  const class_ref = classRefRaw ? String(classRefRaw).trim() : null;

  const roll =
    raw.roll_number != null && String(raw.roll_number).trim().length > 0
      ? String(raw.roll_number).trim()
      : null;
  if (roll && roll.length > 32) return { ok: false, code: 'invalid_roll_number' };

  const parent_email =
    typeof raw.parent_email === 'string' && raw.parent_email.trim()
      ? raw.parent_email.trim().toLowerCase()
      : null;
  if (parent_email && !isValidEmail(parent_email)) {
    return { ok: false, code: 'invalid_email' };
  }

  const parent_phone =
    typeof raw.parent_phone === 'string' && raw.parent_phone.trim()
      ? raw.parent_phone.trim()
      : null;

  return {
    ok: true,
    value: { name, email, grade, class_ref, roll_number: roll, parent_email, parent_phone },
  };
}

export function validateTeacherRow(raw: Record<string, unknown>): ValidationOutcome<NormalizedTeacher> {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name.length < 2) return { ok: false, code: 'invalid_name' };

  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return { ok: false, code: 'invalid_email' };

  const subjects = Array.isArray(raw.subjects_taught)
    ? raw.subjects_taught.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
    : [];

  const gradesRaw = Array.isArray(raw.grades_taught) ? raw.grades_taught : [];
  const grades: string[] = [];
  for (const g of gradesRaw) {
    const gs = g != null ? String(g).trim() : '';
    if (!isValidGrade(gs)) return { ok: false, code: 'invalid_grade' };
    grades.push(gs);
  }

  const employee_id =
    raw.employee_id != null && String(raw.employee_id).trim().length > 0
      ? String(raw.employee_id).trim()
      : null;

  const refsRaw = Array.isArray(raw.class_refs)
    ? raw.class_refs
    : Array.isArray(raw.classes)
      ? raw.classes
      : [];
  const class_refs = refsRaw
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    .map((r) => r.trim());

  return {
    ok: true,
    value: { name, email, subjects_taught: subjects, grades_taught: grades, employee_id, class_refs },
  };
}

export function validateClassRow(raw: Record<string, unknown>): ValidationOutcome<NormalizedClass> {
  const grade = raw.grade != null ? String(raw.grade).trim() : '';
  if (!isValidGrade(grade)) return { ok: false, code: 'invalid_grade' };

  const section = typeof raw.section === 'string' ? raw.section.trim() : '';
  if (!section || section.length > 8) return { ok: false, code: 'invalid_section' };

  const academic_year =
    typeof raw.academic_year === 'string' && raw.academic_year.trim()
      ? raw.academic_year.trim()
      : '2026-27';

  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : `Grade ${grade} - ${section.toUpperCase()}`;

  const subject =
    typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : null;

  const max_students =
    typeof raw.max_students === 'number' && Number.isFinite(raw.max_students) && raw.max_students > 0
      ? Math.floor(raw.max_students)
      : 60;

  return {
    ok: true,
    value: { name, grade, section: section.toUpperCase(), academic_year, subject, max_students },
  };
}

// ─── Class resolution: map a class_ref (section name or class_code) → class id ─

/**
 * Build an in-memory index of the caller's existing classes keyed by BOTH
 * section name (case-insensitive) and class_code, scoped to `schoolId`.
 * Used so per-row class refs resolve without an N+1 query. Tenant-scoped:
 * only classes of `schoolId` are loaded.
 */
export async function loadClassIndex(
  schoolId: string,
): Promise<{ bySection: Map<string, string>; byCode: Map<string, string> }> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('classes')
    .select('id, section, class_code, grade, academic_year')
    .eq('school_id', schoolId)
    .is('deleted_at', null);

  const bySection = new Map<string, string>();
  const byCode = new Map<string, string>();
  for (const c of data ?? []) {
    const row = c as { id: string; section: string | null; class_code: string | null };
    if (row.section) bySection.set(row.section.toUpperCase(), row.id);
    if (row.class_code) byCode.set(row.class_code, row.id);
  }
  return { bySection, byCode };
}

export function resolveClassId(
  ref: string | null,
  index: { bySection: Map<string, string>; byCode: Map<string, string> },
): string | null {
  if (!ref) return null;
  return index.byCode.get(ref) ?? index.bySection.get(ref.toUpperCase()) ?? null;
}
