/**
 * ⚠️ CRITICAL AUTH PATH
 * This file is part of the core authentication system.
 * Changes here WILL break login/signup/verify/reset for ALL users.
 *
 * Before modifying:
 * 1. Run: npm run test -- --grep "auth"
 * 2. Run: node scripts/auth-guard.js
 * 3. Test ALL flows manually: signup, login, verify email, reset password, logout
 *
 * DO NOT: import supabase clients or any server-only module here.
 */
/**
 * Canonical user_metadata → bootstrap_user_profile parameter derivation.
 *
 * R2 (2026-06-10 audit): the role/name/grade/board/subjects parsing from
 * auth user_metadata was hand-rolled 4+ times across the auth module
 * (auth/callback, auth/confirm, api/auth/bootstrap, AuthContext) and had
 * drifted:
 *   - BOTH server confirmation routes passed p_subjects_taught /
 *     p_grades_taught as null, silently dropping the teacher fields that
 *     AuthScreen.tsx (B4, lines 162-167) persists into auth metadata
 *     precisely so these routes can bootstrap the teacher profile after
 *     email confirmation.
 *   - The grade default was re-implemented per-site ("meta.grade || '9'")
 *     instead of going through normalizeGrade (P5: bare strings '6'..'12',
 *     canonical default '9').
 *
 * This module is PURE and CLIENT-SAFE: no supabase imports, no server-only
 * dependencies. Route handlers and client code may both use it.
 */

import {
  isValidGrade,
  isValidRole,
  normalizeGrade,
  type ValidGrade,
  type ValidRole,
} from './constants';

/**
 * Parameters for the bootstrap_user_profile RPC plus the school fields
 * consumed by the institution_admin school-creation branch.
 */
export interface BootstrapProfileParams {
  /** Normalized role — includes 'institution_admin' (part of ValidRole). */
  role: ValidRole;
  name: string;
  email: string;
  /** P5-normalized grade string ('6'..'12'), canonical default '9'. */
  grade: ValidGrade;
  board: string;
  /** Teacher subjects_taught — null when absent/unparseable. */
  subjects: string[] | null;
  /** Teacher grades_taught — P5-filtered, null when absent/unparseable. */
  grades_taught: string[] | null;
  /** Parent child link code — null when absent/blank. */
  link_code: string | null;
  school_name: string | null;
  school_city: string | null;
  school_state: string | null;
  phone: string | null;
}

/**
 * Single canonical metadata→role mapping (return type ValidRole already
 * includes 'institution_admin').
 *
 * Rules (mirrors the previous hand-rolled `meta.role || 'student'` sites,
 * plus the guardian→parent alias from ROLE_ALIASES):
 *   - 'guardian' → 'parent' (DB table is "guardians" but the role is "parent")
 *   - any valid role → itself
 *   - missing/invalid → 'student' (safe default, P15: signup must not break)
 */
export function roleFromMetadata(
  meta: Record<string, unknown> | null | undefined
): ValidRole {
  const raw = typeof meta?.role === 'string' ? meta.role.trim() : '';
  if (raw === 'guardian') return 'parent';
  return isValidRole(raw) ? raw : 'student';
}

/** Trimmed non-empty string, else null. */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Defensive string-array parser. user_metadata values survive a JSON
 * round-trip through GoTrue, so arrays may arrive either as real arrays or
 * as JSON strings (AuthScreen stores `JSON.stringify(subjectsTaught)`).
 * Numbers are coerced to strings (covers `[6, 7]` style payloads).
 * Returns null when the value is absent or unparseable.
 */
export function parseStringArray(value: unknown): string[] | null {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(candidate)) return null;
  const out = candidate
    .map((item) =>
      typeof item === 'string'
        ? item.trim()
        : typeof item === 'number'
          ? String(item)
          : ''
    )
    .filter((item) => item.length > 0);
  return out.length > 0 ? out : null;
}

/**
 * Derive the full bootstrap parameter set from a Supabase auth user.
 * Pure function — never throws on malformed metadata (P15).
 *
 * Note: AuthScreen stores institution_admin city/state as `city`/`state`;
 * `school_city`/`school_state` are accepted as fallbacks for forward
 * compatibility.
 */
export function profileParamsFromMetadata(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): BootstrapProfileParams {
  const meta: Record<string, unknown> = user.user_metadata ?? {};
  const email = typeof user.email === 'string' ? user.email : '';

  const role = roleFromMetadata(meta);
  const name =
    nonEmptyString(meta.name) ?? (email ? email.split('@')[0] : '');

  // P5: grades_taught entries must be bare strings '6'..'12'. Coerce, then
  // drop invalid entries instead of failing the whole bootstrap.
  const gradesTaughtRaw = parseStringArray(meta.grades_taught);
  const gradesTaught = gradesTaughtRaw
    ? gradesTaughtRaw.filter((g) => isValidGrade(g))
    : null;

  return {
    role,
    name,
    email,
    grade: normalizeGrade(meta.grade),
    board: nonEmptyString(meta.board) ?? 'CBSE',
    subjects: parseStringArray(meta.subjects_taught),
    grades_taught: gradesTaught && gradesTaught.length > 0 ? gradesTaught : null,
    link_code: nonEmptyString(meta.link_code),
    school_name: nonEmptyString(meta.school_name),
    school_city: nonEmptyString(meta.city) ?? nonEmptyString(meta.school_city),
    school_state:
      nonEmptyString(meta.state) ?? nonEmptyString(meta.school_state),
    phone: nonEmptyString(meta.phone),
  };
}
