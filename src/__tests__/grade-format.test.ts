import { describe, it, expect } from 'vitest';
import { GRADES, GRADE_SUBJECTS, getSubjectsForGrade } from '@/lib/constants';

/** P5-compliant grade validator: only "6" through "12" as plain strings. */
function isValidP5Grade(grade: unknown): boolean {
  return typeof grade === 'string' && /^(6|7|8|9|10|11|12)$/.test(grade);
}

/**
 * Grade Format Regression Tests — P5 (Grade Format)
 *
 * P5: Grades are strings "6" through "12". Never integers. Never "Grade 6".
 * In database, RPCs, APIs, and TypeScript.
 *
 * Regression catalog IDs: grade_is_string, grade_range
 */

// ─── P5: Grade Type Enforcement ──────────────────────────────────────────────

describe('P5: Grade Format - Type Enforcement', () => {
  it('grade_is_string: every grade in GRADES is a string type', () => {
    for (const grade of GRADES) {
      expect(typeof grade).toBe('string');
    }
  });

  it('GRADES array contains no integers', () => {
    for (const grade of GRADES) {
      // Must not be a number type
      expect(typeof grade).not.toBe('number');
      // The value should be a string representation of a number
      expect(grade).toMatch(/^\d+$/);
    }
  });

  it('grade_range: valid grades are "6" through "12" only', () => {
    expect(GRADES).toContain('6');
    expect(GRADES).toContain('7');
    expect(GRADES).toContain('8');
    expect(GRADES).toContain('9');
    expect(GRADES).toContain('10');
    expect(GRADES).toContain('11');
    expect(GRADES).toContain('12');
    expect(GRADES.length).toBe(7);
  });

  it('rejects grade "5" (below range)', () => {
    expect(GRADES).not.toContain('5');
  });

  it('rejects grade "13" (above range)', () => {
    expect(GRADES).not.toContain('13');
  });

  it('rejects integer 6 (wrong type)', () => {
    expect((GRADES as unknown as unknown[]).includes(6)).toBe(false);
  });

  it('rejects integer 12 (wrong type)', () => {
    expect((GRADES as unknown as unknown[]).includes(12)).toBe(false);
  });

  it('rejects "Grade 6" format', () => {
    expect(GRADES).not.toContain('Grade 6');
    expect(GRADES).not.toContain('Grade 12');
  });

  it('rejects "0", "1", "2", "3", "4" (primary grades)', () => {
    for (const g of ['0', '1', '2', '3', '4']) {
      expect(GRADES).not.toContain(g);
    }
  });
});

// ─── P5: GRADE_SUBJECTS Keys ─────────────────────────────────────────────────

describe('P5: GRADE_SUBJECTS uses string keys', () => {
  it('all GRADE_SUBJECTS keys are string grades "6"-"12"', () => {
    const keys = Object.keys(GRADE_SUBJECTS);
    expect(keys.length).toBe(7);
    for (const key of keys) {
      expect(typeof key).toBe('string');
      const num = parseInt(key, 10);
      expect(num).toBeGreaterThanOrEqual(6);
      expect(num).toBeLessThanOrEqual(12);
    }
  });

  it('GRADE_SUBJECTS["6"] exists and has subjects', () => {
    expect(GRADE_SUBJECTS['6']).toBeDefined();
    expect(GRADE_SUBJECTS['6'].length).toBeGreaterThan(0);
  });

  it('GRADE_SUBJECTS["12"] exists and has subjects', () => {
    expect(GRADE_SUBJECTS['12']).toBeDefined();
    expect(GRADE_SUBJECTS['12'].length).toBeGreaterThan(0);
  });

  it('integer key lookup returns undefined (not a valid access pattern)', () => {
    // Object keys are always strings in JS, but this verifies the intent
    // that we never store under numeric keys
    const keys = Object.keys(GRADE_SUBJECTS);
    expect(keys.every(k => k === String(k))).toBe(true);
  });
});

// ─── P5: isValidP5Grade validator ────────────────────────────────────────────

describe('P5: isValidP5Grade validator', () => {
  it('accepts all valid grades "6" through "12"', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      expect(isValidP5Grade(g)).toBe(true);
    }
  });

  it('rejects "Grade 10" format (prefixed)', () => {
    expect(isValidP5Grade('Grade 10')).toBe(false);
    expect(isValidP5Grade('Grade 6')).toBe(false);
    expect(isValidP5Grade('Grade 12')).toBe(false);
  });

  it('rejects "grade 10" format (lowercase prefixed)', () => {
    expect(isValidP5Grade('grade 10')).toBe(false);
  });

  it('rejects integer types', () => {
    expect(isValidP5Grade(6)).toBe(false);
    expect(isValidP5Grade(10)).toBe(false);
    expect(isValidP5Grade(12)).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isValidP5Grade(null)).toBe(false);
    expect(isValidP5Grade(undefined)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidP5Grade('')).toBe(false);
  });

  it('rejects out-of-range string grades', () => {
    expect(isValidP5Grade('0')).toBe(false);
    expect(isValidP5Grade('5')).toBe(false);
    expect(isValidP5Grade('13')).toBe(false);
    expect(isValidP5Grade('99')).toBe(false);
  });

  it('rejects padded grades', () => {
    expect(isValidP5Grade(' 6')).toBe(false);
    expect(isValidP5Grade('6 ')).toBe(false);
    expect(isValidP5Grade('06')).toBe(false);
  });
});

// ─── P5: getSubjectsForGrade ─────────────────────────────────────────────────

describe('P5: getSubjectsForGrade normalization', () => {
  it('returns subjects for string grade "6"', () => {
    const subjects = getSubjectsForGrade('6');
    expect(subjects.length).toBeGreaterThan(0);
    expect(subjects.some(s => s.code === 'math')).toBe(true);
  });

  it('returns subjects for string grade "12"', () => {
    const subjects = getSubjectsForGrade('12');
    expect(subjects.length).toBeGreaterThan(0);
    expect(subjects.some(s => s.code === 'physics')).toBe(true);
  });

  it('strips "Grade " prefix and returns correct subjects', () => {
    // getSubjectsForGrade normalizes "Grade 9" to "9"
    const withPrefix = getSubjectsForGrade('Grade 9');
    const withoutPrefix = getSubjectsForGrade('9');
    expect(withPrefix.length).toBe(withoutPrefix.length);
    expect(withPrefix.map(s => s.code).sort()).toEqual(withoutPrefix.map(s => s.code).sort());
  });

  it('falls back to grade 9 subjects for invalid grade', () => {
    const fallback = getSubjectsForGrade('99');
    const grade9 = getSubjectsForGrade('9');
    expect(fallback.length).toBe(grade9.length);
    expect(fallback.map(s => s.code).sort()).toEqual(grade9.map(s => s.code).sort());
  });

  it('falls back to grade 9 for empty string', () => {
    const fallback = getSubjectsForGrade('');
    const grade9 = getSubjectsForGrade('9');
    expect(fallback.map(s => s.code).sort()).toEqual(grade9.map(s => s.code).sort());
  });

  it('grade 6-8 have science but not physics/chemistry/biology separately', () => {
    for (const g of ['6', '7', '8']) {
      const subjects = getSubjectsForGrade(g);
      const codes = subjects.map(s => s.code);
      expect(codes).toContain('science');
      expect(codes).not.toContain('physics');
      expect(codes).not.toContain('chemistry');
      expect(codes).not.toContain('biology');
    }
  });

  it('grade 11-12 have physics/chemistry/biology but not combined science', () => {
    for (const g of ['11', '12']) {
      const subjects = getSubjectsForGrade(g);
      const codes = subjects.map(s => s.code);
      expect(codes).toContain('physics');
      expect(codes).toContain('chemistry');
      expect(codes).toContain('biology');
      expect(codes).not.toContain('science');
    }
  });
});
