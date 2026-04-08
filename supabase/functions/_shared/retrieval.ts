/**
 * Unified NCERT Retrieval Module
 *
 * Architecture:
 *   1. Embed query (Voyage)
 *   2. Vector search with 8 metadata filters (Supabase match_rag_chunks_v2)
 *   3. Optional reranking (Voyage rerank-2)
 *   4. Fetch linked diagram records if chunks have diagram_id
 *   5. Log retrieval trace async (Supabase retrieval_traces)
 *   6. Return structured chunks + LLM-ready context string
 *
 * Voyage = embedding + reranking only. All data served from Supabase.
 */

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateEmbedding, getEmbeddingModel, getEmbeddingCacheStats } from './embeddings.ts'
import { rerankDocuments } from './reranking.ts'

// Default syllabus version. Callers may override via RetrievalParams.syllabusVersion.
// When null, match_rag_chunks_v2 returns chunks across all versions — use the
// explicit default to prefer current-year content where both versions coexist.
const DEFAULT_SYLLABUS_VERSION = '2025-26'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrievalParams {
  supabase: SupabaseClient
  query: string
  grade: string             // P5: "6"-"12"
  subject: string
  chapterNumber?: number    // preferred over chapterText
  chapterText?: string      // legacy text filter
  concept?: string          // concept filter
  contentType?: 'content' | 'diagram' | 'qa' | null
  syllabusVersion?: string  // e.g., '2025-26'
  board?: string            // CBSE | ICSE — defaults to 'CBSE' at RPC level
  minQuality?: number       // minimum quality_score threshold (default 0.5 at RPC level)
  source?: string           // default 'NCERT'
  matchCount?: number       // chunks to return (default 5)
  candidateCount?: number   // fetch this many for reranking (default: matchCount * 3 if useReranking, else matchCount)
  useReranking?: boolean    // default false
  caller: string            // 'foxy-tutor'|'ncert-solver'|'quiz-generator'|'chapter-page'
  userId?: string           // for trace logging
  sessionId?: string        // for trace logging
  logTrace?: boolean        // default true
}

export interface DiagramRecord {
  id: string
  diagramKey: string
  title: string
  titleHi: string | null
  description: string | null
  fileUrl: string
  pageNumber: number | null
  relatedConcepts: string[]
}

export interface RetrievedChunk {
  id: string
  content: string
  chapterTitle: string
  chapterNumber: number
  topic: string
  concept: string
  conceptId: string | null
  similarity: number
  contentType: 'content' | 'diagram' | 'qa'
  pageNumber: number | null
  source: string
  syllabusVersion: string
  // diagram
  mediaUrl: string | null
  mediaType: string | null
  mediaDescription: string | null
  diagramId: string | null
  diagramRecord: DiagramRecord | null  // fetched from ncert_diagram_registry
  // Q&A
  questionText: string | null
  answerText: string | null
  questionType: string | null
  marksExpected: number | null
  bloomLevel: string | null
  ncertExercise: string | null
}

export interface RetrievalResult {
  chunks: RetrievedChunk[]
  contextText: string       // LLM-formatted string (backward compatible with fetchRAGContext)
  reranked: boolean
  embeddingModel: string
  traceId: string           // UUID of the retrieval_traces row (or '' if logging disabled)
  error: string | null      // null on success; error message if partial failure
}

// ---------------------------------------------------------------------------
// Raw RPC row shape (match_rag_chunks_v2 / match_rag_chunks)
// ---------------------------------------------------------------------------

interface RawChunkRow {
  id: string
  content: string
  chapter_title?: string
  chapter_number?: number
  topic?: string
  concept?: string
  concept_id?: string | null
  similarity?: number
  content_type?: string
  page_number?: number | null
  source?: string
  syllabus_version?: string
  media_url?: string | null
  media_type?: string | null
  media_description?: string | null
  diagram_id?: string | null
  question_text?: string | null
  answer_text?: string | null
  question_type?: string | null
  marks_expected?: number | null
  bloom_level?: string | null
  ncert_exercise?: string | null
}

// ---------------------------------------------------------------------------
// Query Preprocessing
// ---------------------------------------------------------------------------

/**
 * Preprocess student query for better semantic matching.
 * CBSE students often ask vague or very short questions — expand them with
 * grade/subject/chapter context so the embedding captures intent better.
 *
 * Also normalises common Hindi transliterations to English equivalents so
 * Hinglish queries match English-language NCERT chunks.
 */
function preprocessQuery(
  query: string,
  grade: string,
  subject: string,
  chapter?: string,
): string {
  let enriched = query.trim();

  // If query is very short (< 10 chars), it's likely a bare topic name — expand
  if (enriched.length < 10) {
    enriched = `CBSE Class ${grade} ${subject}: ${enriched}`;
  }

  // Add chapter context when available for narrower embedding match
  if (chapter) {
    enriched = `${enriched} (Chapter: ${chapter})`;
  }

  // Normalise common Hindi transliterations (minimal set — only high-frequency)
  enriched = enriched
    .replace(/\bkya\b/gi, 'what')
    .replace(/\bkaise\b/gi, 'how')
    .replace(/\bkyun\b/gi, 'why')
    .replace(/\bbatao\b/gi, 'explain')
    .replace(/\bsamjhao\b/gi, 'explain');

  return enriched;
}

// ---------------------------------------------------------------------------
// Retrieval Quality Filter
// ---------------------------------------------------------------------------

/**
 * Filter out low-quality retrieval results after vector search / reranking.
 * Combines similarity score threshold with content quality heuristics.
 */
function filterByQuality(
  chunks: RetrievedChunk[],
  minScore = 0.3,
): RetrievedChunk[] {
  return chunks.filter((chunk) => {
    // Skip if similarity is too low
    if (chunk.similarity < minScore) return false;

    // Skip if content is too short (likely a fragment)
    if (chunk.content.length < 50) return false;

    // Skip if content is mostly code/symbols (not educational text)
    // Includes Devanagari range \u0900-\u097F for Hindi content
    const alphaMatches = chunk.content.match(/[a-zA-Z\u0900-\u097F]/g);
    const alphaRatio = (alphaMatches?.length ?? 0) / chunk.content.length;
    if (alphaRatio < 0.3) return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// Context text formatter (LLM-ready, backward-compatible with fetchRAGContext)
// ---------------------------------------------------------------------------

function formatContextText(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => {
      const parts: string[] = []
      if (c.chapterTitle) parts.push(`[Chapter: ${c.chapterTitle}]`)
      if (c.topic) parts.push(`[Topic: ${c.topic}]`)
      if (c.concept) parts.push(`[Concept: ${c.concept}]`)

      if (c.contentType === 'qa' && c.questionText) {
        parts.push(`[Q&A]`)
        parts.push(`Q: ${c.questionText}`)
        parts.push(`A: ${c.answerText ?? ''}`)
      } else if (c.contentType === 'diagram' && c.diagramRecord) {
        parts.push(`[Diagram: ${c.diagramRecord.title}]`)
        if (c.diagramRecord.description) parts.push(c.diagramRecord.description)
        parts.push(c.content)
      } else {
        if (parts.length > 0) parts.push('') // blank line before content
        parts.push(c.content)
      }

      return parts.join('\n')
    })
    .join('\n\n---\n\n')
}

// ---------------------------------------------------------------------------
// Map raw RPC row → RetrievedChunk
// ---------------------------------------------------------------------------

function mapRawChunk(raw: RawChunkRow, diagramMap: Map<string, DiagramRecord>): RetrievedChunk {
  const diagramId = raw.diagram_id ?? null
  const diagramRecord = diagramId ? (diagramMap.get(diagramId) ?? null) : null

  return {
    id: raw.id,
    content: raw.content ?? '',
    chapterTitle: raw.chapter_title ?? '',
    chapterNumber: raw.chapter_number ?? 0,
    topic: raw.topic ?? '',
    concept: raw.concept ?? '',
    conceptId: raw.concept_id ?? null,
    similarity: raw.similarity ?? 0,
    contentType: (raw.content_type as 'content' | 'diagram' | 'qa') ?? 'content',
    pageNumber: raw.page_number ?? null,
    source: raw.source ?? 'NCERT',
    syllabusVersion: raw.syllabus_version ?? '',
    mediaUrl: raw.media_url ?? null,
    mediaType: raw.media_type ?? null,
    mediaDescription: raw.media_description ?? null,
    diagramId,
    diagramRecord,
    questionText: raw.question_text ?? null,
    answerText: raw.answer_text ?? null,
    questionType: raw.question_type ?? null,
    marksExpected: raw.marks_expected ?? null,
    bloomLevel: raw.bloom_level ?? null,
    ncertExercise: raw.ncert_exercise ?? null,
  }
}

// ---------------------------------------------------------------------------
// Diagram record fetcher
// ---------------------------------------------------------------------------

async function fetchDiagramRecords(
  supabase: SupabaseClient,
  diagramIds: string[],
): Promise<Map<string, DiagramRecord>> {
  const map = new Map<string, DiagramRecord>()
  if (diagramIds.length === 0) return map

  try {
    const { data, error } = await supabase
      .from('ncert_diagram_registry')
      .select('id, diagram_key, title, title_hi, description, file_url, page_number, related_concepts')
      .in('id', diagramIds)
      .eq('is_active', true)

    if (error || !data) return map

    for (const row of data) {
      map.set(row.id, {
        id: row.id,
        diagramKey: row.diagram_key ?? '',
        title: row.title ?? '',
        titleHi: row.title_hi ?? null,
        description: row.description ?? null,
        fileUrl: row.file_url ?? '',
        pageNumber: row.page_number ?? null,
        relatedConcepts: Array.isArray(row.related_concepts) ? row.related_concepts : [],
      })
    }
  } catch (err) {
    console.warn('retrieval: diagram fetch failed (non-blocking):', err instanceof Error ? err.message : String(err))
  }

  return map
}

// ---------------------------------------------------------------------------
// Retrieval trace logger (fire-and-forget)
// ---------------------------------------------------------------------------

async function logTrace(
  supabase: SupabaseClient,
  params: RetrievalParams,
  chunks: RetrievedChunk[],
  reranked: boolean,
  latencyMs: number,
): Promise<string> {
  try {
    const { data } = await supabase
      .from('retrieval_traces')
      .insert({
        user_id: params.userId ?? null,
        session_id: params.sessionId ?? null,
        caller: params.caller,
        grade: params.grade,
        subject: params.subject,
        chapter_number: params.chapterNumber ?? null,
        concept: params.concept ?? null,
        content_type: params.contentType ?? null,
        syllabus_version: params.syllabusVersion ?? null,
        query_text: params.query,
        embedding_model: getEmbeddingModel(),
        reranked,
        chunk_ids: chunks.map((c) => c.id),
        match_count: chunks.length,
        latency_ms: latencyMs,
      })
      .select('id')
      .single()

    return data?.id ?? ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Vector search — tries match_rag_chunks_v2 first, falls back to match_rag_chunks
// ---------------------------------------------------------------------------

async function runVectorSearch(
  supabase: SupabaseClient,
  params: RetrievalParams,
  effectiveQuery: string,
  queryEmbedding: number[] | null,
  fetchCount: number,
): Promise<{ data: RawChunkRow[] | null; error: unknown }> {
  // Try match_rag_chunks_v2 first (new unified RPC with all 8 filters)
  try {
    const result = await supabase.rpc('match_rag_chunks_v2', {
      query_text: effectiveQuery,
      p_subject: params.subject,
      p_grade: params.grade,
      match_count: fetchCount,
      p_chapter_number: params.chapterNumber ?? null,
      p_chapter: params.chapterText ?? null,
      p_concept: params.concept ?? null,
      p_content_type: params.contentType ?? null,
      p_source: params.source ?? 'NCERT',
      p_syllabus_version: params.syllabusVersion ?? DEFAULT_SYLLABUS_VERSION,
      p_board: params.board ?? 'CBSE',
      p_min_quality: params.minQuality ?? 0.5,
      query_embedding: queryEmbedding ? JSON.stringify(queryEmbedding) : null,
    })

    // If RPC not found (PGRST202 = function not found), fall through to legacy
    if (result.error && (result.error as { code?: string }).code === 'PGRST202') {
      console.warn('retrieval: match_rag_chunks_v2 not found, falling back to match_rag_chunks')
      throw new Error('PGRST202')
    }

    return result
  } catch (err) {
    // Fallback to legacy match_rag_chunks when v2 RPC is not yet deployed
    const errMsg = err instanceof Error ? err.message : String(err)
    if (errMsg !== 'PGRST202' && !errMsg.includes('PGRST202')) {
      // Unexpected error — propagate
      return { data: null, error: err }
    }

    // Legacy fallback
    const rpcParams: Record<string, unknown> = {
      query_text: effectiveQuery,
      p_subject: params.subject,
      p_grade: params.grade,
      match_count: fetchCount,
      p_board: params.board ?? null,           // null = no board filter on legacy (preserve backward compat)
      p_syllabus_version: params.syllabusVersion ?? DEFAULT_SYLLABUS_VERSION,
    }
    if (params.chapterText) rpcParams.p_chapter = params.chapterText
    if (params.contentType) rpcParams.p_content_type = params.contentType
    if (queryEmbedding) rpcParams.query_embedding = JSON.stringify(queryEmbedding)

    return supabase.rpc('match_rag_chunks', rpcParams)
  }
}

// ---------------------------------------------------------------------------
// Main retrieval function
// ---------------------------------------------------------------------------

/**
 * Retrieve NCERT content chunks for RAG.
 *
 * NEVER throws — returns { chunks: [], contextText: null, error: message } on failure.
 */
export async function retrieveChunks(params: RetrievalParams): Promise<RetrievalResult> {
  const startMs = Date.now()
  const finalCount = params.matchCount ?? 5
  const shouldLog = params.logTrace !== false

  try {
    // ── Step 1: Preprocess & embed query ───────────────────────────────────
    const preprocessed = preprocessQuery(
      params.query,
      params.grade,
      params.subject,
      params.chapterText,
    )
    const effectiveQuery = params.concept
      ? `${params.concept}: ${preprocessed}`
      : preprocessed

    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await generateEmbedding(effectiveQuery)
    } catch (e) {
      console.warn(
        'retrieval: embedding failed, using keyword fallback:',
        e instanceof Error ? e.message : String(e),
      )
    }

    // ── Step 2: Vector search ────────────────────────────────────────────────
    const fetchCount = params.useReranking
      ? (params.candidateCount ?? Math.min(finalCount * 3, 25))
      : finalCount

    const { data: rawChunks, error: searchError } = await runVectorSearch(
      params.supabase,
      params,
      effectiveQuery,
      queryEmbedding,
      fetchCount,
    )

    if (searchError) {
      console.warn('retrieval: vector search error:', searchError)
    }

    if (!rawChunks || rawChunks.length === 0) {
      return {
        chunks: [],
        contextText: '',
        reranked: false,
        embeddingModel: queryEmbedding ? getEmbeddingModel() : '',
        traceId: '',
        error: searchError ? String(searchError) : null,
      }
    }

    // ── Step 3: Optional Voyage reranking ────────────────────────────────────
    let reranked = false
    let selectedRaw: RawChunkRow[]

    if (params.useReranking && rawChunks.length > finalCount) {
      const documents = rawChunks.map((c) => c.content ?? '')
      const rerankResult = await rerankDocuments({ query: effectiveQuery, documents }, finalCount)
      selectedRaw = rerankResult.rankedIndices.map((i) => rawChunks[i])
      reranked = rerankResult.reranked
    } else {
      selectedRaw = rawChunks.slice(0, finalCount)
    }

    // ── Step 4: Fetch linked diagram records ─────────────────────────────────
    const diagramIds = [...new Set(
      selectedRaw.filter((c) => c.diagram_id).map((c) => c.diagram_id as string),
    )]
    const diagramMap = await fetchDiagramRecords(params.supabase, diagramIds)

    // ── Step 5: Build RetrievedChunk[] ───────────────────────────────────────
    const rawChunksMapped: RetrievedChunk[] = selectedRaw.map((raw) => mapRawChunk(raw, diagramMap))

    // ── Step 5b: Quality filter — remove low-quality results ────────────────
    const chunks = filterByQuality(rawChunksMapped)

    // ── Step 6: Format context text ──────────────────────────────────────────
    const contextText = formatContextText(chunks)

    // ── Step 7: Log retrieval trace (fire-and-forget) ────────────────────────
    const latencyMs = Date.now() - startMs
    let traceId = ''

    // Log embedding cache stats for monitoring
    const cacheStats = getEmbeddingCacheStats()
    if (cacheStats.hits + cacheStats.misses > 0 && (cacheStats.hits + cacheStats.misses) % 25 === 0) {
      console.warn(
        `retrieval: embedding cache — hitRate=${(cacheStats.hitRate * 100).toFixed(1)}% size=${cacheStats.size}`,
      )
    }

    if (shouldLog) {
      // Start logging but don't block — we'll collect the id after returning
      const tracePromise = logTrace(params.supabase, params, chunks, reranked, latencyMs)
      // Best-effort await: if this hangs it won't block the caller
      // (caller receives result immediately, trace resolves in background)
      tracePromise.then((id) => { traceId = id }).catch(() => {})
    }

    return {
      chunks,
      contextText,
      reranked,
      embeddingModel: queryEmbedding ? getEmbeddingModel() : '',
      traceId,
      error: null,
    }
  } catch (err) {
    // NEVER throw — best-effort retrieval
    const message = err instanceof Error ? err.message : String(err)
    console.error('retrieval: unexpected error:', message)
    return {
      chunks: [],
      contextText: '',
      reranked: false,
      embeddingModel: '',
      traceId: '',
      error: message,
    }
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible wrapper — drop-in replacement for fetchRAGContext()
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for fetchRAGContext() from rag-retrieval.ts
 * Returns null on failure (same contract as the original).
 */
export async function fetchRAGContextV2(
  supabase: SupabaseClient,
  query: string,
  subject: string,
  grade: string,
  chapter?: string | null,
  contentType?: string | null,
  concept?: string | null,
  caller: string = 'unknown',
): Promise<string | null> {
  const result = await retrieveChunks({
    supabase,
    query,
    subject,
    grade,
    chapterText: chapter ?? undefined,
    contentType: (contentType as 'content' | 'diagram' | 'qa' | null) ?? null,
    concept: concept ?? undefined,
    board: 'CBSE',
    caller,
    logTrace: false, // legacy callers don't supply userId/sessionId — skip trace
  })

  return result.contextText || null
}
