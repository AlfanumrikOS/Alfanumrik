/**
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
