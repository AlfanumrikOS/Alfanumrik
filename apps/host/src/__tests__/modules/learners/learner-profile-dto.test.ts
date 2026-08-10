/**
 * toLearnerProfileDto() contract tests.
 *
 * The DTO is a FROZEN wire contract: pinned by the Zod `StudentProfileResponse`
 * schema -> openapi/v2.json -> the generated Flutter Dart client. Adding a field
 * is a breaking mobile change and leaking an internal field (`schoolId`,
 * `authUserId`) is a data-exposure bug, so the key set is asserted EXACTLY
 * rather than with `objectContaining`.
 *
 * Also pins the `learner.id -> student_id` rename (the DTO must NOT publish the
 * auth user id under that name) and null passthrough.
 */
import { describe, it, expect } from 'vitest';

import type { Learner } from '@/modules/learners/domain/learner';
import { toLearnerProfileDto } from '@/modules/learners/presentation/learner-profile-dto';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const AUTH_USER_ID = 'auth-0000-0000-0000-000000000001';

/** The frozen v2 payload key set. Changing this list is a mobile-breaking change. */
const EXPECTED_KEYS = [
  'schemaVersion',
  'student_id',
  'name',
  'grade',
  'board',
  'stream',
  'plan',
  'language',
].sort();

function makeLearner(overrides: Partial<Learner> = {}): Learner {
  return {
    id: STUDENT_ID,
    authUserId: AUTH_USER_ID,
    name: 'Asha',
    grade: '9',
    board: 'CBSE',
    stream: 'science',
    plan: 'pro',
    language: 'hi',
    schoolId: 'school-1',
    ...overrides,
  };
}

describe('toLearnerProfileDto', () => {
  it('emits exactly the 8 frozen contract keys — no more, no fewer', () => {
    const dto = toLearnerProfileDto(makeLearner());

    expect(Object.keys(dto).sort()).toEqual(EXPECTED_KEYS);
    expect(Object.keys(dto)).toHaveLength(8);
  });

  it('emits exactly the 8 keys even when every optional field is null', () => {
    const dto = toLearnerProfileDto(
      makeLearner({
        name: null,
        grade: null,
        board: null,
        stream: null,
        plan: null,
        language: null,
        schoolId: null,
        authUserId: null,
      }),
    );

    // An `undefined`-valued field would still be an own key; JSON.stringify
    // would then drop it and silently break the contract, so assert on keys.
    expect(Object.keys(dto).sort()).toEqual(EXPECTED_KEYS);
  });

  it('maps student_id from learner.id, not from authUserId', () => {
    const dto = toLearnerProfileDto(makeLearner());

    expect(dto.student_id).toBe(STUDENT_ID);
    expect(dto.student_id).not.toBe(AUTH_USER_ID);
  });

  it('never leaks the internal schoolId or authUserId fields', () => {
    const dto = toLearnerProfileDto(makeLearner({ schoolId: 'school-1' }));

    expect(Object.keys(dto)).not.toContain('schoolId');
    expect(Object.keys(dto)).not.toContain('school_id');
    expect(Object.keys(dto)).not.toContain('authUserId');
    expect(Object.keys(dto)).not.toContain('auth_user_id');
    expect(JSON.stringify(dto)).not.toContain('school-1');
    expect(JSON.stringify(dto)).not.toContain(AUTH_USER_ID);
  });

  it('stamps schemaVersion 1', () => {
    expect(toLearnerProfileDto(makeLearner()).schemaVersion).toBe(1);
  });

  it('passes through every domain value verbatim', () => {
    const dto = toLearnerProfileDto(makeLearner());

    expect(dto).toEqual({
      schemaVersion: 1,
      student_id: STUDENT_ID,
      name: 'Asha',
      grade: '9',
      board: 'CBSE',
      stream: 'science',
      plan: 'pro',
      language: 'hi',
    });
  });

  it('passes nulls through as null (not undefined, not empty string)', () => {
    const dto = toLearnerProfileDto(
      makeLearner({ name: null, grade: null, board: null, stream: null, plan: null, language: null }),
    );

    expect(dto.name).toBeNull();
    expect(dto.grade).toBeNull();
    expect(dto.board).toBeNull();
    expect(dto.stream).toBeNull();
    expect(dto.plan).toBeNull();
    expect(dto.language).toBeNull();
    for (const value of Object.values(dto)) {
      expect(value).not.toBeUndefined();
    }
  });

  it('P5: grade is emitted as a string', () => {
    const dto = toLearnerProfileDto(makeLearner({ grade: '12' }));

    expect(typeof dto.grade).toBe('string');
    expect(dto.grade).toBe('12');
  });
});
