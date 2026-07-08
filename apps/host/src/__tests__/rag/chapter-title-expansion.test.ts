/**
 * Tests for expandQueryWithChapterTitle in
 * supabase/functions/_shared/rag/retrieve.ts.
 *
 * Audit context: Phase 2.B Win 3. Locks down the chapter-title query
 * expansion behaviour so the embedding stage gets a topical hint while
 * the rerank stage continues to see the original query.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

interface DenoLike {
  env: { get: (k: string) => string | undefined };
}
declare global {
  // eslint-disable-next-line no-var
  var Deno: DenoLike | undefined;
}

beforeEach(() => {
  globalThis.Deno = { env: { get: () => undefined } };
});

afterEach(() => {
  delete (globalThis as { Deno?: DenoLike }).Deno;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadRetrieve(): Promise<any> {
  return await import('../../../supabase/functions/_shared/rag/retrieve');
}

describe('expandQueryWithChapterTitle', () => {
  it('prepends the chapter title when set and not already in the query', async () => {
    const { expandQueryWithChapterTitle } = await loadRetrieve();
    expect(expandQueryWithChapterTitle('explain refraction', 'Light')).toBe(
      'Light: explain refraction',
    );
  });

  it('returns the original query unchanged when chapterTitle is null/undefined/empty', async () => {
    const { expandQueryWithChapterTitle } = await loadRetrieve();
    expect(expandQueryWithChapterTitle('explain refraction', null)).toBe(
      'explain refraction',
    );
    expect(expandQueryWithChapterTitle('explain refraction', undefined)).toBe(
      'explain refraction',
    );
    expect(expandQueryWithChapterTitle('explain refraction', '')).toBe(
      'explain refraction',
    );
    expect(expandQueryWithChapterTitle('explain refraction', '   ')).toBe(
      'explain refraction',
    );
  });

  it('does NOT prepend when the query already mentions the chapter title (case-insensitive)', async () => {
    const { expandQueryWithChapterTitle } = await loadRetrieve();
    // Exact match
    expect(
      expandQueryWithChapterTitle('what is light reflection in detail', 'Light Reflection'),
    ).toBe('what is light reflection in detail');
    // Different case in the query
    expect(
      expandQueryWithChapterTitle('Define LIGHT REFLECTION fully', 'Light Reflection'),
    ).toBe('Define LIGHT REFLECTION fully');
  });

  it('handles whitespace + casing in the title gracefully', async () => {
    const { expandQueryWithChapterTitle } = await loadRetrieve();
    // Title is wrapped in whitespace — trimmed before prepending.
    expect(expandQueryWithChapterTitle('explain refraction', '  Light  ')).toBe(
      'Light: explain refraction',
    );
  });
});
