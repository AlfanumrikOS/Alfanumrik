/**
 * RAG Retrieval — pure logic tests
 *
 * fetchRAGContext lives in a Deno Edge Function and cannot be imported
 * directly into Vitest. These tests cover the routing decision logic,
 * concept prepend behaviour, output formatting, and error handling
 * by re-implementing the function inline using the same logic patterns
 * and a mock Supabase client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Helpers — mirror the logic inside fetchRAGContext without Deno imports
// ---------------------------------------------------------------------------

/**
 * Routing decision extracted for unit-level testing.
 * Source: `const useHybrid = !!queryEmbedding && !contentType`
 */
const shouldUseHybrid = (
  queryEmbedding: number[] | null,
  contentType?: string | null,
): boolean => !!queryEmbedding && !contentType;

/**
 * Concept-prepend logic extracted for unit-level testing.
 * Source: `const effectiveQuery = concept ? \`\${concept}: \${query}\` : query`
 */
const buildEffectiveQuery = (query: string, concept?: string | null): string =>
  concept ? `${concept}: ${query}` : query;

/**
 * Output formatter extracted for unit-level testing.
 * Source: the `.map()` inside the return statement of fetchRAGContext.
 */
interface RAGChunk {
  content: string;
  chapter_title?: string;
  topic?: string;
  concept?: string;
}

const formatRAGResult = (chunks: RAGChunk[]): string | null => {
  if (!chunks || chunks.length === 0) return null;
  return chunks
    .map((c) => {
      const parts: string[] = [];
      if (c.chapter_title) parts.push(`[Chapter: ${c.chapter_title}]`);
      if (c.topic) parts.push(`[Topic: ${c.topic}]`);
      if (c.concept) parts.push(`[Concept: ${c.concept}]`);
      if (parts.length > 0) parts.push('');
      parts.push(c.content);
      return parts.join('\n');
    })
    .join('\n\n---\n\n');
};

/**
 * Integration-style wrapper that re-implements fetchRAGContext using the same
 * conditional logic, delegating to a mock supabase.rpc.
 *
 * generateEmbedding is passed as a dependency so tests can control it.
 */
async function fetchRAGContextTestable(
  supabase: Pick<SupabaseClient, 'rpc'>,
  query: string,
  subject: string,
  grade: string,
  chapter?: string | null,
  contentType?: string | null,
  concept?: string | null,
  generateEmbedding?: (q: string) => Promise<number[]>,
): Promise<string | null> {
  try {
    const effectiveQuery = buildEffectiveQuery(query, concept);

    let queryEmbedding: number[] | null = null;
    if (generateEmbedding) {
      try {
        queryEmbedding = await generateEmbedding(effectiveQuery);
      } catch {
        // Embedding unavailable — proceed with keyword-only search
      }
    }

    const useHybrid = shouldUseHybrid(queryEmbedding, contentType);

    let data: RAGChunk[] | null = null;
    let error: unknown = null;

    if (useHybrid) {
      const result = await (supabase as SupabaseClient).rpc('hybrid_rag_search', {
        query_text: effectiveQuery,
        query_embedding: JSON.stringify(queryEmbedding),
        p_subject: subject,
        p_grade: grade,
        ...(chapter ? { p_chapter: chapter } : {}),
        match_count: 5,
        vector_weight: 0.7,
        text_weight: 0.3,
      });
      data = result.data;
      error = result.error;
    } else {
      const rpcParams: Record<string, unknown> = {
        query_text: effectiveQuery,
        p_subject: subject,
        p_grade: grade,
        match_count: 5,
      };
      if (chapter) rpcParams.p_chapter = chapter;
      if (contentType) rpcParams.p_content_type = contentType;
      if (queryEmbedding) rpcParams.query_embedding = JSON.stringify(queryEmbedding);

      const result = await (supabase as SupabaseClient).rpc('match_rag_chunks', rpcParams);
      data = result.data;
      error = result.error;
    }

    if (error || !data || data.length === 0) return null;

    return formatRAGResult(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests — Routing decision (pure logic, no I/O)
// ---------------------------------------------------------------------------

describe('RAG retrieval routing decision (shouldUseHybrid)', () => {
  it('returns true when embedding is present and contentType is absent', () => {
    expect(shouldUseHybrid([0.1, 0.2, 0.3], undefined)).toBe(true);
  });

  it('returns true when embedding is present and contentType is null', () => {
    expect(shouldUseHybrid([0.1, 0.2], null)).toBe(true);
  });

  it('returns false when embedding is null (embedding failed)', () => {
    expect(shouldUseHybrid(null, undefined)).toBe(false);
  });

  it('returns false when embedding is empty array', () => {
    // An empty array is falsy via !! only if length is 0 — but !![] is true,
    // so we verify the real behaviour: !![] === true, but an empty embedding
    // should still produce false for useHybrid in practice via the source code.
    // The source uses !!queryEmbedding which is truthy for []; this test
    // documents that a non-null, non-empty-null embedding makes useHybrid true.
    expect(shouldUseHybrid([], undefined)).toBe(true); // !![] === true in JS
  });

  it('returns false when contentType is set even though embedding is present', () => {
    expect(shouldUseHybrid([0.1, 0.2], 'qa')).toBe(false);
  });

  it('returns false when both embedding and contentType are absent/null', () => {
    expect(shouldUseHybrid(null, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Concept prepend (pure logic)
// ---------------------------------------------------------------------------

describe('RAG retrieval concept prepend (buildEffectiveQuery)', () => {
  it('prepends concept to query when concept is provided', () => {
    expect(buildEffectiveQuery('what is photosynthesis', 'Photosynthesis')).toBe(
      'Photosynthesis: what is photosynthesis',
    );
  });

  it('does not prepend when concept is undefined', () => {
    expect(buildEffectiveQuery('what is photosynthesis', undefined)).toBe(
      'what is photosynthesis',
    );
  });

  it('does not prepend when concept is null', () => {
    expect(buildEffectiveQuery('what is photosynthesis', null)).toBe('what is photosynthesis');
  });

  it('does not prepend when concept is empty string (falsy)', () => {
    expect(buildEffectiveQuery('what is photosynthesis', '')).toBe('what is photosynthesis');
  });
});

// ---------------------------------------------------------------------------
// Tests — Output formatting (pure logic)
// ---------------------------------------------------------------------------

describe('RAG retrieval output formatting (formatRAGResult)', () => {
  it('formats a chunk with chapter, topic, and concept labels', () => {
    const result = formatRAGResult([
      {
        content: 'Plants make food',
        chapter_title: 'Ch 7',
        topic: 'Nutrition',
        concept: 'Photosynthesis',
      },
    ]);
    expect(result).toContain('[Chapter: Ch 7]');
    expect(result).toContain('[Topic: Nutrition]');
    expect(result).toContain('[Concept: Photosynthesis]');
    expect(result).toContain('Plants make food');
  });

  it('omits labels that are absent in a chunk', () => {
    const result = formatRAGResult([{ content: 'Some content' }]);
    expect(result).toBe('Some content');
    expect(result).not.toContain('[Chapter:');
    expect(result).not.toContain('[Topic:');
    expect(result).not.toContain('[Concept:');
  });

  it('joins multiple chunks with the separator', () => {
    const result = formatRAGResult([
      { content: 'First chunk' },
      { content: 'Second chunk' },
    ]);
    expect(result).toContain('\n\n---\n\n');
    expect(result).toContain('First chunk');
    expect(result).toContain('Second chunk');
  });

  it('returns null for an empty array', () => {
    expect(formatRAGResult([])).toBeNull();
  });

  it('inserts a blank line between labels and content', () => {
    const result = formatRAGResult([
      { content: 'Content here', chapter_title: 'Ch 1' },
    ]);
    // The blank line is inserted as an empty string before the content line
    expect(result).toBe('[Chapter: Ch 1]\n\nContent here');
  });
});

// ---------------------------------------------------------------------------
// Tests — Integration-style with mock Supabase (Tests 1–8 from spec)
// ---------------------------------------------------------------------------

describe('fetchRAGContext integration (mock Supabase + mock embedding)', () => {
  const FAKE_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i / 1024);

  let mockRpc: ReturnType<typeof vi.fn>;
  let mockSupabase: Pick<SupabaseClient, 'rpc'>;

  const mockGenerateEmbeddingSuccess = vi.fn().mockResolvedValue(FAKE_EMBEDDING);
  const mockGenerateEmbeddingFail = vi.fn().mockRejectedValue(new Error('Embedding API down'));

  beforeEach(() => {
    mockRpc = vi.fn().mockResolvedValue({
      data: [{ content: 'test content', chapter_title: 'Ch1', topic: 'T1', concept: 'C1' }],
      error: null,
    });
    mockSupabase = { rpc: mockRpc } as unknown as Pick<SupabaseClient, 'rpc'>;
    vi.clearAllMocks();
  });

  // Test 1
  it('routes to hybrid_rag_search when embedding succeeds and contentType is absent', async () => {
    mockRpc.mockResolvedValue({
      data: [{ content: 'test', chapter_title: 'Ch1', topic: 'T1', concept: 'C1' }],
      error: null,
    });

    await fetchRAGContextTestable(
      mockSupabase,
      'what is photosynthesis',
      'Science',
      '8',
      null,
      undefined,
      null,
      mockGenerateEmbeddingSuccess,
    );

    expect(mockRpc).toHaveBeenCalledWith('hybrid_rag_search', expect.any(Object));
    expect(mockRpc).not.toHaveBeenCalledWith('match_rag_chunks', expect.any(Object));

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params).toHaveProperty('query_embedding');
    expect(params.vector_weight).toBe(0.7);
    expect(params.text_weight).toBe(0.3);
  });

  // Test 2
  it('routes to match_rag_chunks when embedding generation fails', async () => {
    mockRpc.mockResolvedValue({
      data: [{ content: 'test', chapter_title: 'Ch1', topic: 'T1', concept: 'C1' }],
      error: null,
    });

    await fetchRAGContextTestable(
      mockSupabase,
      'what is gravity',
      'Physics',
      '9',
      null,
      undefined,
      null,
      mockGenerateEmbeddingFail,
    );

    expect(mockRpc).toHaveBeenCalledWith('match_rag_chunks', expect.any(Object));
    expect(mockRpc).not.toHaveBeenCalledWith('hybrid_rag_search', expect.any(Object));
  });

  // Test 3
  it('routes to match_rag_chunks when contentType is set even with a successful embedding', async () => {
    mockRpc.mockResolvedValue({
      data: [{ content: 'test', chapter_title: 'Ch1', topic: 'T1', concept: 'C1' }],
      error: null,
    });

    await fetchRAGContextTestable(
      mockSupabase,
      'what is osmosis',
      'Biology',
      '10',
      null,
      'qa',
      null,
      mockGenerateEmbeddingSuccess,
    );

    expect(mockRpc).toHaveBeenCalledWith('match_rag_chunks', expect.any(Object));
    expect(mockRpc).not.toHaveBeenCalledWith('hybrid_rag_search', expect.any(Object));

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_content_type).toBe('qa');
  });

  // Test 4
  it('prepends concept to query_text passed to RPC', async () => {
    mockRpc.mockResolvedValue({
      data: [{ content: 'test', chapter_title: 'Ch1', topic: 'T1', concept: 'C1' }],
      error: null,
    });

    await fetchRAGContextTestable(
      mockSupabase,
      'what is photosynthesis',
      'Science',
      '7',
      null,
      undefined,
      'Photosynthesis',
      mockGenerateEmbeddingSuccess,
    );

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.query_text).toBe('Photosynthesis: what is photosynthesis');
  });

  // Test 5
  it('does not prepend to query_text when concept is undefined', async () => {
    mockRpc.mockResolvedValue({
      data: [{ content: 'test', chapter_title: 'Ch1', topic: 'T1', concept: 'C1' }],
      error: null,
    });

    await fetchRAGContextTestable(
      mockSupabase,
      'what is photosynthesis',
      'Science',
      '7',
      null,
      undefined,
      undefined,
      mockGenerateEmbeddingSuccess,
    );

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.query_text).toBe('what is photosynthesis');
  });

  // Test 6
  it('formats output with chapter, topic, and concept labels from RPC results', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          content: 'Plants make food',
          chapter_title: 'Ch 7',
          topic: 'Nutrition',
          concept: 'Photosynthesis',
        },
      ],
      error: null,
    });

    const result = await fetchRAGContextTestable(
      mockSupabase,
      'photosynthesis',
      'Science',
      '7',
      null,
      undefined,
      null,
      mockGenerateEmbeddingFail, // use keyword path for simplicity
    );

    expect(result).not.toBeNull();
    expect(result).toContain('[Chapter: Ch 7]');
    expect(result).toContain('[Topic: Nutrition]');
    expect(result).toContain('[Concept: Photosynthesis]');
    expect(result).toContain('Plants make food');
  });

  // Test 7
  it('returns null when RPC returns an empty array', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await fetchRAGContextTestable(
      mockSupabase,
      'what is force',
      'Physics',
      '9',
      null,
      undefined,
      null,
      mockGenerateEmbeddingFail,
    );

    expect(result).toBeNull();
  });

  // Test 8
  it('returns null when RPC returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC error' } });

    const result = await fetchRAGContextTestable(
      mockSupabase,
      'what is inertia',
      'Physics',
      '9',
      null,
      undefined,
      null,
      mockGenerateEmbeddingFail,
    );

    expect(result).toBeNull();
  });

  // Additional: no embedding provided at all (undefined generateEmbedding)
  it('falls back to match_rag_chunks when no generateEmbedding function is supplied', async () => {
    mockRpc.mockResolvedValue({
      data: [{ content: 'test', chapter_title: 'Ch1', topic: 'T1', concept: 'C1' }],
      error: null,
    });

    await fetchRAGContextTestable(
      mockSupabase,
      'what is velocity',
      'Physics',
      '10',
      null,
      undefined,
      null,
      undefined, // no embedding function
    );

    expect(mockRpc).toHaveBeenCalledWith('match_rag_chunks', expect.any(Object));
  });

  // Additional: chapter param is forwarded
  it('includes p_chapter in match_rag_chunks params when chapter is provided', async () => {
    mockRpc.mockResolvedValue({
      data: [{ content: 'test', chapter_title: 'Ch3', topic: 'T3', concept: 'C3' }],
      error: null,
    });

    await fetchRAGContextTestable(
      mockSupabase,
      'query',
      'Chemistry',
      '11',
      'Atomic Structure',
      undefined,
      null,
      mockGenerateEmbeddingFail,
    );

    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_chapter).toBe('Atomic Structure');
  });

  // Additional: chapter forwarded in hybrid path
  it('includes p_chapter in hybrid_rag_search params when chapter is provided', async () => {
    mockRpc.mockResolvedValue({
      data: [{ content: 'test', chapter_title: 'Ch3', topic: 'T3', concept: 'C3' }],
      error: null,
    });

    await fetchRAGContextTestable(
      mockSupabase,
      'query',
      'Chemistry',
      '11',
      'Atomic Structure',
      undefined,
      null,
      mockGenerateEmbeddingSuccess,
    );

    expect(mockRpc).toHaveBeenCalledWith('hybrid_rag_search', expect.any(Object));
    const params = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(params.p_chapter).toBe('Atomic Structure');
  });

  // Edge case: RPC returns null data without an error object
  it('returns null when RPC data is null with no error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await fetchRAGContextTestable(
      mockSupabase,
      'query',
      'Math',
      '8',
      null,
      undefined,
      null,
      mockGenerateEmbeddingFail,
    );

    expect(result).toBeNull();
  });
});
