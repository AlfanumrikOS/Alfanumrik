/**
 * NCERT Content Retrieval Module
 *
 * Unified retrieval layer for RAG-powered AI features.
 * Wraps the match_rag_chunks RPC with Voyage AI embedding generation.
 *
 * Used by: foxy-tutor LEGACY cold path (runLegacyFoxyFlow when
 * `ff_grounded_ai_foxy=false`), ncert-solver workflow, quiz-generator.
 * Server-side only (uses supabaseAdmin).
 *
 * IMPORTANT — for Foxy this is the kill-switch fallback documented in
 * docs/runbooks/ai-outage-response.md. The primary path lives in
 * supabase/functions/grounded-answer/. Audit 2026-05-10 calibrated this
 * retriever's similarity floor for the RRF scale (config.ts:ragMinQuality,
 * default 0.005) so the kill switch produces real chunks when flipped —
 * pre-audit it would have filtered every match using a cosine-scale 0.4
 * floor. Circuit breaker / abstain / grounding-check parity with the
 * grounded-answer service is intentionally NOT implemented here; if the
 * legacy path becomes load-bearing again, lift those features in a
 * dedicated hardening PR rather than copying piecemeal.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import type { RetrievalQuery, RetrievedChunk, RetrievalResult } from '../types';
import { getAIConfig } from '../config';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { applyGoalRerank } from '@alfanumrik/lib/goals/rag-source-weights';
import { isKnownGoalCode, type GoalCode } from '@alfanumrik/lib/goals/goal-profile';

// ─── RPC relevance/quality parameters — DECOUPLED (2026-07-27) ─────────────
//
// `match_rag_chunks_ncert` exists in production as TWO overloads (a
// `CREATE OR REPLACE` with a changed signature OVERLOADS, it does not replace):
//   - OLD (baseline, oid 201818): takes `p_min_quality`. Its vector CTE has NO
//     absolute cosine floor — just `ORDER BY embedding <=> query_embedding`.
//   - NEW (migration 20260707010000_rca_final_fixes.sql, oid 359405): takes
//     `p_quality_score_gate` + `p_min_similarity`, and its vector CTE HAS
//     `AND 1 - (embedding <=> query_embedding) >= p_min_similarity`.
//
// This retriever used to send `p_min_quality: minQuality`, which bound
// PostgREST to the OLD overload (leaving the cosine floor dead code) AND fed a
// similarity-scale number into a content `quality_score` gate. Both parameters
// are now sent explicitly and separately. PostgREST resolves overloads by
// argument NAME, so sending both distinguishing args is also what makes the
// call unambiguous — a call carrying neither matches BOTH overloads and errors.
//
// These MUST stay in sync with the identically-named constants in
// `supabase/functions/_shared/rag/retrieve.ts` (the primary grounded-answer
// path); this module is only the `ff_grounded_ai_foxy=false` cold path.

/**
 * Absolute cosine relevance floor → RPC `p_min_similarity`.
 *
 * MEASURED on the production corpus (chunk-embedding proxy: short 36-token
 * anchors scored against full chunks):
 *
 *   floor | rank-1 survives | rank-10 | rank-20
 *   ------|-----------------|---------|--------
 *   0.50  |      90.0%      |  62.5%  |  37.5%   ← the RPC's own DEFAULT: unsafe
 *   0.35  |      97.5%      |  97.5%  |  97.5%   ← hard ceiling, do not exceed
 *   0.25  |     100.0%      | 100.0%  |  97.5%
 *
 * Within-chapter chunk-pair cosine median is 0.554, so a 0.5 floor rejects
 * ~35% of genuinely same-chapter content. Cross-subject noise band p95 = 0.346.
 * Real student queries are median 8 words — SHORTER than the 36-token anchors,
 * so the true recall penalty of a high floor is worse than measured. 0.22 sits
 * inside the recommended 0.20–0.25 band: above random-pair noise, far below the
 * 0.554 within-chapter median. DO NOT exceed 0.35; DO NOT fall back to the
 * RPC's 0.5 default. Any change requires re-running the measurement above.
 */
export const NCERT_MIN_COSINE_SIMILARITY = 0.22;

/**
 * Content-quality gate → RPC `p_quality_score_gate`.
 *
 * SQL predicate: `(quality_score IS NULL OR quality_score >= gate)`. Measured
 * on production: 27,778 chunks, 68% `quality_score IS NULL`, every populated
 * value exactly 0.7 — so 0.4 is a NO-OP today. It is passed separately and
 * correctly so it starts working once quality scores are backfilled, and so it
 * can never again be fed a similarity threshold.
 */
export const NCERT_QUALITY_SCORE_GATE = 0.4;

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
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): delete ncert-retriever when Foxy flag ff_foxy_grounded_only flips on and legacy retriever is no longer called.
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
  // `query.minQuality` / `config.ragMinQuality` (0.005) are RRF-scale values
  // and are deliberately NOT sent to the RPC any more: routing them to
  // `p_min_similarity` would set the ABSOLUTE COSINE floor to ~0.005 (i.e. no
  // floor), and routing them to `p_quality_score_gate` is the exact
  // similarity/quality conflation this change removes.

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

    // eslint-disable-next-line alfanumrik/no-direct-rag-rpc -- TODO(phase-4-cleanup): delete ncert-retriever when Foxy flag ff_foxy_grounded_only defaults to true; grounded-answer service calls match_rag_chunks_ncert internally.
    const { data: rows, error: rpcError } = await supabaseAdmin.rpc('match_rag_chunks_ncert', {
      query_text:        enrichedQuery,
      p_subject_code:    query.subject,
      p_grade:           query.grade,
      match_count:       matchCount,
      p_chapter_number:  chapterNum,
      p_chapter_title:   chapterTitle,
      // Both args are unique to the NEW overload — sending them is what binds
      // PostgREST to the signature that actually applies the cosine floor.
      // NEVER send `p_min_quality`: it rebinds to the stale floor-less overload
      // AND conflates similarity with content quality.
      p_quality_score_gate: NCERT_QUALITY_SCORE_GATE,
      p_min_similarity:     NCERT_MIN_COSINE_SIMILARITY,
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
      source: typeof row.source === 'string' ? row.source : null,
      examRelevance: Array.isArray(row.exam_relevance) ? row.exam_relevance.filter((t: unknown): t is string => typeof t === 'string') : null,
    }));

    // Phase 4 (Goal-Adaptive Layers): when ff_goal_aware_rag is on AND a
    // known goal is supplied via query.academicGoal, re-rank chunks by
    // similarity * source-weight (see src/lib/goals/rag-source-weights.ts).
    // Default OFF preserves byte-identical legacy ordering.
    let finalChunks = chunks;
    if (isKnownGoalCode(query.academicGoal)) {
      const goalRerankOn = await isFeatureEnabled('ff_goal_aware_rag', {
        role: 'student',
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
      });
      if (goalRerankOn) {
        finalChunks = applyGoalRerank(chunks, query.academicGoal as GoalCode);
        logger.info('ncert_retriever_goal_rerank_applied', {
          goalCode: query.academicGoal,
          chunkCount: finalChunks.length,
          subject: query.subject,
          grade: query.grade,
        });
      }
    }

    // Format LLM-ready context string
    const contextText = formatContextText(finalChunks);

    return { chunks: finalChunks, contextText, error: null };
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
