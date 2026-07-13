/**
 * Pins for the shared cached taxonomy fetcher (ADR-007).
 *
 * Pins:
 *  1. Cache key is order-independent over the subject-id set (same set →
 *     same key regardless of caller ordering) and includes grade.
 *  2. Empty input short-circuits without touching the DB or the cache.
 *  3. Cache-layer failure degrades to a direct DB read (cache is an
 *     optimization, never a dependency).
 *  4. Genuine DB errors are rethrown, NOT retried via the raw path (no
 *     double query, no silent empty taxonomy — Hard Rule 2 adjacent).
 *  5. Entries are tagged with the shared `syllabus` tag so admin content
 *     writes can invalidate via revalidateTag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cacheCalls: Array<{ keyParts: string[]; options: { tags?: string[]; revalidate?: number } }> = [];
let cacheThrows = false;

vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[], options: Record<string, unknown>) => {
    cacheCalls.push({ keyParts, options: options as { tags?: string[]; revalidate?: number } });
    return async () => {
      if (cacheThrows) throw new Error('Missing incremental cache in runtime');
      return fn();
    };
  },
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let dbResult: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };
const fromSpy = vi.fn();

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      fromSpy(table);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve(dbResult);
      return chain;
    },
  }),
}));

import { getActiveTopicsForSubjects, getSubjectIdCodeRows, SYLLABUS_CACHE_TAG } from '@/lib/curriculum/cached-taxonomy';

beforeEach(() => {
  cacheCalls.length = 0;
  cacheThrows = false;
  dbResult = { data: [{ id: 't1' }], error: null };
  fromSpy.mockClear();
});

describe('cached-taxonomy', () => {
  it('builds an order-independent cache key that includes grade', async () => {
    await getActiveTopicsForSubjects('9', ['b-id', 'a-id']);
    await getActiveTopicsForSubjects('9', ['a-id', 'b-id']);
    expect(cacheCalls).toHaveLength(2);
    expect(cacheCalls[0].keyParts).toEqual(cacheCalls[1].keyParts);
    expect(cacheCalls[0].keyParts).toContain('9');
    expect(cacheCalls[0].keyParts.join('|')).toContain('a-id,b-id');
  });

  it('tags every entry with the shared syllabus tag + a TTL backstop', async () => {
    await getActiveTopicsForSubjects('9', ['a-id']);
    await getSubjectIdCodeRows(['math']);
    for (const call of cacheCalls) {
      expect(call.options.tags).toContain(SYLLABUS_CACHE_TAG);
      expect(call.options.revalidate).toBeGreaterThan(0);
    }
  });

  it('short-circuits on empty input without touching DB or cache', async () => {
    expect(await getActiveTopicsForSubjects('9', [])).toEqual([]);
    expect(await getSubjectIdCodeRows([])).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
    expect(cacheCalls).toHaveLength(0);
  });

  it('degrades to a direct DB read when the cache layer fails', async () => {
    cacheThrows = true;
    const rows = await getActiveTopicsForSubjects('9', ['a-id']);
    expect(rows).toEqual([{ id: 't1' }]);
    expect(fromSpy).toHaveBeenCalledWith('curriculum_topics');
  });

  it('rethrows genuine DB errors without a second query', async () => {
    dbResult = { data: null, error: { message: 'permission denied' } };
    await expect(getActiveTopicsForSubjects('9', ['a-id'])).rejects.toThrow('curriculum_topics fetch failed');
    // one from() call only — no fallback retry on a real DB error
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });
});
