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
): Promise<string | null> {
  try {
    // Attempt to generate a query embedding for vector-based retrieval.
    // If embedding generation fails (API key missing, provider down, etc.),
    // fall back to keyword-only search.
    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await generateEmbedding(query)
    } catch (embeddingErr) {
      // Embedding unavailable — proceed with keyword-only search
      console.warn(
        'Embedding generation failed, falling back to keyword search:',
        embeddingErr instanceof Error ? embeddingErr.message : String(embeddingErr),
      )
    }

    const rpcParams: Record<string, unknown> = {
      query_text: query,
      p_subject: subject,
      p_grade: grade,
      match_count: 5,
    }

    if (chapter) {
      rpcParams.p_chapter = chapter
    }

    // Pass embedding as JSON string when available (Supabase casts to vector type)
    if (queryEmbedding) {
      rpcParams.query_embedding = JSON.stringify(queryEmbedding)
    }

    const { data, error } = await supabase.rpc('match_rag_chunks', rpcParams)
    if (error || !data || data.length === 0) return null

    return data
      .map((c: { content: string; chapter_title?: string }) => {
        const prefix = c.chapter_title ? `[Chapter: ${c.chapter_title}]\n` : ''
        return `${prefix}${c.content}`
      })
      .join('\n\n---\n\n')
  } catch {
    // RAG not available — proceed without context
    return null
  }
}
