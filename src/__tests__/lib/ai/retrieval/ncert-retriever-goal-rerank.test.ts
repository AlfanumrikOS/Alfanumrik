/**
 * Phase 4 retriever integration tests.
 *
 * Pins the ff_goal_aware_rag flag-gated rerank behavior in retrieveNcertChunks.
 * Default OFF: chunk order is byte-identical to today (Voyage rerank-2 + RRF
 * order from match_rag_chunks_ncert RPC). When ON + known goal: chunks are
 * re-sorted by similarity * getRagSourceWeight(goal, chunk).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsFeatureEnabled = vi.fn();
const mockRpc = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { rpc: mockRpc },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/ai/config', () => ({
  getAIConfig: () => ({
    voyageApiKey: 'test-key',
    embeddingModel: 'voyage-3',
    embeddingDimension: 1024,
    ragMatchCount: 5,
    ragMinQuality: 0.5,
  }),
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ data: [{ embedding: new Array(1024).fill(0.1) }] }),
});

// Mock RPC rows: a high-similarity NCERT chunk + a lower-similarity PYQ chunk.
// Without rerank: NCERT first. With board_topper rerank: PYQ first.
const ROWS = [
  {
    id: 'ncert-chunk-1',
    content: 'NCERT chapter 1 paragraph',
    subject: 'math',
    chapter_number: 1,
    similarity: 0.85,
    source: 'ncert_2025',
    exam_relevance: ['CBSE'],
  },
  {
    id: 'pyq-chunk-2',
    content: 'PYQ board exam question',
    subject: 'math',
    chapter_number: 1,
    similarity: 0.60,
    source: 'pyq',
    exam_relevance: ['CBSE_BOARD'],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFeatureEnabled.mockResolvedValue(false);
  mockRpc.mockResolvedValue({ data: ROWS, error: null });
});

describe('retrieveNcertChunks: Phase 4 goal-aware rerank', () => {
  it('flag OFF returns chunks in RPC order (byte-identical to legacy)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const { retrieveNcertChunks } = await import('@/lib/ai/retrieval/ncert-retriever');
    const result = await retrieveNcertChunks({
      query: 'photosynthesis',
      subject: 'science',
      grade: '7',
      academicGoal: 'board_topper',
    });
    expect(result.chunks.map((c) => c.id)).toEqual(['ncert-chunk-1', 'pyq-chunk-2']);
    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      'ncert_retriever_goal_rerank_applied',
      expect.anything(),
    );
  });

  it('flag ON + board_topper goal: PYQ chunk floats above NCERT', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const { retrieveNcertChunks } = await import('@/lib/ai/retrieval/ncert-retriever');
    const result = await retrieveNcertChunks({
      query: 'photosynthesis',
      subject: 'science',
      grade: '7',
      academicGoal: 'board_topper',
    });
    // PYQ similarity 0.60 * 1.5 = 0.90 vs NCERT 0.85 * 1.0 = 0.85 → PYQ wins
    expect(result.chunks[0].id).toBe('pyq-chunk-2');
    expect(result.chunks[1].id).toBe('ncert-chunk-1');
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'ncert_retriever_goal_rerank_applied',
      expect.objectContaining({
        goalCode: 'board_topper',
        chunkCount: 2,
      }),
    );
  });

  it('flag ON + null goal returns chunks in RPC order (no rerank applied)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const { retrieveNcertChunks } = await import('@/lib/ai/retrieval/ncert-retriever');
    const result = await retrieveNcertChunks({
      query: 'photosynthesis',
      subject: 'science',
      grade: '7',
      academicGoal: null,
    });
    expect(result.chunks.map((c) => c.id)).toEqual(['ncert-chunk-1', 'pyq-chunk-2']);
    expect(mockLoggerInfo).not.toHaveBeenCalledWith(
      'ncert_retriever_goal_rerank_applied',
      expect.anything(),
    );
  });

  it('flag ON + unknown goal returns chunks in RPC order (graceful no-op)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const { retrieveNcertChunks } = await import('@/lib/ai/retrieval/ncert-retriever');
    const result = await retrieveNcertChunks({
      query: 'photosynthesis',
      subject: 'science',
      grade: '7',
      academicGoal: 'not_a_real_goal',
    });
    expect(result.chunks.map((c) => c.id)).toEqual(['ncert-chunk-1', 'pyq-chunk-2']);
  });

  it('flag ON + omitted academicGoal returns chunks in RPC order', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const { retrieveNcertChunks } = await import('@/lib/ai/retrieval/ncert-retriever');
    const result = await retrieveNcertChunks({
      query: 'photosynthesis',
      subject: 'science',
      grade: '7',
    });
    expect(result.chunks.map((c) => c.id)).toEqual(['ncert-chunk-1', 'pyq-chunk-2']);
  });

  it('rerank does not call isFeatureEnabled when no known goal is supplied', async () => {
    const { retrieveNcertChunks } = await import('@/lib/ai/retrieval/ncert-retriever');
    await retrieveNcertChunks({
      query: 'photosynthesis',
      subject: 'science',
      grade: '7',
    });
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('chunk source + examRelevance fields are mapped from RPC rows', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const { retrieveNcertChunks } = await import('@/lib/ai/retrieval/ncert-retriever');
    const result = await retrieveNcertChunks({
      query: 'photosynthesis',
      subject: 'science',
      grade: '7',
    });
    const ncert = result.chunks.find((c) => c.id === 'ncert-chunk-1')!;
    const pyq = result.chunks.find((c) => c.id === 'pyq-chunk-2')!;
    expect(ncert.source).toBe('ncert_2025');
    expect(ncert.examRelevance).toEqual(['CBSE']);
    expect(pyq.source).toBe('pyq');
    expect(pyq.examRelevance).toEqual(['CBSE_BOARD']);
  });
});
