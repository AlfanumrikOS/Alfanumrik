/**
 * Identity domain — typed read API contract tests.
 *
 * These cover input validation (no env required) and — when integration
 * env vars are present — the happy path round-trip for each new read
 * function.
 *
 * Scope limited to functions added in Phase 0a:
 *   - getStudentByAuthUserId
 *   - getStudentById
 *   - getTeacherByAuthUserId
 *   - getGuardianByAuthUserId
 *   - listStudentsBySchool
 *
 * See docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md (Phase 0a).
 */

import { describe, it, expect } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';
import {
  getStudentByAuthUserId,
  getStudentById,
  getTeacherByAuthUserId,
  getGuardianByAuthUserId,
  listStudentsBySchool,
} from '@/lib/domains/identity';

describe('identity domain — input validation', () => {
  it('getStudentByAuthUserId rejects empty authUserId with INVALID_INPUT', async () => {
    const r = await getStudentByAuthUserId('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getStudentById rejects empty studentId with INVALID_INPUT', async () => {
    const r = await getStudentById('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getTeacherByAuthUserId rejects empty authUserId with INVALID_INPUT', async () => {
    const r = await getTeacherByAuthUserId('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getGuardianByAuthUserId rejects empty authUserId with INVALID_INPUT', async () => {
    const r = await getGuardianByAuthUserId('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listStudentsBySchool rejects empty schoolId with INVALID_INPUT', async () => {
    const r = await listStudentsBySchool('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Integration happy path (skipped without env) ──────────────────────────────
//
// Uses a deterministic fake UUID that is extremely unlikely to resolve to a
// real account. The contract under test is that the function returns
// ok: true with data === null (not an error), so even in an empty DB the
// test is meaningful.

const FAKE_UUID = '00000000-0000-0000-0000-00000000dead';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('identity domain — integration (null-path happy case)', () => {
  it('getStudentByAuthUserId returns ok with null for unknown user', async () => {
    const r = await getStudentByAuthUserId(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getTeacherByAuthUserId returns ok with null for unknown user', async () => {
    const r = await getTeacherByAuthUserId(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getGuardianByAuthUserId returns ok with null for unknown user', async () => {
    const r = await getGuardianByAuthUserId(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getStudentById returns ok with null for unknown id', async () => {
    const r = await getStudentById(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('listStudentsBySchool returns ok with an array for unknown school', async () => {
    const r = await listStudentsBySchool(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });
});
