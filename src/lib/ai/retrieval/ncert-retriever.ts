/**
 * NCERT Content Retrieval Module
 *
 * Unified retrieval layer for RAG-powered AI features.
 * Wraps the match_rag_chunks RPC with Voyage AI embedding generation.
 *
 * Used by: foxy-tutor workflow, ncert-solver workflow, quiz-generator.
 * Server-side only (uses supabaseAdmin).
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import type { RetrievalQuery, RetrievedChunk, RetrievalResult } from '../types';
import { getAIConfig } from '../config';

// ─── Embedding Generation ──────────────────────────────────────────────────

/**
 * Generate a vector embedding via the Voyage AI API.
 * Returns null on any failure (missing key, network error, bad response).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const config = getAIConfig();
  if (!config.voyageApiKey) {
    logger.warn('ncert_retriever_no_voyage_key', {
      message: 'VOYAGE_API_KEY not configured — skipping embedding generation',
    });
    return null;
  }

  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.voyageApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.embeddingModel,
        input: [text],
        output_dimension: config.embeddingDimension,
      }),
    });

    if (!res.ok) {
      logger.warn('ncert_retriever_voyage_http_error', { status: res.status });
      return null;
    }

    const body = await res.json();
    return body?.data?.[0]?.embedding ?? null;
  } catch (err) {
    logger.warn('ncert_retriever_voyage_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Chunk Retrieval ───────────────────────────────────────────────────────

/**
 * Retrieve NCERT content chunks matching a query via the match_rag_chunks RPC.
 *
 * Pipeline:
 *  1. Build an enriched query string (subject + grade + chapter + user query)
 *  2. Generate a Voyage embedding for semantic search
 *  3. Call match_rag_chunks with embedding + keyword filters
 *  4. Map raw rows to RetrievedChunk[]
 *  5. Format contextText for LLM prompt injection
 *
 * Never throws — returns an empty result with an error message on failure.
 */
export async function retrieveNcertChunks(query: RetrievalQuery): Promise<RetrievalResult> {
  const config = getAIConfig();
  const matchCount = query.matchCount ?? config.ragMatchCount;
  const minQuality = query.minQuality ?? config.ragMinQuality;

  try {
    // Build enriched query for better embedding relevance
    const enrichedQuery = [
      query.subject,
      `grade ${query.grade}`,
      query.chapter ? `chapter ${query.chapter}` : null,
      query.query,
    ]
      .filter(Boolean)
      .join(': ');

    const embedding = await generateEmbedding(enrichedQuery);

    // NCERT-pinned RPC: hardcodes source='ncert_2025' so no non-NCERT chunk
    // can ever surface. subject_code (snake_case) and grade_short (P5) are
    // the canonical RAG join keys; the V1 Title-Case CASE statement is gone.
    // p_chapter is parsed as an integer when possible (RPC accepts either
    // chapter_number int or chapter_title string).
    const chapterArg: string | null = query.chapter ?? null;
    const chapterNum: number | null =
      chapterArg && /^\d+$/.test(chapterArg) ? parseInt(chapterArg, 10) : null;
    const chapterTitle: string | null =
      chapterArg && chapterNum === null ? chapterArg : null;

    const { data: rows, error: rpcError } = await supabaseAdmin.rpc('match_rag_chunks_ncert', {
      query_text:        enrichedQuery,
      p_subject_code:    query.subject,
      p_grade:           query.grade,
      match_count:       matchCount,
      p_chapter_number:  chapterNum,
      p_chapter_title:   chapterTitle,
      p_min_quality:     minQuality,
      query_embedding:   embedding,
    });

    if (rpcError) {
      logger.warn('ncert_retriever_rpc_error', {
        error: rpcError.message,
        subject: query.subject,
        grade: query.grade,
      });
      return { chunks: [], contextText: '', error: rpcError.message };
    }

    // Map raw DB rows to typed chunks. Note: the RPC returns `chapter_title`
    // and `chapter_number` (not `chapter`) — the previous mapper read
    // `row.chapter` and silently produced undefined for every chunk. Fixed.
    const chunks: RetrievedChunk[] = (rows ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ''),
      content: String(row.content ?? ''),
      subject: String(row.subject ?? query.subject),
      chapter:
        row.chapter_title != null
          ? String(row.chapter_title)
          : row.chapter_number != null
            ? `Chapter ${row.chapter_number}`
            : undefined,
      pageNumber: typeof row.page_number === 'number' ? row.page_number : undefined,
      similarity: typeof row.similarity === 'number' ? row.similarity : 0,
      contentType: row.content_type != null ? String(row.content_type) : undefined,
      mediaUrl: typeof row.media_url === 'string' ? row.media_url : null,
      mediaDescription: typeof row.media_description === 'string' ? row.media_description : null,
    }));

    // Format LLM-ready context string
    const contextText = formatContextText(chunks);

    return { chunks, contextText, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('ncert_retriever_unexpected_error', {
      error: message,
      subject: query.subject,
      grade: query.grade,
    });
    return { chunks: [], contextText: '', error: message };
  }
}

// ─── Context Formatting ───────────────────────────────────────────────────

/**
 * Format retrieved chunks into a numbered reference string for LLM prompts.
 */
function formatContextText(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';

  return chunks
    .map((chunk, i) => {
      const meta: string[] = [];
      if (chunk.chapter) meta.push(`Chapter: ${chunk.chapter}`);
      if (chunk.pageNumber) meta.push(`p.${chunk.pageNumber}`);
      const header = meta.length > 0 ? ` (${meta.join(', ')})` : '';
      let text = `[${i + 1}]${header}\n${chunk.content}`;
      // Notify the LLM that a diagram is available for this chunk
      if (chunk.mediaUrl) {
        const desc = chunk.mediaDescription || `NCERT ${chunk.chapter || 'figure'}`;
        text += `\n[Diagram available: ${desc}${chunk.pageNumber ? ` - see attached figure from NCERT page ${chunk.pageNumber}` : ''}]`;
      }
      return text;
    })
    .join('\n\n');
}
