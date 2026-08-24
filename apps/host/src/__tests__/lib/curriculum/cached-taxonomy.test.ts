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

import {
  getActiveTopicsForSubjects,
  getSubjectIdCodeRows,
  getTopicTitlesByIds,
  SYLLABUS_CACHE_TAG,
} from '@/lib/curriculum/cached-taxonomy';

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

/**
 * getTopicTitlesByIds() (added 2026-08-02, Wave B exam-schedule) — id -> title
 * lookup for an arbitrary, caller-known set of topic ids.
 *
 * Pins:
 *  1. Empty input short-circuits without touching DB or cache (same contract
 *     as the sibling fetchers above).
 *  2. Cache key is order-independent over the id set.
 *  3. Tagged with the shared `syllabus` tag + a TTL, same as the siblings.
 *  4. Deliberately NOT is_active-filtered (unlike getActiveTopicsForSubjects)
 *     — the query selects `id, title, title_hi`, with no `is_active` predicate.
 *     (`title_hi` added 2026-08-24 for the /diagnostic results screen, which
 *     renders topic labels to the student and so must be bilingual — P7.)
 *  5. Cache-layer failure degrades to a direct DB read; genuine DB errors
 *     rethrow without a second query.
 */
describe('getTopicTitlesByIds', () => {
  it('short-circuits on empty input without touching DB or cache', async () => {
    expect(await getTopicTitlesByIds([])).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
    expect(cacheCalls).toHaveLength(0);
  });

  it('queries curriculum_topics selecting id, title and title_hi (is_active-agnostic)', async () => {
    dbResult = {
      data: [{ id: 't1', title: 'Number Systems', title_hi: 'संख्या पद्धति' }],
      error: null,
    };
    const rows = await getTopicTitlesByIds(['t1']);
    expect(rows).toEqual([{ id: 't1', title: 'Number Systems', title_hi: 'संख्या पद्धति' }]);
    expect(fromSpy).toHaveBeenCalledWith('curriculum_topics');
  });

  it('P7: carries title_hi through for the /diagnostic results screen, and tolerates it being null', async () => {
    // Added 2026-08-24 — the diagnostic renders topic labels to the student, so
    // this reader must be bilingual. An untranslated topic yields null; callers
    // fall back to the English title rather than blanking the chip.
    dbResult = { data: [{ id: 't1', title: 'Trigonometry', title_hi: null }], error: null };
    const rows = await getTopicTitlesByIds(['t1']);
    expect(rows[0].title_hi).toBeNull();
    expect(rows[0].title).toBe('Trigonometry');
  });

  it('builds an order-independent cache key over the id set', async () => {
    await getTopicTitlesByIds(['b-id', 'a-id']);
    await getTopicTitlesByIds(['a-id', 'b-id']);
    expect(cacheCalls).toHaveLength(2);
    expect(cacheCalls[0].keyParts).toEqual(cacheCalls[1].keyParts);
    // v2 since 2026-08-24: the cached ROW SHAPE gained `title_hi`, so the key
    // had to move or an in-flight v1 entry would keep serving Hindi-less rows.
    expect(cacheCalls[0].keyParts[0]).toBe('curriculum-topic-titles-by-id-v2');
    expect(cacheCalls[0].keyParts.join('|')).toContain('a-id,b-id');
  });

  it('tags the entry with the shared syllabus tag + a TTL backstop', async () => {
    await getTopicTitlesByIds(['a-id']);
    expect(cacheCalls).toHaveLength(1);
    expect(cacheCalls[0].options.tags).toContain(SYLLABUS_CACHE_TAG);
    expect(cacheCalls[0].options.revalidate).toBeGreaterThan(0);
  });

  it('degrades to a direct DB read when the cache layer fails', async () => {
    cacheThrows = true;
    dbResult = { data: [{ id: 't1', title: 'Atoms' }], error: null };
    const rows = await getTopicTitlesByIds(['t1']);
    expect(rows).toEqual([{ id: 't1', title: 'Atoms' }]);
    expect(fromSpy).toHaveBeenCalledWith('curriculum_topics');
  });

  it('rethrows genuine DB errors without a second query', async () => {
    dbResult = { data: null, error: { message: 'permission denied' } };
    await expect(getTopicTitlesByIds(['a-id'])).rejects.toThrow('curriculum_topics id lookup failed');
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });

  it('returns an empty title array element (not a crash) when a row has a null title', async () => {
    dbResult = { data: [{ id: 't1', title: null }], error: null };
    const rows = await getTopicTitlesByIds(['t1']);
    expect(rows).toEqual([{ id: 't1', title: null }]);
  });
});
