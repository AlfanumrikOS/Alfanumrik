/**
 * Identity System Constants
 *
 * Single source of truth for all identity-related constants.
 * Any file that needs role definitions, route classifications,
 * or onboarding rules MUST import from here.
 *
 * WARNING: Changes here affect login, signup, onboarding,
 * routing, and access control. Run auth tests after any change.
 */

// ── Roles ────────────────────────────────────────────────────

export const VALID_ROLES = ['student', 'teacher', 'parent'] as const;
export type ValidRole = typeof VALID_ROLES[number];

export const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
export type ValidGrade = typeof VALID_GRADES[number];

export const VALID_BOARDS = ['CBSE', 'ICSE', 'State Board', 'IB', 'Other'] as const;
export type ValidBoard = typeof VALID_BOARDS[number];

// ── Role ↔ Destination Mapping ────────────────────────────────
// Single source of truth. Used by: login page, callback route,
// bootstrap API, AuthContext.

export const ROLE_DESTINATIONS: Record<ValidRole, string> = {
  student: '/dashboard',
  teacher: '/teacher',
  parent: '/parent',
};

/** Map from internal role name to URL-safe role name */
export const ROLE_ALIASES: Record<string, ValidRole> = {
  student: 'student',
  teacher: 'teacher',
  parent: 'parent',
  guardian: 'parent', // DB table is "guardians" but role is "parent"
};

/** Get the post-login destination for a role */
export function getRoleDestination(role: string): string {
  const normalized = ROLE_ALIASES[role] || 'student';
  return ROLE_DESTINATIONS[normalized] || '/dashboard';
}

// ── Onboarding States ─────────────────────────────────────────

export const ONBOARDING_STEPS = [
  'identity_created',
  'profile_created',
  'role_assigned',
  'completed',
  'failed',
] as const;
export type OnboardingStep = typeof ONBOARDING_STEPS[number];

// ── Route Classification ──────────────────────────────────────

/** Routes that never require authentication */
export const PUBLIC_ROUTES = [
  '/welcome',
  '/login',
  '/auth/callback',
  '/auth/confirm',
  '/auth/reset',
  '/privacy',
  '/terms',
  '/about',
  '/api/auth/bootstrap',   // requires session internally
  '/api/auth/onboarding-status', // requires session internally
  '/api/v1/health',
] as const;

/** Routes protected by middleware cookie check */
export const MIDDLEWARE_PROTECTED_PREFIXES = [
  '/parent/children',
  '/parent/reports',
  '/parent/profile',
  '/parent/support',
  '/billing',
] as const;

/** Routes protected by client-side useRequireAuth */
export const CLIENT_PROTECTED_ROUTES = [
  '/dashboard',
  '/quiz',
  '/profile',
  '/progress',
  '/foxy',
] as const;

/** Routes requiring specific RBAC permissions */
export const ADMIN_ROUTE_PREFIXES = [
  '/super-admin',
  '/internal/admin',
  '/api/internal/admin',
  '/api/super-admin',
] as const;

// ── Auth Event Types (for audit log) ─────────────────────────

export const AUTH_EVENT_TYPES = [
  'signup_start',
  'signup_complete',
  'login_success',
  'login_failure',
  'password_reset_request',
  'password_reset_complete',
  'logout',
  'bootstrap_success',
  'bootstrap_failure',
  'bootstrap_idempotent',
  'admin_repair',
  'demo_account_created',
  'demo_account_reset',
] as const;
export type AuthEventType = typeof AUTH_EVENT_TYPES[number];

// ── Validation Helpers ────────────────────────────────────────

export function isValidRole(role: unknown): role is ValidRole {
  return typeof role === 'string' && VALID_ROLES.includes(role as ValidRole);
}

export function isValidGrade(grade: unknown): grade is ValidGrade {
  return typeof grade === 'string' && VALID_GRADES.includes(grade as ValidGrade);
}

export function isValidBoard(board: unknown): board is ValidBoard {
  return typeof board === 'string' && VALID_BOARDS.includes(board as ValidBoard);
}

/** Coerce a grade value to a valid string grade (P5 compliance) */
export function normalizeGrade(value: unknown): ValidGrade {
  if (typeof value === 'string' && VALID_GRADES.includes(value as ValidGrade)) {
    return value as ValidGrade;
  }
  if (typeof value === 'number' && value >= 6 && value <= 12) {
    return String(value) as ValidGrade;
  }
  return '9'; // safe default
}

// ── Open Redirect Prevention ──────────────────────────────────

const SAFE_NEXT_PATTERN = /^\/[a-zA-Z0-9\-_/?.=&]+$/;

/**
 * Validate a redirect target to prevent open redirect attacks.
 * Returns the validated path or a safe fallback.
 */
export function validateRedirectTarget(next: string, fallback = '/dashboard'): string {
  if (
    next.startsWith('/') &&
    !next.startsWith('//') &&
    !next.includes('\\') &&
    !next.toLowerCase().includes('%2f') &&
    !next.toLowerCase().includes('javascript:') &&
    SAFE_NEXT_PATTERN.test(next)
  ) {
    return next;
  }
  return fallback;
}
