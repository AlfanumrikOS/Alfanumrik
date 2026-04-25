/**
 * Tenant domain — typed read API contract tests.
 *
 * These cover input validation (no env required) and — when integration
 * env vars are present — the happy path round-trip for each new read
 * function.
 *
 * Scope limited to functions added in Phase 0b:
 *   - getSchoolById
 *   - getSchoolByCode
 *   - listClassesBySchool
 *   - getClassById
 *   - listStudentsInClass
 *   - listTeachersInClass
 *   - isTeacherAssignedToClass
 *
 * See docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md (Phase 0b).
 */

import { describe, it, expect } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';
import {
  getSchoolById,
  getSchoolByCode,
  listClassesBySchool,
  getClassById,
  listStudentsInClass,
  listTeachersInClass,
  isTeacherAssignedToClass,
} from '@/lib/domains/tenant';

describe('tenant domain — input validation', () => {
  it('getSchoolById rejects empty schoolId with INVALID_INPUT', async () => {
    const r = await getSchoolById('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getSchoolByCode rejects empty code with INVALID_INPUT', async () => {
    const r = await getSchoolByCode('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listClassesBySchool rejects empty schoolId with INVALID_INPUT', async () => {
    const r = await listClassesBySchool('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getClassById rejects empty classId with INVALID_INPUT', async () => {
    const r = await getClassById('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listStudentsInClass rejects empty classId with INVALID_INPUT', async () => {
    const r = await listStudentsInClass('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listTeachersInClass rejects empty classId with INVALID_INPUT', async () => {
    const r = await listTeachersInClass('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('isTeacherAssignedToClass rejects empty classId with INVALID_INPUT', async () => {
    const r = await isTeacherAssignedToClass('', '00000000-0000-0000-0000-000000000001');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('isTeacherAssignedToClass rejects empty teacherId with INVALID_INPUT', async () => {
    const r = await isTeacherAssignedToClass('00000000-0000-0000-0000-000000000001', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Integration happy path (skipped without env) ──────────────────────────────
//
// Uses a deterministic fake UUID that is extremely unlikely to resolve to a
// real row. The contract under test is that the function returns ok: true
// with data === null (or an empty array for list endpoints), so even in an
// empty DB the test is meaningful.

const FAKE_UUID = '00000000-0000-0000-0000-00000000beef';
const OTHER_FAKE_UUID = '00000000-0000-0000-0000-00000000feed';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('tenant domain — integration (null-path happy case)', () => {
  it('getSchoolById returns ok with null for unknown id', async () => {
    const r = await getSchoolById(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getSchoolByCode returns ok with null for unknown code', async () => {
    const r = await getSchoolByCode('NON_EXISTENT_CODE_XYZ_42');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('listClassesBySchool returns ok with an array for unknown school', async () => {
    const r = await listClassesBySchool(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listClassesBySchool honors activeOnly filter (no throw on unknown school)', async () => {
    const r = await listClassesBySchool(FAKE_UUID, { activeOnly: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('getClassById returns ok with null for unknown id', async () => {
    const r = await getClassById(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getClassById honors schoolId scoping (no throw on unknown school)', async () => {
    const r = await getClassById(FAKE_UUID, { schoolId: OTHER_FAKE_UUID });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('listStudentsInClass returns ok with an array for unknown class', async () => {
    const r = await listStudentsInClass(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listTeachersInClass returns ok with an array for unknown class', async () => {
    const r = await listTeachersInClass(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('isTeacherAssignedToClass returns ok with false for unknown pair', async () => {
    const r = await isTeacherAssignedToClass(FAKE_UUID, OTHER_FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBe(false);
  });
});
