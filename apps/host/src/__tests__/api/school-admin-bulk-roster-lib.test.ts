/**
 * src/lib/school-admin/bulk-roster.ts — Track A.4 pure-helper contract tests
 *
 * Pins the validators, classKey() idempotency key, class-ref resolution, and the
 * probeSeatCapacity() RPC translation (the ONLY caller of assert_seat_capacity).
 * These are the building blocks the four bulk routes rely on; testing them here
 * keeps the route tests focused on orchestration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ rpc: (...a: unknown[]) => mockRpc(...a) }),
}));

import {
  VALID_GRADES,
  TEMPLATE_SECTIONS,
  MAX_BULK_ROWS,
  MAX_BULK_CLASSES,
  isValidGrade,
  isValidEmail,
  classKey,
  validateStudentRow,
  validateTeacherRow,
  validateClassRow,
  resolveClassId,
  probeSeatCapacity,
  atomicEnrollStudent,
  atomicRegisterTeacher,
} from '@alfanumrik/lib/school-admin/bulk-roster';

const SCHOOL_ID = '00000000-0000-0000-0000-0000000000aa';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bulk-roster constants & caps', () => {
  it('grades are the seven CBSE STRINGS "6".."12" (P5 — never integers)', () => {
    expect(VALID_GRADES).toEqual(['6', '7', '8', '9', '10', '11', '12']);
    VALID_GRADES.forEach((g) => expect(typeof g).toBe('string'));
  });

  it('template sections are A–D', () => {
    expect(TEMPLATE_SECTIONS).toEqual(['A', 'B', 'C', 'D']);
  });

  it('caps are MAX_BULK_ROWS=500 and MAX_BULK_CLASSES=200', () => {
    expect(MAX_BULK_ROWS).toBe(500);
    expect(MAX_BULK_CLASSES).toBe(200);
  });
});

describe('isValidGrade — P5 grade-string contract', () => {
  it('accepts every grade string "6".."12"', () => {
    ['6', '7', '8', '9', '10', '11', '12'].forEach((g) =>
      expect(isValidGrade(g)).toBe(true),
    );
  });

  it('rejects the INTEGER 6 (must be the string "6")', () => {
    expect(isValidGrade(6 as unknown)).toBe(false);
    expect(isValidGrade(12 as unknown)).toBe(false);
  });

  it('rejects out-of-range grade strings "5" and "13"', () => {
    expect(isValidGrade('5')).toBe(false);
    expect(isValidGrade('13')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts a well-formed address', () => {
    expect(isValidEmail('anika@school.edu')).toBe(true);
  });
  it('rejects malformed addresses', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(123 as unknown)).toBe(false);
  });
});

describe('classKey — idempotency key', () => {
  it('is stable and case-insensitive on section', () => {
    const a = classKey({ grade: '6', section: 'a', academic_year: '2026-27' });
    const b = classKey({ grade: '6', section: 'A', academic_year: '2026-27' });
    expect(a).toBe(b);
    expect(a).toBe('6::A::2026-27');
  });
  it('differs across grade / section / academic year', () => {
    const base = classKey({ grade: '6', section: 'A', academic_year: '2026-27' });
    expect(classKey({ grade: '7', section: 'A', academic_year: '2026-27' })).not.toBe(base);
    expect(classKey({ grade: '6', section: 'B', academic_year: '2026-27' })).not.toBe(base);
    expect(classKey({ grade: '6', section: 'A', academic_year: '2027-28' })).not.toBe(base);
  });
});

describe('validateStudentRow', () => {
  it('normalizes a valid row (email lowercased, grade string)', () => {
    const r = validateStudentRow({ name: 'Anika', email: 'Anika@School.EDU', grade: '8', section: 'b' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe('anika@school.edu');
      expect(r.value.grade).toBe('8');
      expect(r.value.class_ref).toBe('b');
    }
  });
  it('rejects a short name → invalid_name', () => {
    const r = validateStudentRow({ name: 'A', email: 'a@b.com', grade: '8' });
    expect(r).toEqual({ ok: false, code: 'invalid_name' });
  });
  it('rejects a malformed email → invalid_email', () => {
    const r = validateStudentRow({ name: 'Anika', email: 'bad', grade: '8' });
    expect(r).toEqual({ ok: false, code: 'invalid_email' });
  });
  it('rejects the integer grade 8 → invalid_grade is NOT raised (coerced to "8")', () => {
    // String(8) === "8" is a valid grade; the route accepts CSV numeric cells.
    const r = validateStudentRow({ name: 'Anika', email: 'a@b.com', grade: 8 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.grade).toBe('8');
  });
  it('rejects out-of-range grade "13" → invalid_grade', () => {
    const r = validateStudentRow({ name: 'Anika', email: 'a@b.com', grade: '13' });
    expect(r).toEqual({ ok: false, code: 'invalid_grade' });
  });
});

describe('validateTeacherRow', () => {
  it('normalizes subjects + grades', () => {
    const r = validateTeacherRow({
      name: 'Mr Rao',
      email: 'rao@school.edu',
      subjects_taught: ['Math', ' ', 'Science'],
      grades_taught: ['6', '7'],
      class_refs: ['A', 'B'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subjects_taught).toEqual(['Math', 'Science']);
      expect(r.value.grades_taught).toEqual(['6', '7']);
      expect(r.value.class_refs).toEqual(['A', 'B']);
    }
  });
  it('rejects an invalid grade in grades_taught → invalid_grade', () => {
    const r = validateTeacherRow({ name: 'Mr Rao', email: 'rao@school.edu', grades_taught: ['13'] });
    expect(r).toEqual({ ok: false, code: 'invalid_grade' });
  });
});

describe('validateClassRow', () => {
  it('uppercases section and defaults name + academic_year', () => {
    const r = validateClassRow({ grade: '6', section: 'a' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.section).toBe('A');
      expect(r.value.grade).toBe('6');
      expect(r.value.academic_year).toBe('2026-27');
      expect(r.value.name).toBe('Grade 6 - A');
    }
  });
  it('rejects an invalid grade → invalid_grade', () => {
    expect(validateClassRow({ grade: '5', section: 'A' })).toEqual({ ok: false, code: 'invalid_grade' });
  });
  it('rejects a missing section → invalid_section', () => {
    expect(validateClassRow({ grade: '6', section: '' })).toEqual({ ok: false, code: 'invalid_section' });
  });
});

describe('resolveClassId', () => {
  const index = {
    bySection: new Map([['A', 'class-a'], ['B', 'class-b']]),
    byCode: new Map([['6-A-2026-27', 'class-a']]),
  };
  it('resolves by class_code first', () => {
    expect(resolveClassId('6-A-2026-27', index)).toBe('class-a');
  });
  it('resolves by section name case-insensitively', () => {
    expect(resolveClassId('b', index)).toBe('class-b');
  });
  it('returns null for an unknown ref', () => {
    expect(resolveClassId('Z', index)).toBeNull();
  });
  it('returns null for a null ref', () => {
    expect(resolveClassId(null, index)).toBeNull();
  });
});

describe('probeSeatCapacity — sole caller of assert_seat_capacity RPC', () => {
  it('returns ok snapshot with clamped remaining on success', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, ceiling: 100, used: 70, remaining: 30 }, error: null });
    const p = await probeSeatCapacity(SCHOOL_ID);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.snapshot).toEqual({ ceiling: 100, used: 70, remaining: 30 });
    }
    expect(mockRpc).toHaveBeenCalledWith('assert_seat_capacity', { p_school_id: SCHOOL_ID });
  });

  it('clamps a negative remaining to 0', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, ceiling: 100, used: 110, remaining: -10 }, error: null });
    const p = await probeSeatCapacity(SCHOOL_ID);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.snapshot.remaining).toBe(0);
  });

  it('maps P0001 seat_capacity_exceeded → at_ceiling (remaining 0)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'seat_capacity_exceeded: school at ceiling' },
    });
    const p = await probeSeatCapacity(SCHOOL_ID);
    expect(p).toMatchObject({ ok: false, reason: 'at_ceiling' });
  });

  it('maps any NON-P0001 error → unavailable (so the route can 503)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection reset' } });
    const p = await probeSeatCapacity(SCHOOL_ID);
    expect(p).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('does NOT leak the raw SQL error message in the unavailable result', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    const p = await probeSeatCapacity(SCHOOL_ID);
    expect(JSON.stringify(p)).not.toMatch(/function does not exist/);
  });
});

const STUDENT_ID = '00000000-0000-0000-0000-0000000000bb';
const CLASS_ID = '00000000-0000-0000-0000-0000000000cc';

describe('atomicEnrollStudent — sole caller of enroll_student_with_seat_check (S1)', () => {
  it('calls the atomic RPC with the school-scoped uuid args + roll number', async () => {
    mockRpc.mockResolvedValue({ data: { granted: true, status: 'created' }, error: null });
    await atomicEnrollStudent(SCHOOL_ID, STUDENT_ID, CLASS_ID, '42');
    expect(mockRpc).toHaveBeenCalledWith('enroll_student_with_seat_check', {
      p_school_id: SCHOOL_ID,
      p_student_id: STUDENT_ID,
      p_class_id: CLASS_ID,
      p_roll_number: '42',
    });
  });

  it('maps a granted=true verdict → { ok:true, granted:true, status }', async () => {
    mockRpc.mockResolvedValue({ data: { granted: true, status: 'created' }, error: null });
    const r = await atomicEnrollStudent(SCHOOL_ID, STUDENT_ID, CLASS_ID, null);
    expect(r).toEqual({ ok: true, granted: true, status: 'created' });
  });

  it('maps an idempotent already_active grant through verbatim', async () => {
    mockRpc.mockResolvedValue({ data: { granted: true, status: 'already_active' }, error: null });
    const r = await atomicEnrollStudent(SCHOOL_ID, STUDENT_ID, CLASS_ID, null);
    expect(r).toEqual({ ok: true, granted: true, status: 'already_active' });
  });

  it('maps a granted=false (ceiling reached under the lock) → blocked', async () => {
    mockRpc.mockResolvedValue({ data: { granted: false, status: 'blocked', used: 5, ceiling: 5 }, error: null });
    const r = await atomicEnrollStudent(SCHOOL_ID, STUDENT_ID, CLASS_ID, null);
    expect(r).toEqual({ ok: true, granted: false, status: 'blocked' });
  });

  it('maps any RPC error → { ok:false } and leaks NO SQL', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'class does not belong to school' } });
    const r = await atomicEnrollStudent(SCHOOL_ID, STUDENT_ID, CLASS_ID, null);
    expect(r).toEqual({ ok: false });
    expect(JSON.stringify(r)).not.toMatch(/class does not belong to school|42501/);
  });

  it('treats a missing granted field as blocked (never silently grants)', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    const r = await atomicEnrollStudent(SCHOOL_ID, STUDENT_ID, CLASS_ID, null);
    expect(r).toEqual({ ok: true, granted: false, status: 'blocked' });
  });
});

describe('atomicRegisterTeacher — sole caller of register_teacher_with_seat_check (S1)', () => {
  it('calls the atomic RPC with the school + teacher payload', async () => {
    mockRpc.mockResolvedValue({ data: { granted: true, status: 'created', teacher_id: 'tid-1' }, error: null });
    await atomicRegisterTeacher(SCHOOL_ID, 'Ms X', 'x@s.edu', ['Math'], ['7']);
    expect(mockRpc).toHaveBeenCalledWith('register_teacher_with_seat_check', {
      p_school_id: SCHOOL_ID,
      p_name: 'Ms X',
      p_email: 'x@s.edu',
      p_subjects: ['Math'],
      p_grades: ['7'],
    });
  });

  it('maps a granted=true create → { ok:true, granted:true, status, teacherId }', async () => {
    mockRpc.mockResolvedValue({ data: { granted: true, status: 'created', teacher_id: 'tid-1' }, error: null });
    const r = await atomicRegisterTeacher(SCHOOL_ID, 'Ms X', 'x@s.edu', [], []);
    expect(r).toEqual({ ok: true, granted: true, status: 'created', teacherId: 'tid-1' });
  });

  it('maps an idempotent already_exists grant (no new seat) with the existing id', async () => {
    mockRpc.mockResolvedValue({ data: { granted: true, status: 'already_exists', teacher_id: 'tid-existing' }, error: null });
    const r = await atomicRegisterTeacher(SCHOOL_ID, 'Ms X', 'x@s.edu', [], []);
    expect(r).toEqual({ ok: true, granted: true, status: 'already_exists', teacherId: 'tid-existing' });
  });

  it('maps a granted=false (ceiling reached under the lock) → blocked', async () => {
    mockRpc.mockResolvedValue({ data: { granted: false, status: 'blocked', used: 5, ceiling: 5 }, error: null });
    const r = await atomicRegisterTeacher(SCHOOL_ID, 'Ms X', 'x@s.edu', [], []);
    expect(r).toEqual({ ok: true, granted: false, status: 'blocked' });
  });

  it('maps any RPC error → { ok:false } and leaks NO SQL', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22004', message: 'school_id and email are required' } });
    const r = await atomicRegisterTeacher(SCHOOL_ID, 'Ms X', 'x@s.edu', [], []);
    expect(r).toEqual({ ok: false });
    expect(JSON.stringify(r)).not.toMatch(/required|22004/);
  });
});
