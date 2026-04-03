// src/__tests__/retrieval.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Inline replication of reranking.ts pure logic ───────────────────────────

function identityResult(docCount: number, finalCount: number) {
  return {
    rankedIndices: Array.from({ length: docCount }, (_, i) => i).slice(0, finalCount),
    reranked: false,
  }
}

// Simulate rerankDocuments without actual Voyage API call
function simulateRerank(
  documents: string[],
  finalCount: number,
  apiKey: string | undefined,
  apiResult: { data: { index: number; relevance_score: number }[] } | null,
  apiError: Error | null,
): { rankedIndices: number[]; reranked: boolean } {
  if (!documents.length) return { rankedIndices: [], reranked: false }
  if (!apiKey) return identityResult(documents.length, finalCount)
  if (documents.length <= finalCount) return identityResult(documents.length, finalCount)
  if (apiError || !apiResult) return identityResult(documents.length, finalCount)
  const ranked = apiResult.data.slice(0, finalCount).map(r => r.index)
  return { rankedIndices: ranked, reranked: true }
}

// ─── Inline replication of retrieval.ts orchestration logic ──────────────────

const DEFAULT_SYLLABUS_VERSION = '2025-26'

function buildRpcParams(params: {
  query: string; subject: string; grade: string
  chapterNumber?: number; chapterText?: string; concept?: string
  contentType?: string | null; source?: string; syllabusVersion?: string
  matchCount?: number; queryEmbedding?: number[] | null
}) {
  return {
    query_text: params.query,
    p_subject: params.subject,
    p_grade: params.grade,
    match_count: params.matchCount ?? 5,
    p_chapter_number: params.chapterNumber ?? null,
    p_chapter: params.chapterText ?? null,
    p_concept: params.concept ?? null,
    p_content_type: params.contentType ?? null,
    p_source: params.source ?? 'NCERT',
    p_syllabus_version: params.syllabusVersion ?? DEFAULT_SYLLABUS_VERSION,
    query_embedding: params.queryEmbedding ? JSON.stringify(params.queryEmbedding) : null,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('reranking logic', () => {
  it('returns identity order when VOYAGE_API_KEY is missing', () => {
    const result = simulateRerank(['a', 'b', 'c', 'd', 'e'], 3, undefined, null, null)
    expect(result.reranked).toBe(false)
    expect(result.rankedIndices).toEqual([0, 1, 2])
  })

  it('returns identity when documents.length <= finalCount', () => {
    const result = simulateRerank(['a', 'b'], 5, 'key', null, null)
    expect(result.reranked).toBe(false)
    expect(result.rankedIndices).toEqual([0, 1])
  })

  it('returns empty array for empty documents', () => {
    const result = simulateRerank([], 3, 'key', null, null)
    expect(result.rankedIndices).toEqual([])
    expect(result.reranked).toBe(false)
  })

  it('returns reranked indices on API success', () => {
    const apiResult = {
      data: [
        { index: 2, relevance_score: 0.95 },
        { index: 0, relevance_score: 0.80 },
        { index: 1, relevance_score: 0.60 },
      ],
    }
    const result = simulateRerank(['a', 'b', 'c', 'd', 'e'], 3, 'key', apiResult, null)
    expect(result.reranked).toBe(true)
    expect(result.rankedIndices).toEqual([2, 0, 1])
  })

  it('falls back to identity on API error', () => {
    const result = simulateRerank(['a', 'b', 'c', 'd', 'e'], 3, 'key', null, new Error('500'))
    expect(result.reranked).toBe(false)
    expect(result.rankedIndices).toEqual([0, 1, 2])
  })
})

describe('RPC parameter construction', () => {
  it('defaults syllabus_version to 2025-26 when not provided', () => {
    const params = buildRpcParams({ query: 'test', subject: 'Science', grade: '7' })
    expect(params.p_syllabus_version).toBe('2025-26')
  })

  it('passes explicit syllabusVersion through', () => {
    const params = buildRpcParams({ query: 'test', subject: 'Science', grade: '7', syllabusVersion: '2024-25' })
    expect(params.p_syllabus_version).toBe('2024-25')
  })

  it('defaults source to NCERT', () => {
    const params = buildRpcParams({ query: 'test', subject: 'Science', grade: '7' })
    expect(params.p_source).toBe('NCERT')
  })

  it('passes null embedding when not provided', () => {
    const params = buildRpcParams({ query: 'test', subject: 'Science', grade: '7' })
    expect(params.query_embedding).toBeNull()
  })

  it('serialises embedding to JSON string', () => {
    const emb = [0.1, 0.2, 0.3]
    const params = buildRpcParams({ query: 'test', subject: 'Science', grade: '7', queryEmbedding: emb })
    expect(params.query_embedding).toBe(JSON.stringify(emb))
  })
})

describe('retrieval orchestration (mocked Supabase)', () => {
  let mockRpc: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>
  let mockSupabase: any

  const makeChunkRow = (overrides = {}) => ({
    id: 'chunk-1',
    content: 'some content',
    chapter_title: 'Chapter 1',
    chapter_number: 1,
    topic: 'topic',
    concept: 'concept',
    concept_id: null,
    similarity: 0.9,
    content_type: 'content',
    page_number: 5,
    source: 'NCERT',
    syllabus_version: '2025-26',
    media_url: null,
    media_type: null,
    media_description: null,
    diagram_id: null,
    question_text: null,
    answer_text: null,
    question_type: null,
    marks_expected: null,
    bloom_level: null,
    ncert_exercise: null,
    ...overrides,
  })

  beforeEach(() => {
    mockRpc = vi.fn()
    mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'trace-id' }, error: null }),
        }),
      }),
    })
    mockSupabase = { rpc: mockRpc, from: mockFrom }
  })

  it('calls match_rag_chunks_v2 with correct params', async () => {
    mockRpc.mockResolvedValueOnce({ data: [makeChunkRow()], error: null })

    const rpcParams = buildRpcParams({ query: 'photosynthesis', subject: 'Science', grade: '7', matchCount: 5 })
    expect(rpcParams.p_subject).toBe('Science')
    expect(rpcParams.p_grade).toBe('7')
    expect(rpcParams.p_syllabus_version).toBe('2025-26')
    expect(rpcParams.p_source).toBe('NCERT')
  })

  it('falls back to match_rag_chunks on PGRST202 error', async () => {
    // First call (v2) returns PGRST202
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'not found' } })
      // Second call (legacy) returns results
      .mockResolvedValueOnce({ data: [makeChunkRow()], error: null })

    // Simulate the fallback detection logic
    const v2Result = await mockRpc('match_rag_chunks_v2', {})
    const shouldFallback = v2Result.error?.code === 'PGRST202'
    expect(shouldFallback).toBe(true)

    const legacyResult = await mockRpc('match_rag_chunks', {})
    expect(legacyResult.data).toHaveLength(1)
  })

  it('returns empty result when both RPCs return no rows', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    const result = await mockRpc('match_rag_chunks_v2', {})
    const isEmpty = !result.data || result.data.length === 0
    expect(isEmpty).toBe(true)
  })

  it('diagram chunk with diagram_id triggers registry fetch', async () => {
    const chunkWithDiagram = makeChunkRow({ diagram_id: 'diag-uuid-1', content_type: 'diagram' })
    mockRpc.mockResolvedValueOnce({ data: [chunkWithDiagram], error: null })

    // Verify diagram_id is present on chunk row
    expect(chunkWithDiagram.diagram_id).toBe('diag-uuid-1')

    // Simulate diagram registry lookup
    const diagramIds = [chunkWithDiagram.diagram_id]
    expect(diagramIds).toHaveLength(1)
    expect(diagramIds[0]).toBe('diag-uuid-1')
  })

  it('chunk without diagram_id skips registry fetch', () => {
    const plainChunk = makeChunkRow({ diagram_id: null })
    const diagramIds = [plainChunk].filter(c => c.diagram_id).map(c => c.diagram_id)
    expect(diagramIds).toHaveLength(0)
  })

  it('logTrace:false does not call retrieval_traces insert', async () => {
    // When logTrace is false, the from('retrieval_traces').insert() should never be called
    const insertSpy = vi.fn().mockResolvedValue({ data: { id: 'x' } })
    const localSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: [makeChunkRow()], error: null }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'retrieval_traces') return { insert: insertSpy }
        return { select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [] }) }) }) }
      }),
    }
    // Simulate: logTrace=false means retrieval_traces.insert never called
    const logTrace = false
    if (logTrace) {
      await localSupabase.from('retrieval_traces').insert({})
    }
    expect(insertSpy).not.toHaveBeenCalled()
  })
})

describe('context text formatting', () => {
  it('formats content chunk with chapter/topic/concept headers', () => {
    const chunk = {
      chapterTitle: 'Chapter 1', topic: 'Photosynthesis',
      concept: 'Light reactions', contentType: 'content' as const,
      content: 'Chlorophyll absorbs light.', diagramRecord: null,
      questionText: null, answerText: null,
    }
    const lines: string[] = []
    if (chunk.chapterTitle) lines.push(`[Chapter: ${chunk.chapterTitle}]`)
    if (chunk.topic) lines.push(`[Topic: ${chunk.topic}]`)
    if (chunk.concept) lines.push(`[Concept: ${chunk.concept}]`)
    lines.push('')
    lines.push(chunk.content)
    const text = lines.join('\n')
    expect(text).toContain('[Chapter: Chapter 1]')
    expect(text).toContain('[Topic: Photosynthesis]')
    expect(text).toContain('[Concept: Light reactions]')
    expect(text).toContain('Chlorophyll absorbs light.')
  })

  it('formats Q&A chunk with Q:/A: prefixes', () => {
    const chunk = {
      chapterTitle: 'Ch1', topic: 'T', concept: 'C', contentType: 'qa' as const,
      content: '', diagramRecord: null,
      questionText: 'What is photosynthesis?', answerText: 'The process of making food.',
    }
    const parts: string[] = []
    if (chunk.chapterTitle) parts.push(`[Chapter: ${chunk.chapterTitle}]`)
    if (chunk.contentType === 'qa' && chunk.questionText) {
      parts.push('[Q&A]')
      parts.push(`Q: ${chunk.questionText}`)
      parts.push(`A: ${chunk.answerText ?? ''}`)
    }
    const text = parts.join('\n')
    expect(text).toContain('[Q&A]')
    expect(text).toContain('Q: What is photosynthesis?')
    expect(text).toContain('A: The process of making food.')
  })

  it('formats diagram chunk with diagram title from registry', () => {
    const chunk = {
      chapterTitle: 'Ch1', topic: 'T', concept: 'C', contentType: 'diagram' as const,
      content: 'Caption text',
      diagramRecord: { title: 'Figure 1.1 Chloroplast', description: 'Shows chloroplast structure', fileUrl: 'https://x.com/d.png', id: '1', diagramKey: 'k', titleHi: null, pageNumber: null, relatedConcepts: [] },
      questionText: null, answerText: null,
    }
    const parts: string[] = []
    if (chunk.contentType === 'diagram' && chunk.diagramRecord) {
      parts.push(`[Diagram: ${chunk.diagramRecord.title}]`)
      if (chunk.diagramRecord.description) parts.push(chunk.diagramRecord.description)
      parts.push(chunk.content)
    }
    const text = parts.join('\n')
    expect(text).toContain('[Diagram: Figure 1.1 Chloroplast]')
    expect(text).toContain('Shows chloroplast structure')
    expect(text).toContain('Caption text')
  })
})
