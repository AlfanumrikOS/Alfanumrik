/**
 * Shared RAG Retrieval for Alfanumrik Edge Functions
 *
 * Used by foxy-tutor, ncert-solver, and generate-answers to fetch
 * NCERT content chunks via vector + keyword search.
 *
 * Best-effort: returns null on any error so callers can proceed
 * without RAG context gracefully.
 */

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateEmbedding } from './embeddings.ts'

/**
 * Fetch RAG context from NCERT content chunks using vector + keyword search.
 *
 * 1. Tries to generate a query embedding via generateEmbedding (with try/catch fallback)
 * 2. Calls match_rag_chunks RPC with query_embedding, query_text, p_subject, p_grade, match_count: 5, p_chapter
 * 3. Formats results as [Chapter: title]\ncontent joined by \n\n---\n\n
 * 4. Returns null on any error (best-effort)
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
  try {
    // When a CME-recommended concept is provided, prepend it to the query so
    // vector search preferentially retrieves chunks for that specific concept.
    const effectiveQuery = concept ? `${concept}: ${query}` : query

    // Attempt to generate a query embedding for vector-based retrieval.
    // If embedding generation fails (API key missing, provider down, etc.),
    // fall back to keyword-only search.
    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await generateEmbedding(effectiveQuery)
    } catch (embeddingErr) {
      // Embedding unavailable — proceed with keyword-only search
      console.warn(
        'Embedding generation failed, falling back to keyword search:',
        embeddingErr instanceof Error ? embeddingErr.message : String(embeddingErr),
      )
    }

    // Choose retrieval strategy:
    // - hybrid_rag_search: Reciprocal Rank Fusion (vector 0.7 + FTS 0.3) — best quality,
    //   requires embedding, no content_type filter support.
    // - match_rag_chunks: supports content_type filtering, works without embedding.
    const useHybrid = !!queryEmbedding && !contentType

    let data: Array<{
      content: string
      chapter_title?: string
      topic?: string
      concept?: string
      media_url?: string
      content_type?: string
    }> | null = null
    let error: unknown = null

    if (useHybrid) {
      const result = await supabase.rpc('hybrid_rag_search', {
        query_text: effectiveQuery,
        query_embedding: JSON.stringify(queryEmbedding),
        p_subject: subject,
        p_grade: grade,
        ...(chapter ? { p_chapter: chapter } : {}),
        match_count: 5,
        vector_weight: 0.7,
        text_weight: 0.3,
      })
      data = result.data
      error = result.error
    } else {
      const rpcParams: Record<string, unknown> = {
        query_text: effectiveQuery,
        p_subject: subject,
        p_grade: grade,
        match_count: 5,
      }
      if (chapter) rpcParams.p_chapter = chapter
      if (contentType) rpcParams.p_content_type = contentType
      if (queryEmbedding) rpcParams.query_embedding = JSON.stringify(queryEmbedding)

      const result = await supabase.rpc('match_rag_chunks', rpcParams)
      data = result.data
      error = result.error
    }

    if (error || !data || data.length === 0) return null

    return data
      .map((c) => {
        const parts: string[] = []
        if (c.chapter_title) parts.push(`[Chapter: ${c.chapter_title}]`)
        if (c.topic) parts.push(`[Topic: ${c.topic}]`)
        if (c.concept) parts.push(`[Concept: ${c.concept}]`)
        if (parts.length > 0) parts.push('')  // blank line before content
        parts.push(c.content)
        return parts.join('\n')
      })
      .join('\n\n---\n\n')
  } catch {
    // RAG not available — proceed without context
    return null
  }
}
