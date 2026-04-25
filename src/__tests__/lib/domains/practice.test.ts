/**
 * Practice domain — typed read API contract tests (Phase 0e).
 *
 * Mirrors the identity-test pattern: input-validation cases run unconditionally;
 * a small integration block runs only when supabase env vars are present and
 * exercises the happy "empty-result" path so the test stays meaningful even
 * against an empty DB.
 *
 * Functions under test:
 *   - listDueCards
 *   - getCardById
 *   - countDueByStudent
 *   - listConceptMasteryByStudent
 *
 * SCOPE GUARD: This phase is read-only. Card writes (SM-2 ease/interval
 * updates) are NOT tested here — they live in Phase 0f / cognitive-engine.
 */

import { describe, it, expect } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';
import {
  listDueCards,
  getCardById,
  countDueByStudent,
  listConceptMasteryByStudent,
} from '@/lib/domains/practice';

describe('practice domain — input validation', () => {
  it('listDueCards rejects empty studentId with INVALID_INPUT', async () => {
    const r = await listDueCards('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getCardById rejects empty cardId with INVALID_INPUT', async () => {
    const r = await getCardById('', 'student-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getCardById rejects empty studentId with INVALID_INPUT', async () => {
    const r = await getCardById('card-id', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('countDueByStudent rejects empty studentId with INVALID_INPUT', async () => {
    const r = await countDueByStudent('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listConceptMasteryByStudent rejects empty studentId with INVALID_INPUT', async () => {
    const r = await listConceptMasteryByStudent('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Integration happy path (skipped without env) ──────────────────────────────
//
// Uses a deterministic fake UUID that is extremely unlikely to resolve to a
// real account. The contract under test is that the function returns
// ok: true with an empty list / null / zero counts (not an error), so the
// test is meaningful even against an empty DB.

const FAKE_UUID = '00000000-0000-0000-0000-00000000dead';
const FAKE_CARD_UUID = '00000000-0000-0000-0000-0000000ca7d0';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('practice domain — integration (empty-DB happy case)', () => {
  it('listDueCards returns ok with an array for unknown student', async () => {
    const r = await listDueCards(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listDueCards honours subject filter without error', async () => {
    const r = await listDueCards(FAKE_UUID, { subject: 'math', limit: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('getCardById returns ok with null for unknown card', async () => {
    const r = await getCardById(FAKE_CARD_UUID, FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('countDueByStudent returns ok with zero total for unknown student', async () => {
    const r = await countDueByStudent(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.total).toBe(0);
    expect(r.data.bySubject).toEqual({});
  });

  it('listConceptMasteryByStudent returns ok with an array for unknown student', async () => {
    const r = await listConceptMasteryByStudent(FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listConceptMasteryByStudent honours limit option', async () => {
    const r = await listConceptMasteryByStudent(FAKE_UUID, { limit: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });
});
