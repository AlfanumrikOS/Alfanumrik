/**
 * embed-diagrams -- Alfanumrik Edge Function
 *
 * Extracts diagram references from NCERT RAG content chunks, generates
 * Voyage embeddings for them, and stores them as first-class RAG chunks
 * with media_type = 'diagram'. This makes diagrams discoverable through
 * the same semantic search pipeline as text content.
 *
 * Authentication: requires `x-admin-key` header matching ADMIN_API_KEY env var.
 *
 * POST body:
 * {
 *   grade:       string   -- e.g. "Grade 10"
 *   subject:     string   -- e.g. "Science"
 *   batch_size?: number   -- chapters per batch (default 3, max 10)
 *   dry_run?:    boolean  -- if true, report what would be done without writing
 * }
 *
 * GET -- returns status: diagram chunk counts vs text chunk counts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { generateEmbedding, getEmbeddingModel } from '../_shared/embeddings.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NCERT_BOOKS_BUCKET = 'ncert-books'

const DEFAULT_BATCH_SIZE = 3
const MAX_BATCH_SIZE = 10
const MAX_EXECUTION_MS = 120_000 // 2 minutes
const INTER_CHAPTER_DELAY_MS = 500

/**
 * Regex matching diagram/figure/table references in NCERT text.
 * Captures the reference label (e.g. "Figure 10.1", "Table 3.2").
 */
const DIAGRAM_REF_PATTERN =
  /(?:Figure|Fig\.|Diagram|Activity|Table|Chart|Map|Illustration)\s*[\d]+[\.\d]*/gi

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function authenticateAdmin(req: Request): boolean {
  const adminKey = Deno.env.get('ADMIN_API_KEY')
  if (!adminKey) return false
  const provided = req.headers.get('x-admin-key')
  return provided === adminKey
}

/**
 * Build the public storage URL for a file in the ncert-books bucket.
 * Encodes path segments for URL safety.
 */
function buildStorageUrl(filePath: string): string {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable')
  }
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${supabaseUrl}/storage/v1/object/public/${NCERT_BOOKS_BUCKET}/${encodedPath}`
}

/**
 * Extract the chapter number from an NCERT PDF filename.
 * Pattern: last 2 digits before ".pdf" -> chapter number.
 * Examples: jesc101.pdf -> 1, lemh213.pdf -> 13
 */
function extractChapterFromFilename(filename: string): number | null {
  const match = filename.match(/(\d{2})\.pdf$/i)
  if (!match) return null
  return parseInt(match[1], 10)
}

/**
 * Extract all distinct diagram references from chunk text.
 * Returns array like ["Figure 10.1", "Table 3.2"].
 */
function extractDiagramRefs(text: string): string[] {
  const matches = text.match(DIAGRAM_REF_PATTERN)
  if (!matches) return []
  // Deduplicate
  return [...new Set(matches.map((m) => m.trim()))]
}

/**
 * Build a search-friendly description for a diagram reference
 * from the surrounding chunk text context.
 */
function buildDiagramDescription(
  ref: string,
  chunkText: string,
  chapterTitle: string,
  topic: string | null,
  concept: string | null,
): string {
  // Find the sentence containing the reference
  const sentences = chunkText.split(/[.!?]+/)
  const refSentence = sentences.find((s) =>
    s.toLowerCase().includes(ref.toLowerCase()),
  )

  const contextSentence = refSentence
    ? refSentence.trim()
    : `Referenced in chapter: ${chapterTitle}`

  const parts: string[] = [`${ref}`]
  if (topic) parts.push(`Topic: ${topic}`)
  if (concept) parts.push(`Concept: ${concept}`)
  parts.push(contextSentence)

  return parts.join('. ')
}

/**
 * Build the text used for generating the Voyage embedding.
 * Prefixed with "NCERT Diagram:" for search-friendly retrieval.
 */
function buildEmbeddingText(
  ref: string,
  description: string,
  grade: string,
  subject: string,
  chapterTitle: string,
): string {
  return `NCERT Diagram: ${ref}. ${grade} ${subject} - ${chapterTitle}. ${description}`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PostParams {
  grade: string
  subject: string
  batch_size?: number
  dry_run?: boolean
}

interface ChapterResult {
  chapter_number: number
  chapter_title: string
  diagrams_found: number
  chunks_created: number
  chunks_skipped: number
  source_chunks_updated: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// GET handler -- diagram embedding status
// ---------------------------------------------------------------------------

async function handleGet(origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()

  // Count total active text chunks
  const { count: totalText, error: textErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .is('media_type', null)

  if (textErr) {
    return errorResponse(`DB error: ${textErr.message}`, 500, origin)
  }

  // Count diagram chunks
  const { count: totalDiagrams, error: diagErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('media_type', 'diagram')

  if (diagErr) {
    return errorResponse(`DB error: ${diagErr.message}`, 500, origin)
  }

  // Count diagram chunks with embeddings
  const { count: diagramsWithEmbedding, error: embErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('media_type', 'diagram')
    .not('embedding', 'is', null)

  if (embErr) {
    return errorResponse(`DB error: ${embErr.message}`, 500, origin)
  }

  // Count text chunks that reference diagrams (potential sources)
  const { count: textWithDiagramRefs, error: refErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .is('media_type', null)
    .like('chunk_text', '%Figure%')

  // This is an approximation; the actual regex matching happens in the RPC
  const refCount = refErr ? null : textWithDiagramRefs

  return jsonResponse(
    {
      text_chunks: totalText ?? 0,
      diagram_chunks: totalDiagrams ?? 0,
      diagram_chunks_with_embedding: diagramsWithEmbedding ?? 0,
      text_chunks_with_diagram_refs: refCount ?? 'unknown',
      embedding_model: getEmbeddingModel(),
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// POST handler -- batch diagram embedding
// ---------------------------------------------------------------------------

async function handlePost(
  req: Request,
  origin: string | null,
): Promise<Response> {
  const supabase = getSupabaseAdmin()
  const startTime = Date.now()

  // Parse params
  let params: PostParams
  try {
    const body = await req.text()
    if (!body.trim()) {
      return errorResponse('Request body required with grade and subject', 400, origin)
    }
    params = JSON.parse(body)
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  if (!params.grade || !params.subject) {
    return errorResponse('Both "grade" and "subject" are required', 400, origin)
  }

  const batchSize = Math.min(
    Math.max(params.batch_size ?? DEFAULT_BATCH_SIZE, 1),
    MAX_BATCH_SIZE,
  )
  const dryRun = params.dry_run === true
  const embeddingModel = getEmbeddingModel()

  // -------------------------------------------------------------------------
  // Step 1: Find all text chunks with diagram references for this grade/subject
  // using the find_diagram_references RPC
  // -------------------------------------------------------------------------

  const { data: diagramRefChunks, error: rpcErr } = await supabase.rpc(
    'find_diagram_references',
    {
      p_grade: params.grade,
      p_subject: params.subject,
    },
  )

  if (rpcErr) {
    return errorResponse(`RPC find_diagram_references error: ${rpcErr.message}`, 500, origin)
  }

  if (!diagramRefChunks || diagramRefChunks.length === 0) {
    return jsonResponse(
      {
        success: true,
        dry_run: dryRun,
        grade: params.grade,
        subject: params.subject,
        total_source_chunks: 0,
        chapters_processed: 0,
        chapters: [],
        elapsed_ms: Date.now() - startTime,
        embedding_model: embeddingModel,
      },
      200,
      {},
      origin,
    )
  }

  // -------------------------------------------------------------------------
  // Step 2: Group chunks by chapter
  // -------------------------------------------------------------------------

  interface SourceChunk {
    chunk_id: string
    grade: string
    subject: string
    chapter_title: string
    chapter_number: number
    page_number: number | null
    chunk_text: string
    diagram_refs: string[]
  }

  const chapterMap = new Map<number, SourceChunk[]>()
  for (const chunk of diagramRefChunks as SourceChunk[]) {
    const chNum = chunk.chapter_number
    if (!chapterMap.has(chNum)) {
      chapterMap.set(chNum, [])
    }
    chapterMap.get(chNum)!.push(chunk)
  }

  const chapterNumbers = [...chapterMap.keys()].sort((a, b) => a - b)

  // -------------------------------------------------------------------------
  // Step 3: List PDFs in the ncert-books bucket for this grade/subject
  // -------------------------------------------------------------------------

  const bucketPath = `${params.grade}/${params.subject}`
  const { data: bucketFiles, error: storageErr } = await supabase.storage
    .from(NCERT_BOOKS_BUCKET)
    .list(bucketPath)

  // Build a map: chapter_number -> PDF storage path
  const pdfMap = new Map<number, string>()
  if (!storageErr && bucketFiles) {
    for (const file of bucketFiles) {
      if (!file.name.endsWith('.pdf')) continue
      const chNum = extractChapterFromFilename(file.name)
      if (chNum !== null) {
        pdfMap.set(chNum, `${bucketPath}/${file.name}`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Process chapters in batches
  // -------------------------------------------------------------------------

  const results: ChapterResult[] = []
  let chaptersProcessed = 0
  let totalDiagramsCreated = 0
  let totalErrors = 0

  for (const chapterNum of chapterNumbers) {
    // Time check
    if (Date.now() - startTime >= MAX_EXECUTION_MS) {
      break
    }

    // Batch limit
    if (chaptersProcessed >= batchSize) {
      break
    }

    const chunks = chapterMap.get(chapterNum)!
    const chapterTitle = chunks[0].chapter_title || `Chapter ${chapterNum}`

    // Check if diagram chunks already exist for this chapter
    const { count: existingDiagrams } = await supabase
      .from('rag_content_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('media_type', 'diagram')
      .eq('grade', chunks[0].grade)
      .eq('subject', chunks[0].subject)
      .eq('chapter_number', chapterNum)

    if (existingDiagrams && existingDiagrams > 0) {
      results.push({
        chapter_number: chapterNum,
        chapter_title: chapterTitle,
        diagrams_found: 0,
        chunks_created: 0,
        chunks_skipped: existingDiagrams,
        source_chunks_updated: 0,
        errors: [`Skipped: ${existingDiagrams} diagram chunks already exist`],
      })
      chaptersProcessed++
      continue
    }

    // Find the PDF URL for this chapter
    const pdfPath = pdfMap.get(chapterNum)
    const pdfUrl = pdfPath ? buildStorageUrl(pdfPath) : null

    const chapterResult: ChapterResult = {
      chapter_number: chapterNum,
      chapter_title: chapterTitle,
      diagrams_found: 0,
      chunks_created: 0,
      chunks_skipped: 0,
      source_chunks_updated: 0,
      errors: [],
    }

    // Process each source chunk with diagram references
    for (const chunk of chunks) {
      // Time check within chapter
      if (Date.now() - startTime >= MAX_EXECUTION_MS) {
        chapterResult.errors.push('Stopped: execution time limit reached')
        break
      }

      // Extract diagram references from chunk text
      const refs = extractDiagramRefs(chunk.chunk_text)
      if (refs.length === 0) continue

      // Fetch the full chunk record to get topic/concept for the diagram row
      const { data: fullChunk, error: fetchErr } = await supabase
        .from('rag_content_chunks')
        .select('topic, concept, chunk_index, source')
        .eq('id', chunk.chunk_id)
        .single()

      if (fetchErr || !fullChunk) {
        chapterResult.errors.push(
          `chunk ${chunk.chunk_id}: failed to fetch details: ${fetchErr?.message ?? 'not found'}`,
        )
        totalErrors++
        continue
      }

      for (const ref of refs) {
        chapterResult.diagrams_found++

        const description = buildDiagramDescription(
          ref,
          chunk.chunk_text,
          chapterTitle,
          fullChunk.topic,
          fullChunk.concept,
        )

        const chunkText = `Diagram: [${ref}] - ${description}`
        const embeddingText = buildEmbeddingText(
          ref,
          description,
          chunk.grade,
          chunk.subject,
          chapterTitle,
        )

        if (dryRun) {
          chapterResult.chunks_created++
          continue
        }

        try {
          // Generate Voyage embedding
          const embedding = await generateEmbedding(embeddingText)

          // Insert new diagram chunk
          const { error: insertErr } = await supabase
            .from('rag_content_chunks')
            .insert({
              chunk_text: chunkText,
              media_url: pdfUrl,
              media_type: 'diagram',
              media_description: description,
              embedding: JSON.stringify(embedding),
              embedded_at: new Date().toISOString(),
              embedding_model: embeddingModel,
              grade: chunk.grade,
              subject: chunk.subject,
              chapter_title: chapterTitle,
              chapter_number: chapterNum,
              topic: fullChunk.topic,
              concept: fullChunk.concept,
              chunk_index: fullChunk.chunk_index != null
                ? Math.floor(fullChunk.chunk_index) + 0.5
                : null,
              is_active: true,
              source: fullChunk.source || 'ncert_2025',
            })

          if (insertErr) {
            chapterResult.errors.push(
              `Insert diagram chunk for "${ref}": ${insertErr.message}`,
            )
            totalErrors++
          } else {
            chapterResult.chunks_created++
            totalDiagramsCreated++
          }
        } catch (embeddingErr) {
          const msg =
            embeddingErr instanceof Error
              ? embeddingErr.message
              : String(embeddingErr)
          chapterResult.errors.push(
            `Embedding failed for "${ref}": ${msg}`,
          )
          totalErrors++
        }
      }

      // Update source text chunk's media_url if we have a PDF URL
      if (pdfUrl && !dryRun) {
        const { error: updateErr } = await supabase
          .from('rag_content_chunks')
          .update({ media_url: pdfUrl })
          .eq('id', chunk.chunk_id)

        if (!updateErr) {
          chapterResult.source_chunks_updated++
        }
      } else if (dryRun) {
        chapterResult.source_chunks_updated++
      }
    }

    // Update content_media records for this chapter with the PDF URL
    if (pdfUrl && !dryRun) {
      await supabase
        .from('content_media')
        .update({ storage_url: pdfUrl })
        .eq('grade', chunks[0].grade)
        .eq('subject', chunks[0].subject)
        .eq('chapter_number', chapterNum)
        .is('storage_url', null)
    }

    results.push(chapterResult)
    chaptersProcessed++

    // Cap errors per chapter
    if (chapterResult.errors.length > 20) {
      chapterResult.errors = chapterResult.errors.slice(0, 20)
      chapterResult.errors.push('... (errors truncated)')
    }

    // Delay between chapters
    if (chaptersProcessed < batchSize) {
      await sleep(INTER_CHAPTER_DELAY_MS)
    }
  }

  return jsonResponse(
    {
      success: totalErrors === 0 || totalDiagramsCreated > 0,
      dry_run: dryRun,
      grade: params.grade,
      subject: params.subject,
      total_source_chunks: diagramRefChunks.length,
      chapters_available: chapterNumbers.length,
      chapters_processed: chaptersProcessed,
      diagrams_created: totalDiagramsCreated,
      total_errors: totalErrors,
      chapters: results,
      elapsed_ms: Date.now() - startTime,
      embedding_model: embeddingModel,
      remaining_chapters: Math.max(0, chapterNumbers.length - chaptersProcessed),
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...getCorsHeaders(origin),
        'Access-Control-Allow-Headers':
          'authorization, x-client-info, apikey, content-type, x-request-id, x-admin-key',
      },
    })
  }

  // Authenticate
  if (!authenticateAdmin(req)) {
    return errorResponse('Unauthorized: invalid or missing x-admin-key', 401, origin)
  }

  try {
    if (req.method === 'GET') {
      return await handleGet(origin)
    }

    if (req.method === 'POST') {
      return await handlePost(req, origin)
    }

    return errorResponse('Method not allowed', 405, origin)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[embed-diagrams] Unhandled error:', message)
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
