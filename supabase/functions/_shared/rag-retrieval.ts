/**
 * @deprecated Use `_shared/rag/retrieve.ts` instead. This module is a thin
 * shim over the older `_shared/retrieval.ts`. Both are kept only for
 * backward compatibility with ncert-solver and generate-answers (Phase 1
 * deferred those callers — see audit 2026-04-27 finding F10).
 *
 * New callers MUST use the unified `retrieve()` interface from
 * `_shared/rag/retrieve.ts`. Phase 2 (SQL-layer consolidation — drop
 * match_rag_chunks_v2 and match_rag_chunks) is a separate session.
 *
 * Original docstring follows.
 *
 * Shared RAG Retrieval for Alfanumrik Edge Functions — Compatibility Shim
 *
 * This file is now a thin shim. All retrieval logic lives in ./retrieval.ts.
 * Existing callers (ncert-solver, generate-answers) continue to work unchanged.
 *
 * New code should import retrieveChunks() from ./retrieval.ts directly.
 */

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchRAGContextV2 } from './retrieval.ts'

/**
 * Fetch RAG context from NCERT content chunks using vector + keyword search.
 *
 * Delegates to fetchRAGContextV2 (retrieval.ts) which uses the new
 * match_rag_chunks_v2 RPC with automatic fallback to match_rag_chunks.
 *
 * Returns null on any error (best-effort, same contract as before).
 */
export async function fetchRAGContext(
  supabase: SupabaseClient,
  query: string,
  subject: string,
  grade: string,
  chapter?: string | null,
  contentType?: string | null,
  concept?: string | null,
): Promise<string | null> {
  return fetchRAGContextV2(supabase, query, subject, grade, chapter, contentType, concept)
}
