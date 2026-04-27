// supabase/functions/grounded-answer/retrieval.ts
// Retrieval + scope verification adapter.
//
// As of audit F10 (2026-04-27 production-readiness), the canonical RPC
// retrieval contract lives in `../_shared/rag/retrieve.ts`. This file is now
// a thin adapter that:
//   1. Delegates the RPC call to the unified `retrieve()` module (Phase 1
//      consolidation — keeps every caller on a single source of truth for
//      `match_rag_chunks_ncert` parameter shape).
//   2. Maps the unified RetrievalChunk shape to grounded-answer's local
//      `RetrievedChunk` shape (keeps pipeline.ts unchanged).
//   3. Preserves the existing TS-side similarity-floor filter (callers like
//      pipeline.ts rely on the floor being applied here, not just RPC-side,
//      because stubs in tests bypass the RPC's quality filter).
//
// Contract (UNCHANGED from pre-F10 implementation):
//   - Never throws. RPC errors return empty chunks + 0 drops.
//   - chapter_number is passed as INTEGER to the RPC (never stringified) —
//     the RPC signature is `p_chapter_number INTEGER DEFAULT NULL` and
//     comparing int-to-string inside postgres throws.
//   - When scope.chapter_number is null we ran subject-wide retrieval;
//     we MUST NOT drop rows on chapter mismatch because the caller
//     explicitly asked for any chapter in the subject.
//   - Similarity floor filtering happens here, NOT counted as scope drops.

import { retrieve, type RetrievalChunk as UnifiedChunk } from '../_shared/rag/retrieve.ts';

export interface RetrievedChunk {
  id: string;
  content: string;
  chapter_number: number;
  chapter_title: string;
  page_number: number | null;
  similarity: number;
  media_url: string | null;
  media_description: string | null;
}

export interface RetrievalScope {
  grade: string;
  subject_code: string;
  chapter_number: number | null;
  chapter_title: string | null;
}

export interface RetrievalParams {
  query: string;
  embedding: number[] | null;
  scope: RetrievalScope;
  matchCount: number;
  minSimilarity: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  scopeDrops: number;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export async function retrieveChunks(
  sb: SupabaseLike,
  params: RetrievalParams,
): Promise<RetrievalResult> {
  const { query, embedding, scope, matchCount, minSimilarity } = params;

  // Validate grade as a P5 string at the boundary. The unified retrieve()
  // throws RetrievalError on validation failure — that's a programming bug,
  // not a runtime degrade, but pipeline.ts depends on this layer being
  // best-effort. Catch and degrade to empty.
  let unified;
  try {
    unified = await retrieve({
      query,
      grade: scope.grade as '6' | '7' | '8' | '9' | '10' | '11' | '12',
      subject: scope.subject_code,
      chapterNumber: scope.chapter_number,
      chapterTitle: scope.chapter_title,
      limit: matchCount,
      minSimilarity,
      // Defer reranking to the pipeline (it manages over-fetch + Voyage call).
      rerank: false,
      caller: 'grounded-answer',
      embedding,
      supabase: sb,
    });
  } catch (err) {
    console.warn(`retrieval: unified retrieve threw — ${String(err)}`);
    return { chunks: [], scopeDrops: 0 };
  }

  if (unified.error) {
    // Embedding-only errors with non-empty chunks are soft; retrieval errors
    // surface as empty results. The unified module sets error on either case
    // when chunks is empty, which matches the legacy contract.
    if (unified.chunks.length === 0) {
      console.warn(
        `retrieval: ${unified.error.phase} — ${unified.error.message}`,
      );
      return { chunks: [], scopeDrops: 0 };
    }
  }

  // TS-side similarity floor — preserved from the legacy implementation
  // because tests stub the RPC and bypass the DB-side `p_min_quality`
  // filter. Floor failures are NOT scope drops (they're an expected filter,
  // per the original retrieval.test.ts contract).
  const chunks: RetrievedChunk[] = [];
  for (const c of unified.chunks) {
    if (c.similarity < minSimilarity) continue;
    chunks.push(adaptChunk(c));
  }

  return { chunks, scopeDrops: unified.scope_drops };
}

function adaptChunk(c: UnifiedChunk): RetrievedChunk {
  return {
    id: c.chunk_id,
    content: c.content ?? '',
    chapter_number: c.chapter_number ?? 0,
    chapter_title: c.chapter_title ?? '',
    page_number: c.page_number ?? null,
    similarity: c.similarity,
    media_url: c.media_url ?? null,
    media_description: c.media_description ?? null,
  };
}
