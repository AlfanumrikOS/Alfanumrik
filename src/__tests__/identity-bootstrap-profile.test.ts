/**
 * Tests for src/lib/identity/bootstrap-profile.ts (R2, 2026-06-10 audit)
 *
 * The module is the CANONICAL user_metadata → bootstrap_user_profile
 * parameter derivation, replacing 4+ hand-rolled copies across the auth
 * module (auth/callback, auth/confirm, api/auth/bootstrap, AuthContext).
 *
 * Contracts pinned here:
 *   - roleFromMetadata: guardian→parent alias, valid roles pass through,
 *     garbage/missing → 'student' (P15: signup must never break).
 *   - profileParamsFromMetadata: teacher subjects_taught / grades_taught
 *     survive BOTH the JSON-string form (AuthScreen stores
 *     JSON.stringify(...)) and the real-array form (GoTrue round-trip).
 *     The pre-R2 bug dropped these as null in both server confirmation
 *     routes.
 *   - Grade default unified to '9' via normalizeGrade (P5: bare strings
 *     '6'..'12', never integers).
 *   - link_code passthrough (trimmed, blank → null) — feeds the M5
 *     guardian-link wiring in bootstrap_user_profile.
 *
 * Product invariants tested: P5 (grade format), P15 (onboarding integrity).
 */

import { describe, it, expect } from 'vitest';
import {
  roleFromMetadata,
  parseStringArray,
  profileParamsFromMetadata,
} from '@/lib/identity/bootstrap-profile';

// ── roleFromMetadata ─────────────────────────────────────────────

describe('roleFromMetadata', () => {
  it('maps student to student', () => {
    expect(roleFromMetadata({ role: 'student' })).toBe('student');
  });

  it('maps teacher to teacher', () => {
    expect(roleFromMetadata({ role: 'teacher' })).toBe('teacher');
  });

  it('maps parent to parent', () => {
    expect(roleFromMetadata({ role: 'parent' })).toBe('parent');
  });

  it('maps guardian to parent (DB table is guardians, role is parent)', () => {
    expect(roleFromMetadata({ role: 'guardian' })).toBe('parent');
  });

  it('maps institution_admin to institution_admin', () => {
    expect(roleFromMetadata({ role: 'institution_admin' })).toBe('institution_admin');
  });

  it('defaults garbage role to student (P15 safe default)', () => {
    expect(roleFromMetadata({ role: 'admin' })).toBe('student');
    expect(roleFromMetadata({ role: 'super_admin' })).toBe('student');
    expect(roleFromMetadata({ role: 'DROP TABLE students' })).toBe('student');
  });

  it('defaults empty-string role to student', () => {
    expect(roleFromMetadata({ role: '' })).toBe('student');
  });

  it('defaults missing role key to student', () => {
    expect(roleFromMetadata({})).toBe('student');
  });

  it('defaults null/undefined metadata to student', () => {
    expect(roleFromMetadata(null)).toBe('student');
    expect(roleFromMetadata(undefined)).toBe('student');
  });

  it('defaults non-string role to student', () => {
    expect(roleFromMetadata({ role: 42 })).toBe('student');
    expect(roleFromMetadata({ role: { nested: 'teacher' } })).toBe('student');
  });

  it('trims whitespace before matching', () => {
    expect(roleFromMetadata({ role: '  teacher  ' })).toBe('teacher');
  });
});

// ── parseStringArray ─────────────────────────────────────────────

describe('parseStringArray', () => {
  it('passes real string arrays through', () => {
    expect(parseStringArray(['math', 'science'])).toEqual(['math', 'science']);
  });

  it('parses the JSON-string form AuthScreen stores', () => {
    expect(parseStringArray('["math","science"]')).toEqual(['math', 'science']);
  });

  it('coerces numeric entries to strings (covers [6, 7] payloads)', () => {
    expect(parseStringArray([6, 7])).toEqual(['6', '7']);
    expect(parseStringArray('[9, 10]')).toEqual(['9', '10']);
  });

  it('drops empty/whitespace entries', () => {
    expect(parseStringArray(['math', '', '  '])).toEqual(['math']);
  });

  it('returns null for unparseable strings', () => {
    expect(parseStringArray('not json')).toBeNull();
  });

  it('returns null for blank string / absent value', () => {
    expect(parseStringArray('')).toBeNull();
    expect(parseStringArray('   ')).toBeNull();
    expect(parseStringArray(undefined)).toBeNull();
    expect(parseStringArray(null)).toBeNull();
  });

  it('returns null when JSON parses to a non-array', () => {
    expect(parseStringArray('{"a":1}')).toBeNull();
    expect(parseStringArray('"math"')).toBeNull();
  });

  it('returns null when everything filters out', () => {
    expect(parseStringArray([null, {}, ''])).toBeNull();
    expect(parseStringArray([])).toBeNull();
  });
});

// ── profileParamsFromMetadata ────────────────────────────────────

const baseUser = (meta: Record<string, unknown> | null | undefined, email = 'user@example.com') => ({
  id: 'auth-uuid-1',
  email,
  user_metadata: meta,
});

describe('profileParamsFromMetadata — teacher fields (R2 regression)', () => {
  it('parses subjects_taught and grades_taught from JSON-string form (AuthScreen B4)', () => {
    const params = profileParamsFromMetadata(
      baseUser({
        role: 'teacher',
        name: 'Ms. Priya Verma',
        subjects_taught: '["math","science"]',
        grades_taught: '["9","10"]',
      })
    );
    expect(params.role).toBe('teacher');
    // The pre-R2 bug: both server confirmation routes passed these as null.
    expect(params.subjects).toEqual(['math', 'science']);
    expect(params.grades_taught).toEqual(['9', '10']);
  });

  it('parses subjects_taught and grades_taught from real-array form', () => {
    const params = profileParamsFromMetadata(
      baseUser({
        role: 'teacher',
        subjects_taught: ['math'],
        grades_taught: ['9', '10'],
      })
    );
    expect(params.subjects).toEqual(['math']);
    expect(params.grades_taught).toEqual(['9', '10']);
  });

  it('P5-filters grades_taught: invalid entries dropped, not failing bootstrap', () => {
    const params = profileParamsFromMetadata(
      baseUser({
        role: 'teacher',
        grades_taught: ['9', '13', 'banana'],
      })
    );
    expect(params.grades_taught).toEqual(['9']);
  });

  it('grades_taught all-invalid collapses to null (not empty array)', () => {
    const params = profileParamsFromMetadata(
      baseUser({ role: 'teacher', grades_taught: ['5', '13'] })
    );
    expect(params.grades_taught).toBeNull();
  });

  it('coerces numeric grades_taught to P5 strings', () => {
    const params = profileParamsFromMetadata(
      baseUser({ role: 'teacher', grades_taught: [9, 10] })
    );
    expect(params.grades_taught).toEqual(['9', '10']);
    for (const g of params.grades_taught!) {
      expect(typeof g).toBe('string');
    }
  });

  it('unparseable subjects_taught degrades to null, never throws (P15)', () => {
    const params = profileParamsFromMetadata(
      baseUser({ role: 'teacher', subjects_taught: 'not-json{{{' })
    );
    expect(params.subjects).toBeNull();
  });
});

describe('profileParamsFromMetadata — grade default (P5)', () => {
  it("defaults grade to '9' when metadata grade is missing", () => {
    const params = profileParamsFromMetadata(baseUser({ role: 'student' }));
    expect(params.grade).toBe('9');
    expect(typeof params.grade).toBe('string');
  });

  it("defaults grade to '9' for invalid metadata grade", () => {
    expect(profileParamsFromMetadata(baseUser({ role: 'student', grade: '5' })).grade).toBe('9');
    expect(profileParamsFromMetadata(baseUser({ role: 'student', grade: '13' })).grade).toBe('9');
    expect(profileParamsFromMetadata(baseUser({ role: 'student', grade: 'abc' })).grade).toBe('9');
  });

  it('accepts every bare-string grade "6" through "12" unchanged (P5)', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      const params = profileParamsFromMetadata(baseUser({ role: 'student', grade: g }));
      expect(params.grade).toBe(g);
      expect(typeof params.grade).toBe('string');
    }
  });

  it('coerces in-range numeric grade to string via normalizeGrade (P5)', () => {
    const params = profileParamsFromMetadata(baseUser({ role: 'student', grade: 10 }));
    expect(params.grade).toBe('10');
    expect(typeof params.grade).toBe('string');
  });
});

describe('profileParamsFromMetadata — link_code passthrough (M5)', () => {
  it('passes a trimmed link_code through', () => {
    const params = profileParamsFromMetadata(
      baseUser({ role: 'parent', link_code: '  AB12-CD34  ' })
    );
    expect(params.link_code).toBe('AB12-CD34');
  });

  it('blank link_code becomes null', () => {
    expect(profileParamsFromMetadata(baseUser({ role: 'parent', link_code: '   ' })).link_code).toBeNull();
    expect(profileParamsFromMetadata(baseUser({ role: 'parent', link_code: '' })).link_code).toBeNull();
  });

  it('missing / non-string link_code becomes null', () => {
    expect(profileParamsFromMetadata(baseUser({ role: 'parent' })).link_code).toBeNull();
    expect(profileParamsFromMetadata(baseUser({ role: 'parent', link_code: 1234 })).link_code).toBeNull();
  });
});

describe('profileParamsFromMetadata — defaults and fallbacks', () => {
  it('guardian metadata role maps to parent in the derived params', () => {
    expect(profileParamsFromMetadata(baseUser({ role: 'guardian' })).role).toBe('parent');
  });

  it('board defaults to CBSE when missing or blank', () => {
    expect(profileParamsFromMetadata(baseUser({ role: 'student' })).board).toBe('CBSE');
    expect(profileParamsFromMetadata(baseUser({ role: 'student', board: '  ' })).board).toBe('CBSE');
  });

  it('board passes through when present', () => {
    expect(profileParamsFromMetadata(baseUser({ role: 'student', board: 'ICSE' })).board).toBe('ICSE');
  });

  it('name falls back to email local part when metadata name missing', () => {
    const params = profileParamsFromMetadata(baseUser({ role: 'student' }, 'aarav.sharma@example.com'));
    expect(params.name).toBe('aarav.sharma');
  });

  it('name is empty string when both metadata name and email are missing', () => {
    const params = profileParamsFromMetadata({ id: 'x', email: null, user_metadata: {} });
    expect(params.name).toBe('');
  });

  it('school_city prefers meta.city (AuthScreen form) over school_city fallback', () => {
    const both = profileParamsFromMetadata(
      baseUser({ role: 'institution_admin', city: 'Jaipur', school_city: 'Delhi' })
    );
    expect(both.school_city).toBe('Jaipur');

    const fallbackOnly = profileParamsFromMetadata(
      baseUser({ role: 'institution_admin', school_city: 'Delhi' })
    );
    expect(fallbackOnly.school_city).toBe('Delhi');
  });

  it('school_state prefers meta.state over school_state fallback', () => {
    const both = profileParamsFromMetadata(
      baseUser({ role: 'institution_admin', state: 'Rajasthan', school_state: 'Delhi' })
    );
    expect(both.school_state).toBe('Rajasthan');
  });

  it('never throws on null user_metadata (P15)', () => {
    const params = profileParamsFromMetadata({ id: 'x', email: 'a@b.co', user_metadata: null });
    expect(params.role).toBe('student');
    expect(params.grade).toBe('9');
    expect(params.subjects).toBeNull();
    expect(params.grades_taught).toBeNull();
    expect(params.link_code).toBeNull();
  });
});
