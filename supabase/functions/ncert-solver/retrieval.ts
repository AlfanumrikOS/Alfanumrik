// supabase/functions/ncert-solver/retrieval.ts
// Solver-path RAG context adapter — thin wrapper over the unified retrieval module.
//
// Consolidation (mirrors quiz-generator/retrieval.ts, 2026-07-15): this adapter
// repoints ncert-solver's RAG context fetch onto the canonical
// `_shared/rag/retrieve.ts` (`match_rag_chunks_ncert`, RRF k=60, 0.22 cosine
// floor, MMR, overload-binding fix), replacing the deprecated
// `_shared/rag-retrieval.ts` → `_shared/retrieval.ts` shim whose primary backend
// (`match_rag_chunks_v2`) was NEVER applied to production and always degraded to
// the legacy `match_rag_chunks` fallback (no RRF, no cosine floor, no Q&A columns).
//
// Contract (mirrors the old fetchRAGContext contract where it matters):
//   - Returns { contextText, error } — never throws on retrieval failure.
//     Validation failures (bad grade) degrade to { contextText: null, error }.
//   - P5: grade is the raw string "6"-"12"; the unified module validates it.
//   - subject is the snake_case subject code (e.g. "math").
//   - chapter is a string (numeric → chapterNumber, non-numeric → chapterTitle).
//   - rerank: false — parity with the old call, which never set useReranking.
//     (The solver's own confidence estimation + verification provide quality
//     control; reranking is a separate improvement.)
//   - matchCount: 5 — parity with the old default (old fetchRAGContext defaulted
//     to 5). The flag-ON service path uses 6; aligning to 5 keeps this
//     intermediate step minimal-delta.
//
// Output shape is compatible with sanitizeRagContext (ncert-solver/index.ts):
//   - chunks joined by "\n\n---\n\n"
//   - each chunk prefixed with [Chapter: ...] / [Topic: ...] / [Concept: ...]
//     labels, then a blank line, then the content.
//   - Q&A and diagram chunks are NOT specially formatted here — the solver uses
//     the content text with chapter/topic/concept grounding, not the Q&A or
//     diagram presentation layer (that's the Foxy chat path).
//
// Known deltas vs. the old (non-functional) path — documented, not hidden:
//   1. Retrieval substrate: unified retrieve() → match_rag_chunks_ncert (RRF k=60,
//      0.22 cosine floor, overload-binding fix) instead of the dead v2/legacy V1
//      fallback. This is the whole point.
//   2. Source pinning: match_rag_chunks_ncert pins source='ncert_2025', which the
//      old path also effectively did (via p_source: 'NCERT' / board: 'CBSE').
//   3. Scope verification: the unified module does defense-in-depth scope
//      verification (grade_short, subject_code, chapter_number) and reports
//      scope_drops. The old path relied on the RPC's WHERE clause only.
//   4. retrieval_traces logging: the unified module does NOT write traces (same
//      as the old grounded-answer path). The old _shared/retrieval.ts wrote
//      traces fire-and-forget; no consumer depends on ncert-solver traces today.
//
// NOTE: this adapter does NOT yet route through callGroundedAnswer. That is the
// flag-ON path (ff_grounded_ai_ncert_solver). This adapter is the intermediate
// step that gives the legacy path the unified retrieval substrate while keeping
// the solver's own prompt engineering (buildSolverSystemPrompt /
// buildSolverPrompt / estimateConfidence / routeToSolver) intact. The flag-ON
// migration (prompt-parity canary at
// apps/host/src/__tests__/edge-functions/ncert-solver-prompt-parity.test.ts)
// must close GAP-1/2/3 before the flag flips.

import { retrieve, type RetrievalChunk } from '../_shared/rag/retrieve.ts';

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/** Context-text shape consumed by sanitizeRagContext (ncert-solver/index.ts). */
export interface SolverContextResult {
  /** LLM-formatted context string, or null on degraded/empty retrieval. */
  contextText: string | null;
  /** Error message on degraded/empty retrieval. Null on success. */
  error: string | null;
}

/** Params mirror the old fetchRAGContext call shape (ncert-solver call site). */
export interface SolverContextParams {
  supabase: SupabaseLike;
  query: string;            // student question
  grade: string;           // P5 "6"-"12"
  subject: string;         // snake_case subject code
  chapter?: string | null; // numeric → chapterNumber, non-numeric → chapterTitle
  matchCount?: number;     // default 5 (parity with old fetchRAGContext default)
}

/** Format unified RetrievalChunk[] into the context string sanitizeRagContext expects. */
function formatSolverContext(chunks: RetrievalChunk[]): string {
  return chunks.map((c) => {
    const lines: string[] = [];
    if (c.chapter_title) lines.push(`[Chapter: ${c.chapter_title}]`);
    if (c.topic) lines.push(`[Topic: ${c.topic}]`);
    if (c.concept) lines.push(`[Concept: ${c.concept}]`);
    if (lines.length > 0) lines.push(''); // blank line before content
    lines.push(c.content);
    return lines.join('\n');
  }).join('\n\n---\n\n');
}

/**
 * Retrieve NCERT context for the ncert-solver legacy path via the unified
 * retrieval module. Never throws on retrieval failure — degrades to
 * { contextText: null, error }.
 */
export async function retrieveSolverContext(
  params: SolverContextParams,
): Promise<SolverContextResult> {
  const { supabase, query, grade, subject, chapter, matchCount = 5 } = params;

  // Parse chapter: numeric string → chapterNumber, non-numeric → chapterTitle.
  // Mirrors the parsing in packages/lib/src/ai/retrieval/ncert-retriever.ts
  // (lines ~171-175) so both retrievers handle the same call-site shape.
  const chapterNumber: number | null =
    chapter != null && /^\d+$/.test(chapter) ? parseInt(chapter, 10) : null;
  const chapterTitle: string | null =
    chapter != null && chapterNumber === null ? chapter : null;

  let unified: ReturnType<typeof retrieve> extends Promise<infer T> ? T : never;
  try {
    unified = await retrieve({
      query,
      grade: grade as '6' | '7' | '8' | '9' | '10' | '11' | '12',
      subject,
      chapterNumber,
      chapterTitle,
      limit: matchCount,
      rerank: false,
      caller: 'ncert-solver',
      supabase,
    });
  } catch (err) {
    // retrieve() throws RetrievalError only on validation failure (programming
    // bug). The old fetchRAGContext never threw — preserve that contract and
    // degrade to empty.
    const message = err instanceof Error ? err.message : String(err);
    return { contextText: null, error: message };
  }

  if (unified.error && unified.chunks.length === 0) {
    return {
      contextText: null,
      error: `${unified.error.phase}: ${unified.error.message}`,
    };
  }

  return { contextText: formatSolverContext(unified.chunks), error: null };
}
