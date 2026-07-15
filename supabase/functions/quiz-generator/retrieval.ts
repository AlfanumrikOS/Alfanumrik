// supabase/functions/quiz-generator/retrieval.ts
// Q&A retrieval adapter — thin wrapper over the unified RAG module.
//
// Consolidation 2026-07-15 (single-fetcher divergence closure): quiz-generator
// previously imported `retrieveChunks` from the DEPRECATED `_shared/retrieval.ts`,
// which targeted `match_rag_chunks_v2` — an RPC that was NEVER applied to
// production (see migration 20260415000016_match_rag_chunks_ncert_only.sql,
// audit finding #1). At runtime that path always degraded to the legacy
// `match_rag_chunks` fallback, whose return table carries NO Q&A columns
// (no question_text/answer_text), so the Q&A source silently yielded zero
// questions. This adapter repoints quiz-generator onto the canonical
// `_shared/rag/retrieve.ts` (`match_rag_chunks_ncert`), following the
// grounded-answer/retrieval.ts precedent.
//
// Contract (mirrors the old retrieveChunks contract where it matters):
//   - NEVER throws. Validation failures (e.g. bad grade) degrade to
//     { chunks: [], error } — same best-effort posture as the old module.
//   - P5: grade is the raw string "6"-"12"; the unified module validates it
//     at the boundary.
//   - subject is the snake_case subject code (e.g. "math") — identical to
//     what the old path passed to match_rag_chunks_v2.
//   - chapterNumber is INTEGER or null (never stringified).
//   - rerank: false — parity with the old call, which never set useReranking
//     (and the query here is a bare subject code, so cross-encoder reranking
//     adds no signal).
//
// Known deltas vs. the old (non-functional) path — documented, not hidden:
//   1. content_type filtering: the unified retrieve() does not yet expose a
//      contentType passthrough, even though the `match_rag_chunks_ncert` RPC
//      accepts `p_content_type` (DEFAULT NULL). Until that passthrough lands
//      (follow-up owned by ai-engineer, reviewed by assessment), this adapter
//      compensates by over-fetching and filtering TS-side to rows that carry
//      question_text — non-'qa' chunks have question_text NULL, so the filter
//      reconstructs the 'qa' universe exactly, at the cost of pool dilution
//      in the candidate fetch.
//   2. Source pinning: match_rag_chunks_ncert pins source = 'ncert_2025',
//      which is precisely the source value embed-ncert-qa writes on Q&A
//      chunks — so the Q&A universe is fully inside the pinned set. The old
//      path's `board: 'CBSE'` / `p_source: 'NCERT'` filters are subsumed.
//   3. retrieval_traces logging: the unified module does not write traces
//      (same as the grounded-answer path). The old module's trace insert was
//      best-effort/fire-and-forget; no consumer depends on quiz-generator
//      traces.
//
// NOTE: the only caller, selectRAGQuestions() in index.ts, is itself DORMANT —
// its call site is commented out pending a non-MCQ question_mode (P6: RAG Q&A
// chunks have no MCQ options). This adapter therefore changes no production
// behavior; it removes the deprecated-module dependency.

import { retrieve, type RetrievalChunk as UnifiedChunk } from '../_shared/rag/retrieve.ts'

// deno-lint-ignore no-explicit-any
type SupabaseLike = any

/** Q&A chunk shape consumed by selectRAGQuestions() (camelCase, matches the
 * fields it read from the old RetrievedChunk). */
export interface QAChunk {
  id: string
  questionText: string | null
  answerText: string | null
  questionType: string | null
  marksExpected: number | null
  bloomLevel: string | null
  chapterNumber: number | null
  topic: string | null
  concept: string | null
}

export interface QARetrievalResult {
  chunks: QAChunk[]
  /** null on success; message on degraded/empty retrieval. Never throws. */
  error: string | null
}

export interface QARetrievalParams {
  supabase: SupabaseLike
  /** P5 grade string "6"-"12" (validated by the unified module). */
  grade: string
  /** snake_case subject code, e.g. "math". Also used as the topic-level query. */
  subject: string
  chapterNumber: number | null
  /** Max Q&A chunks to return (callers over-fetch, e.g. count * 3). */
  matchCount: number
}

/** Over-fetch multiplier to compensate for the missing contentType='qa'
 * passthrough (see header delta #1): the RPC returns mixed content types and
 * we keep only rows with question_text. Capped to bound RPC cost. */
const QA_OVERFETCH_FACTOR = 3
const QA_OVERFETCH_CAP = 50

export async function retrieveQAChunks(params: QARetrievalParams): Promise<QARetrievalResult> {
  const { supabase, grade, subject, chapterNumber, matchCount } = params

  let unified
  try {
    unified = await retrieve({
      // Topic-level query — vector/FTS search is scoped by subject + chapter,
      // same as the old call which passed `query: subject`.
      query: subject,
      grade: grade as '6' | '7' | '8' | '9' | '10' | '11' | '12',
      subject,
      chapterNumber,
      limit: Math.min(matchCount * QA_OVERFETCH_FACTOR, QA_OVERFETCH_CAP),
      rerank: false,
      caller: 'quiz-generator',
      supabase,
    })
  } catch (err) {
    // retrieve() throws RetrievalError only on validation failure. The old
    // module never threw — preserve that contract and degrade to empty.
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`quiz-generator retrieval adapter: ${message}`)
    return { chunks: [], error: message }
  }

  if (unified.error && unified.chunks.length === 0) {
    return { chunks: [], error: `${unified.error.phase}: ${unified.error.message}` }
  }

  // Reconstruct the 'qa' content universe: only Q&A chunks carry question_text.
  const chunks: QAChunk[] = []
  for (const c of unified.chunks) {
    if (!isQAChunk(c)) continue
    chunks.push({
      id: c.chunk_id,
      questionText: c.question_text,
      answerText: c.answer_text,
      questionType: c.question_type,
      marksExpected: c.marks_expected,
      bloomLevel: c.bloom_level,
      chapterNumber: c.chapter_number,
      topic: c.topic,
      concept: c.concept,
    })
    if (chunks.length >= matchCount) break
  }

  return { chunks, error: null }
}

function isQAChunk(c: UnifiedChunk): boolean {
  if (typeof c.question_text !== 'string' || c.question_text.trim().length === 0) return false
  // Defense-in-depth: when the RPC surfaces content_type, require 'qa'.
  if (c.content_type != null && c.content_type !== 'qa') return false
  return true
}
