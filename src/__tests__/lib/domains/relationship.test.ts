/**
 * Relationship domain — typed read API contract tests.
 *
 * Mirrors the identity domain's test layout: input-validation tests run
 * everywhere, integration happy paths run only when SUPABASE_* env vars
 * are present.
 *
 * Scope limited to functions added in Phase 0c:
 *   - listChildrenForGuardian
 *   - listGuardiansForStudent
 *   - findLinkByCode
 *   - findLinkById
 *   - isGuardianLinkedToStudent
 *   - listPendingLinksForGuardian
 *
 * See docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md (Phase 0c).
 */

import { describe, it, expect } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';
import {
  listChildrenForGuardian,
  listGuardiansForStudent,
  findLinkByCode,
  findLinkById,
  isGuardianLinkedToStudent,
  listPendingLinksForGuardian,
} from '@/lib/domains/relationship';

describe('relationship domain — input validation', () => {
  it('listChildrenForGuardian rejects empty authUserId with INVALID_INPUT', async () => {
    const r = await listChildrenForGuardian('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listGuardiansForStudent rejects empty studentId with INVALID_INPUT', async () => {
    const r = await listGuardiansForStudent('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('findLinkByCode rejects empty linkCode with INVALID_INPUT', async () => {
    const r = await findLinkByCode('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('findLinkById rejects empty linkId with INVALID_INPUT', async () => {
    const r = await findLinkById('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('isGuardianLinkedToStudent rejects empty guardianId with INVALID_INPUT', async () => {
    const r = await isGuardianLinkedToStudent('', 'some-student');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('isGuardianLinkedToStudent rejects empty studentId with INVALID_INPUT', async () => {
    const r = await isGuardianLinkedToStudent('some-guardian', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listPendingLinksForGuardian rejects empty authUserId with INVALID_INPUT', async () => {
    const r = await listPendingLinksForGuardian('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Integration happy path (skipped without env) ──────────────────────────────
//
// Uses deterministic fake UUIDs that are extremely unlikely to resolve to a
// real account. Each helper's contract is "ok: true with empty/null when no
// match", so even an empty DB exercises the wire path meaningfully.

const FAKE_UUID = '00000000-0000-0000-0000-00000000dead';
const FAKE_LINK_CODE = '__phase0c_test_code_does_not_exist__';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('relationship domain — integration (null-path happy case)', () => {
  it('listChildrenForGuardian returns ok with [] for unknown guardian auth user', async () => {
    const r = await listChildrenForGuardian(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listGuardiansForStudent returns ok with [] for unknown student', async () => {
    const r = await listGuardiansForStudent(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('findLinkByCode returns ok with null for unknown link code', async () => {
    const r = await findLinkByCode(FAKE_LINK_CODE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('findLinkById returns ok with null for unknown link id', async () => {
    const r = await findLinkById(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('findLinkById with expectedStatus filter returns ok with null when no match', async () => {
    const r = await findLinkById(FAKE_UUID, 'pending');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('isGuardianLinkedToStudent returns ok with false for unknown pair', async () => {
    const r = await isGuardianLinkedToStudent(FAKE_UUID, FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBe(false);
  });

  it('listPendingLinksForGuardian returns ok with [] for unknown guardian auth user', async () => {
    const r = await listPendingLinksForGuardian(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });
});
