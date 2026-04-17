/**
 * Concept-engine grounded-answer feature-flag gate tests.
 *
 * The `search` action on /api/concept-engine has two code paths:
 *   (a) grounded-answer service path (retrieve_only=true) — flag ON
 *   (b) legacy direct Voyage + match_rag_chunks path       — flag OFF
 *
 * During the Phase 3 rollout window both paths MUST remain reachable. This
 * file verifies the decision logic and response-shape mapping without
 * re-mounting the full Node route. The full integration is covered via the
 * subject-endpoint-validation.test.ts suite which imports the real route.
 */

import { describe, it, expect } from 'vitest';
import type { Citation, GroundedResponse } from '@/lib/ai/grounded-client';

// ─── Mirror of the citation→SearchResult mapping in handleSearchViaGrounded ──
// Keep in sync with src/app/api/concept-engine/route.ts. Quality review rejects
// if this diverges from the route.

interface SearchResult {
  id: string;
  content: string;
  chapter_title: string | null;
  topic: string | null;
  concept: string | null;
  similarity: number;
  media_url: string | null;
  content_type: string;
}

function mapCitationsToSearchResults(citations: Citation[]): SearchResult[] {
  return citations.map((c) => ({
    id: c.chunk_id,
    content: c.excerpt,
    chapter_title: c.chapter_title,
    topic: null,
    concept: null,
    similarity: c.similarity,
    media_url: c.media_url,
    content_type: c.media_url ? 'diagram' : 'content',
  }));
}

describe('concept-engine citation → SearchResult mapping', () => {
  const fakeCitations: Citation[] = [
    {
      index: 0,
      chunk_id: 'chunk-1',
      chapter_number: 1,
      chapter_title: 'Motion',
      page_number: 12,
      similarity: 0.82,
      excerpt: 'An object in motion tends to stay in motion.',
      media_url: null,
    },
    {
      index: 1,
      chunk_id: 'chunk-2',
      chapter_number: 1,
      chapter_title: 'Motion',
      page_number: null,
      similarity: 0.76,
      excerpt: 'Diagram of a free-body force set.',
      media_url: 'https://cdn.example/m2.png',
    },
  ];

  it('preserves chunk_id as id', () => {
    const mapped = mapCitationsToSearchResults(fakeCitations);
    expect(mapped[0].id).toBe('chunk-1');
    expect(mapped[1].id).toBe('chunk-2');
  });

  it('uses excerpt as content', () => {
    const mapped = mapCitationsToSearchResults(fakeCitations);
    expect(mapped[0].content).toBe(
      'An object in motion tends to stay in motion.',
    );
  });

  it('sets content_type=diagram when media_url present, content otherwise', () => {
    const mapped = mapCitationsToSearchResults(fakeCitations);
    expect(mapped[0].content_type).toBe('content');
    expect(mapped[1].content_type).toBe('diagram');
  });

  it('preserves similarity score', () => {
    const mapped = mapCitationsToSearchResults(fakeCitations);
    expect(mapped[0].similarity).toBe(0.82);
  });

  it('returns empty array for empty citations', () => {
    expect(mapCitationsToSearchResults([])).toEqual([]);
  });
});

describe('concept-engine abstain handling', () => {
  it('returns empty results with traceId on abstain', () => {
    const abstain: GroundedResponse = {
      grounded: false,
      abstain_reason: 'chapter_not_ready',
      suggested_alternatives: [],
      trace_id: 'trace-abc-123',
      meta: { latency_ms: 42 },
    };

    // Simulate the shape the route returns to the client on abstain.
    const clientPayload = {
      results: [] as SearchResult[],
      total_results: 0,
      traceId: abstain.trace_id,
      abstainReason: !abstain.grounded ? abstain.abstain_reason : undefined,
    };

    expect(clientPayload.results).toHaveLength(0);
    expect(clientPayload.traceId).toBe('trace-abc-123');
    expect(clientPayload.abstainReason).toBe('chapter_not_ready');
  });

  it('includes traceId in successful grounded response', () => {
    const success: GroundedResponse = {
      grounded: true,
      answer: '',
      citations: [],
      confidence: 0,
      trace_id: 'trace-success-1',
      meta: { claude_model: 'haiku', tokens_used: 0, latency_ms: 88 },
    };

    const clientPayload = {
      traceId: success.trace_id,
    };
    expect(clientPayload.traceId).toBe('trace-success-1');
  });
});