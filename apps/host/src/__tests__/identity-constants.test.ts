/**
 * Tests for src/lib/identity/constants.ts
 *
 * Covers the centralized identity module: roles, grades, boards,
 * routing, validation helpers, and open redirect prevention.
 *
 * Regression catalog entries covered:
 *   - grade_is_string (P5): Grade "6" accepted, integer 6 rejected or coerced
 *   - grade_range (P5): "5" and "13" rejected, "6" through "12" accepted
 *   - unauthenticated_redirect (partial): validates redirect target sanitization
 *
 * Security coverage:
 *   - Open redirect prevention (validateRedirectTarget)
 *   - Input validation for roles, grades, boards
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VALID_ROLES,
  VALID_GRADES,
  VALID_BOARDS,
  ROLE_DESTINATIONS,
  ROLE_ALIASES,
  getRoleDestination,
  ONBOARDING_STEPS,
  AUTH_EVENT_TYPES,
  PUBLIC_ROUTES,
  MIDDLEWARE_PROTECTED_PREFIXES,
  CLIENT_PROTECTED_ROUTES,
  ADMIN_ROUTE_PREFIXES,
  isValidRole,
  isValidGrade,
  isValidBoard,
  normalizeGrade,
  validateRedirectTarget,
} from '@alfanumrik/lib/identity/constants';

// ── VALID_ROLES ──────────────────────────────────────────────────

describe('VALID_ROLES', () => {
  it('has exactly student, teacher, parent, institution_admin', () => {
    expect([...VALID_ROLES]).toEqual(['student', 'teacher', 'parent', 'institution_admin']);
  });

  it('has length 4', () => {
    expect(VALID_ROLES).toHaveLength(4);
  });

  it('is a tuple with as const (readonly at compile time)', () => {
    // `as const` is a TypeScript compile-time assertion, not a runtime freeze.
    // We verify the array identity is stable and has the expected contents.
    expect(Array.isArray(VALID_ROLES)).toBe(true);
    expect(VALID_ROLES[0]).toBe('student');
    expect(VALID_ROLES[2]).toBe('parent');
  });
});

// ── VALID_GRADES (P5 compliance) ─────────────────────────────────

describe('VALID_GRADES', () => {
  it('has exactly grades 6 through 12 as strings', () => {
    expect([...VALID_GRADES]).toEqual(['6', '7', '8', '9', '10', '11', '12']);
  });

  it('has length 7', () => {
    expect(VALID_GRADES).toHaveLength(7);
  });

  it('contains only string values (P5: never integers)', () => {
    for (const grade of VALID_GRADES) {
      expect(typeof grade).toBe('string');
    }
  });

  it('does not contain grade 5 or 13', () => {
    expect(VALID_GRADES).not.toContain('5');
    expect(VALID_GRADES).not.toContain('13');
  });
});

// ── VALID_BOARDS ─────────────────────────────────────────────────

describe('VALID_BOARDS', () => {
  it('has exactly CBSE, ICSE, State Board, IB, Other', () => {
    expect([...VALID_BOARDS]).toEqual(['CBSE', 'ICSE', 'State Board', 'IB', 'Other']);
  });

  it('has length 5', () => {
    expect(VALID_BOARDS).toHaveLength(5);
  });
});

// ── getRoleDestination() ─────────────────────────────────────────

describe('getRoleDestination', () => {
  it('returns /dashboard for student', () => {
    expect(getRoleDestination('student')).toBe('/dashboard');
  });

  it('returns /teacher for teacher', () => {
    expect(getRoleDestination('teacher')).toBe('/teacher');
  });

  it('returns /parent for parent', () => {
    expect(getRoleDestination('parent')).toBe('/parent');
  });

  it('returns /parent for guardian (alias)', () => {
    expect(getRoleDestination('guardian')).toBe('/parent');
  });

  it('returns /dashboard for unknown role (safe default)', () => {
    expect(getRoleDestination('superadmin')).toBe('/dashboard');
    expect(getRoleDestination('admin')).toBe('/dashboard');
    expect(getRoleDestination('moderator')).toBe('/dashboard');
  });

  it('returns /dashboard for empty string', () => {
    expect(getRoleDestination('')).toBe('/dashboard');
  });
});

// ── ROLE_DESTINATIONS ────────────────────────────────────────────

describe('ROLE_DESTINATIONS', () => {
  it('maps all four roles to their destinations', () => {
    expect(ROLE_DESTINATIONS).toEqual({
      student: '/dashboard',
      teacher: '/teacher',
      parent: '/parent',
      institution_admin: '/school-admin',
    });
  });
});

// ── ROLE_ALIASES ─────────────────────────────────────────────────

describe('ROLE_ALIASES', () => {
  it('includes guardian as alias for parent', () => {
    expect(ROLE_ALIASES['guardian']).toBe('parent');
  });

  it('maps standard roles to themselves', () => {
    expect(ROLE_ALIASES['student']).toBe('student');
    expect(ROLE_ALIASES['teacher']).toBe('teacher');
    expect(ROLE_ALIASES['parent']).toBe('parent');
  });
});

// ── isValidRole() ────────────────────────────────────────────────

describe('isValidRole', () => {
  it('returns true for student', () => {
    expect(isValidRole('student')).toBe(true);
  });

  it('returns true for teacher', () => {
    expect(isValidRole('teacher')).toBe(true);
  });

  it('returns true for parent', () => {
    expect(isValidRole('parent')).toBe(true);
  });

  it('returns false for guardian (alias, not a valid role itself)', () => {
    expect(isValidRole('guardian')).toBe(false);
  });

  it('returns false for admin', () => {
    expect(isValidRole('admin')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidRole('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidRole(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidRole(undefined)).toBe(false);
  });

  it('returns false for number 42', () => {
    expect(isValidRole(42)).toBe(false);
  });
});

// ── isValidGrade() (P5 compliance) ───────────────────────────────

describe('isValidGrade', () => {
  it('returns true for all valid string grades 6 through 12', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      expect(isValidGrade(g)).toBe(true);
    }
  });

  it('returns false for grade 5 (below range)', () => {
    expect(isValidGrade('5')).toBe(false);
  });

  it('returns false for grade 13 (above range)', () => {
    expect(isValidGrade('13')).toBe(false);
  });

  it('returns false for integer 6 (P5: must be string)', () => {
    expect(isValidGrade(6)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isValidGrade(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidGrade('')).toBe(false);
  });
});

// ── isValidBoard() ───────────────────────────────────────────────

describe('isValidBoard', () => {
  it('returns true for all valid boards', () => {
    for (const board of ['CBSE', 'ICSE', 'State Board', 'IB', 'Other']) {
      expect(isValidBoard(board)).toBe(true);
    }
  });

  it('returns false for invalid board string', () => {
    expect(isValidBoard('invalid')).toBe(false);
    expect(isValidBoard('cbse')).toBe(false); // case-sensitive
  });

  it('returns false for null', () => {
    expect(isValidBoard(null)).toBe(false);
  });
});

// ── normalizeGrade() (P5 compliance) ─────────────────────────────

describe('normalizeGrade', () => {
  it('passes through valid string grade unchanged', () => {
    expect(normalizeGrade('9')).toBe('9');
    expect(normalizeGrade('6')).toBe('6');
    expect(normalizeGrade('12')).toBe('12');
  });

  it('coerces valid number to string', () => {
    expect(normalizeGrade(9)).toBe('9');
    expect(normalizeGrade(6)).toBe('6');
    expect(normalizeGrade(12)).toBe('12');
  });

  it('returns safe default for out-of-range string', () => {
    expect(normalizeGrade('5')).toBe('9');
    expect(normalizeGrade('13')).toBe('9');
    expect(normalizeGrade('0')).toBe('9');
  });

  it('returns safe default for out-of-range number', () => {
    expect(normalizeGrade(5)).toBe('9');
    expect(normalizeGrade(13)).toBe('9');
  });

  it('returns safe default for null', () => {
    expect(normalizeGrade(null)).toBe('9');
  });

  it('returns safe default for undefined', () => {
    expect(normalizeGrade(undefined)).toBe('9');
  });

  it('always returns a string (P5)', () => {
    const result = normalizeGrade(10);
    expect(typeof result).toBe('string');
    expect(result).toBe('10');
  });

  // ── Tier-2 PR D: legacy-prefixed extraction (REG-203, P5) ──────
  // Prior bug: "Grade 11" wrongly defaulted to "9" instead of "11".
  // normalizeGrade now extracts the first 1-2 digit run and keeps it
  // only when it lands in 6..12.
  it('extracts the grade digit from legacy/prefixed strings (truth table)', () => {
    const cases: Array<[unknown, string]> = [
      ['9', '9'],          // bare valid string — idempotent fast path
      ['Grade 11', '11'],  // "Grade N"
      ['grade 6', '6'],    // lowercase prefix
      ['Class 7', '7'],    // "Class N"
      ['Grade-12', '12'],  // hyphen separator
      ['11th', '11'],      // ordinal suffix
      [' 8 ', '8'],        // surrounding whitespace
      [12, '12'],          // in-range number → String
      ['5', '9'],          // extracted digit out of range (low) → default
      ['13', '9'],         // extracted digit out of range (high) → default
      ['0', '9'],          // out of range → default
      [null, '9'],         // null → default
      [undefined, '9'],    // undefined → default
      ['', '9'],           // empty string (no digit) → default
    ];
    for (const [input, expected] of cases) {
      expect(normalizeGrade(input)).toBe(expected);
    }
  });

  it('is idempotent on extracted legacy grades', () => {
    expect(normalizeGrade(normalizeGrade('Grade 11'))).toBe('11');
    expect(normalizeGrade(normalizeGrade('Class 7'))).toBe('7');
  });

  it('never leaks a non-VALID_GRADES value (P5 no integer leak)', () => {
    const inputs: unknown[] = [
      '9', 'Grade 11', 'grade 6', 'Class 7', 'Grade-12', '11th', ' 8 ',
      12, '5', '13', '0', null, undefined, '', 'not a grade', {}, [],
    ];
    for (const input of inputs) {
      const out = normalizeGrade(input);
      expect(typeof out).toBe('string');
      expect(VALID_GRADES).toContain(out as (typeof VALID_GRADES)[number]);
    }
  });
});

// ── validateRedirectTarget() (open redirect prevention) ──────────

describe('validateRedirectTarget', () => {
  it('accepts valid internal path /dashboard', () => {
    expect(validateRedirectTarget('/dashboard')).toBe('/dashboard');
  });

  it('accepts valid nested path /parent/children', () => {
    expect(validateRedirectTarget('/parent/children')).toBe('/parent/children');
  });

  it('accepts path with query parameters', () => {
    expect(validateRedirectTarget('/quiz?subject=math&grade=9')).toBe('/quiz?subject=math&grade=9');
  });

  it('rejects protocol-relative URL //evil.com', () => {
    expect(validateRedirectTarget('//evil.com')).toBe('/dashboard');
  });

  it('rejects javascript: URI', () => {
    expect(validateRedirectTarget('javascript:alert(1)')).toBe('/dashboard');
  });

  it('rejects path with backslash', () => {
    expect(validateRedirectTarget('/foo\\bar')).toBe('/dashboard');
  });

  it('rejects encoded slash /%2f/evil', () => {
    expect(validateRedirectTarget('/%2f/evil')).toBe('/dashboard');
  });

  it('rejects uppercase encoded slash /%2F/evil', () => {
    expect(validateRedirectTarget('/%2F/evil')).toBe('/dashboard');
  });

  it('returns fallback for empty string', () => {
    expect(validateRedirectTarget('')).toBe('/dashboard');
  });

  it('rejects absolute URL https://evil.com', () => {
    expect(validateRedirectTarget('https://evil.com')).toBe('/dashboard');
  });

  it('uses custom fallback when provided', () => {
    expect(validateRedirectTarget('https://evil.com', '/login')).toBe('/login');
  });

  it('rejects data: URI', () => {
    expect(validateRedirectTarget('data:text/html,<h1>evil</h1>')).toBe('/dashboard');
  });
});

// ── ONBOARDING_STEPS ─────────────────────────────────────────────

describe('ONBOARDING_STEPS', () => {
  it('has the correct steps in order', () => {
    expect([...ONBOARDING_STEPS]).toEqual([
      'identity_created',
      'profile_created',
      'role_assigned',
      'completed',
      'failed',
    ]);
  });

  it('has length 5', () => {
    expect(ONBOARDING_STEPS).toHaveLength(5);
  });
});

// ── AUTH_EVENT_TYPES ─────────────────────────────────────────────

describe('AUTH_EVENT_TYPES', () => {
  it('has the correct event types', () => {
    expect([...AUTH_EVENT_TYPES]).toEqual([
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
    ]);
  });

  it('has length 13', () => {
    expect(AUTH_EVENT_TYPES).toHaveLength(13);
  });

  it('includes critical auth events', () => {
    const events = [...AUTH_EVENT_TYPES];
    expect(events).toContain('login_success');
    expect(events).toContain('login_failure');
    expect(events).toContain('logout');
    expect(events).toContain('signup_start');
    expect(events).toContain('signup_complete');
  });
});

// ── PUBLIC_ROUTES ────────────────────────────────────────────────

describe('PUBLIC_ROUTES', () => {
  it('includes critical public paths', () => {
    const routes = [...PUBLIC_ROUTES];
    expect(routes).toContain('/welcome');
    expect(routes).toContain('/login');
    expect(routes).toContain('/auth/callback');
    expect(routes).toContain('/privacy');
    expect(routes).toContain('/terms');
    expect(routes).toContain('/api/v1/health');
  });

  it('includes auth API routes', () => {
    const routes = [...PUBLIC_ROUTES];
    expect(routes).toContain('/api/auth/bootstrap');
    expect(routes).toContain('/api/auth/onboarding-status');
  });
});

// ── MIDDLEWARE_PROTECTED_PREFIXES ─────────────────────────────────

describe('MIDDLEWARE_PROTECTED_PREFIXES', () => {
  it('includes parent routes', () => {
    const prefixes = [...MIDDLEWARE_PROTECTED_PREFIXES];
    expect(prefixes).toContain('/parent/children');
    expect(prefixes).toContain('/parent/reports');
    expect(prefixes).toContain('/parent/profile');
    expect(prefixes).toContain('/parent/support');
  });

  it('includes billing route', () => {
    const prefixes = [...MIDDLEWARE_PROTECTED_PREFIXES];
    expect(prefixes).toContain('/billing');
  });
});

// ── CLIENT_PROTECTED_ROUTES ──────────────────────────────────────

describe('CLIENT_PROTECTED_ROUTES', () => {
  it('includes dashboard and quiz', () => {
    const routes = [...CLIENT_PROTECTED_ROUTES];
    expect(routes).toContain('/dashboard');
    expect(routes).toContain('/quiz');
  });
});

// ── ADMIN_ROUTE_PREFIXES ─────────────────────────────────────────

describe('ADMIN_ROUTE_PREFIXES', () => {
  it('includes super-admin and internal admin paths', () => {
    const prefixes = [...ADMIN_ROUTE_PREFIXES];
    expect(prefixes).toContain('/super-admin');
    expect(prefixes).toContain('/api/super-admin');
  });
});

// ── AuthContext source pin (Tier-2 PR D, REG-203, P5) ────────────
// Pins that AuthContext coerces the loaded grade through normalizeGrade
// at the student-profile read paths, so the UI can never surface a raw
// legacy value like "Grade 9" or mis-grade a grade-N student.

describe('AuthContext applies normalizeGrade at student-profile read paths', () => {
  // Strip line + block comments so we only assert on live code, not docs.
  function readSourceStripped(relativePath: string): string {
    const candidates = [
      join(process.cwd(), relativePath),
      join(process.cwd(), '..', relativePath),
    ];
    let source = '';
    for (const p of candidates) {
      try {
        source = readFileSync(p, 'utf8');
        break;
      } catch {
        /* try next candidate */
      }
    }
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (not URLs)
  }

  const src = readSourceStripped('src/lib/AuthContext.tsx');

  it('reads the AuthContext source (non-vacuous)', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('setStudent');
  });

  it('applies grade: normalizeGrade( on the setStudent object-spread', () => {
    const occurrences = (src.match(/grade:\s*normalizeGrade\(\s*studentData\.grade\s*\)/g) ?? []).length;
    // Two non-metadata profile-load paths (the metadata path already had it,
    // for 3 total) — require at least the two added by this PR.
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('never assigns a raw studentData.grade without coercion on a setStudent spread', () => {
    // Guard against regression: a `...studentData` spread that forgets to
    // override grade. Every setStudent({ ...studentData ... }) must carry
    // the normalizeGrade override.
    const spreads = src.match(/setStudent\(\s*\{\s*\.\.\.studentData[\s\S]*?\}\s*as Student\)/g) ?? [];
    expect(spreads.length).toBeGreaterThanOrEqual(2);
    for (const spread of spreads) {
      expect(spread).toMatch(/grade:\s*normalizeGrade\(/);
    }
  });
});
