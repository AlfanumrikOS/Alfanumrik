import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * isDemoSchool — the server-gated predicate behind the P11-sanctioned demo-comp
 * exception (POST /api/school-admin/subscription).
 *
 * THE GUARANTEE under test: it reads schools.is_demo for the server-resolved
 * school id and FAILS CLOSED — any error, missing row, null/false flag, or a
 * thrown client returns false, so the default outcome is the real, payment-gated
 * Razorpay path. A real (non-demo) school can therefore never reach the comp
 * branch.
 */

const fromMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (...a: unknown[]) => fromMock(...a) }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { isDemoSchool } from '@/lib/demo/is-demo-school';

const SCHOOL_ID = '00000000-0000-0000-0000-000000000001';

/** Build a schools.select('is_demo').eq('id', x).maybeSingle() chain. */
function wireSchoolsRow(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  fromMock.mockImplementation((table: string) => {
    if (table === 'schools') return chain;
    throw new Error(`unexpected table ${table}`);
  });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isDemoSchool — true only for an explicit is_demo=true row', () => {
  it('returns true when schools.is_demo === true', async () => {
    wireSchoolsRow({ data: { is_demo: true }, error: null });
    await expect(isDemoSchool(SCHOOL_ID)).resolves.toBe(true);
  });

  it('resolves is_demo from the passed (server) school id via eq("id", schoolId)', async () => {
    const chain = wireSchoolsRow({ data: { is_demo: true }, error: null });
    await isDemoSchool(SCHOOL_ID);
    expect(chain.eq).toHaveBeenCalledWith('id', SCHOOL_ID);
  });
});

describe('isDemoSchool — fail-closed (returns false) on every non-true input', () => {
  it('false when is_demo === false', async () => {
    wireSchoolsRow({ data: { is_demo: false }, error: null });
    await expect(isDemoSchool(SCHOOL_ID)).resolves.toBe(false);
  });

  it('false when is_demo is null', async () => {
    wireSchoolsRow({ data: { is_demo: null }, error: null });
    await expect(isDemoSchool(SCHOOL_ID)).resolves.toBe(false);
  });

  it('false when the row is missing (no school)', async () => {
    wireSchoolsRow({ data: null, error: null });
    await expect(isDemoSchool(SCHOOL_ID)).resolves.toBe(false);
  });

  it('false on a query error', async () => {
    wireSchoolsRow({ data: null, error: { message: 'rls denied' } });
    await expect(isDemoSchool(SCHOOL_ID)).resolves.toBe(false);
  });

  it('false (no throw) when the client itself throws — fail closed → real path', async () => {
    fromMock.mockImplementation(() => {
      throw new Error('admin client exploded');
    });
    // The contract: never throws; returns false so the real Razorpay path runs.
    await expect(isDemoSchool(SCHOOL_ID)).resolves.toBe(false);
  });

  it('false (no throw) when maybeSingle rejects', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'schools') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockRejectedValue(new Error('connection reset')),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    await expect(isDemoSchool(SCHOOL_ID)).resolves.toBe(false);
  });

  it('false for an empty school id without touching the DB', async () => {
    await expect(isDemoSchool('')).resolves.toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
