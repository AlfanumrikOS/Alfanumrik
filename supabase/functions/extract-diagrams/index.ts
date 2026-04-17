/**
 * extract-diagrams – Alfanumrik Edge Function
 *
 * Extracts diagram/figure references from NCERT RAG content chunks and
 * creates content_media records linking to the source PDFs. Optionally
 * generates educational captions and alt-text using Claude Haiku.
 *
 * Authentication: requires `x-admin-key` header matching ADMIN_API_KEY env var.
 *
 * POST body:
 * {
 *   grade:              string   – e.g. "Grade 10"
 *   subject:            string   – e.g. "Science"
 *   batch_size?:        number   – chunks per batch (default 50, max 200)
 *   generate_captions?: boolean  – use Claude to generate captions/alt_text (default false)
 *   dry_run?:           boolean  – preview without inserting (default false)
 * }
 *
 * GET – returns extraction progress: diagram count per grade/subject vs total PDFs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BATCH_SIZE = 200
const DEFAULT_BATCH_SIZE = 50
const MAX_EXECUTION_MS = 120_000 // 2 minutes — stay under 150s gateway timeout
const INTER_BATCH_DELAY_MS = 100
const CAPTION_BATCH_SIZE = 10 // Claude calls per batch when generating captions

// Regex patterns for diagram/figure references in NCERT text
const DIAGRAM_PATTERNS = [
  /(?:Figure|Fig\.)\s*(\d+[\.\d]*)/gi,
  /(?:Diagram)\s*(\d+[\.\d]*)/gi,
  /(?:Activity)\s*(\d+[\.\d]*)/gi,
  /(?:Table)\s*(\d+[\.\d]*)/gi,
  /(?:Chart)\s*(\d+[\.\d]*)/gi,
  /(?:Map)\s*(\d+[\.\d]*)/gi,
  /(?:Illustration)\s*(\d+[\.\d]*)/gi,
]

// Combined pattern for SQL query (used in the RPC, but also useful client-side)
const COMBINED_PATTERN = /(?:Figure|Fig\.|Diagram|Activity|Table|Chart|Map|Illustration)\s*(\d+[\.\d]*)/gi

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
 * Extract all diagram/figure references from a chunk of text.
 * Returns deduplicated array of reference strings like "Figure 2.1", "Table 3.4".
 */
function extractDiagramRefs(text: string): string[] {
  const refs: Set<string> = new Set()
  for (const pattern of DIAGRAM_PATTERNS) {
    // Reset lastIndex for each pattern (global flag)
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      // Normalize the reference label
      const fullMatch = match[0].trim()
      refs.add(fullMatch)
    }
  }
  return Array.from(refs)
}

/**
 * Parse the chapter number from a PDF filename.
 * Expected formats: jesc101.pdf, lemh201.pdf, etc.
 * The numeric suffix before .pdf typically encodes chapter: last 2 digits.
 */
function parseChapterFromFilename(filename: string): number | null {
  // Try pattern: any prefix followed by digits, last 2 digits = chapter
  const match = filename.match(/(\d{2,3})\.pdf$/i)
  if (match) {
    const digits = match[1]
    // Last 2 digits are chapter number (e.g., "101" -> chapter 01, "213" -> chapter 13)
    const chapterStr = digits.length >= 2 ? digits.slice(-2) : digits
    const chapter = parseInt(chapterStr, 10)
    if (chapter > 0 && chapter <= 30) return chapter
  }
  return null
}

/**
 * Build a storage URL for a PDF in the ncert-books bucket.
 * Format: Grade X/Subject/BookName/chapterXX.pdf
 */
function buildPdfStorageUrl(supabaseUrl: string, storagePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/ncert-books/${encodeURIComponent(storagePath)}`
}

/**
 * Extract surrounding context for a diagram reference within chunk text.
 * Returns up to ~300 chars around the reference for caption generation.
 */
function extractContext(text: string, ref: string): string {
  const idx = text.toLowerCase().indexOf(ref.toLowerCase())
  if (idx === -1) return text.slice(0, 300)
  const start = Math.max(0, idx - 150)
  const end = Math.min(text.length, idx + ref.length + 150)
  return text.slice(start, end)
}

// ---------------------------------------------------------------------------
// Caption generation via Claude Haiku
// ---------------------------------------------------------------------------

interface CaptionResult {
  caption: string
  alt_text: string
}

async function generateCaptionsForRefs(
  refs: Array<{ ref: string; context: string; grade: string; subject: string }>,
): Promise<CaptionResult[]> {
  const claudeKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!claudeKey) {
    // Fallback: use context-based captions without LLM
    return refs.map((r) => ({
      caption: r.ref,
      alt_text: `${r.ref} from CBSE ${r.grade} ${r.subject} textbook`,
    }))
  }

  const systemPrompt = `You are an educational content assistant for CBSE students (grades 6-12).
For each diagram/figure reference, generate:
1. A concise caption (1 sentence, what the diagram shows)
2. An accessible alt_text description (1-2 sentences, for visually impaired students)

Stay within CBSE curriculum scope. Be factual and educational.
Respond as a JSON array matching the input order. Each element: {"caption": "...", "alt_text": "..."}`

  const userContent = refs
    .map(
      (r, i) =>
        `[${i}] ${r.ref} (${r.grade}, ${r.subject})\nContext: "${r.context}"`,
    )
    .join('\n\n')

  try {
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): extract-diagrams is ingestion/content preparation, not student-facing. Exempt from grounded-answer routing.
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        temperature: 0.3, // Factual output
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!aiRes.ok) {
      console.error('[extract-diagrams] Claude API error:', aiRes.status)
      return refs.map((r) => ({
        caption: r.ref,
        alt_text: `${r.ref} from CBSE ${r.grade} ${r.subject} textbook`,
      }))
    }

    const aiData = await aiRes.json()
    const responseText = aiData.content?.[0]?.text || ''

    // Parse JSON from response (may be wrapped in markdown code block)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as CaptionResult[]
      // Validate and ensure correct count
      if (Array.isArray(parsed) && parsed.length === refs.length) {
        return parsed.map((p) => ({
          caption: typeof p.caption === 'string' ? p.caption : refs[0].ref,
          alt_text:
            typeof p.alt_text === 'string'
              ? p.alt_text
              : `Diagram from CBSE textbook`,
        }))
      }
    }
  } catch (err) {
    console.error('[extract-diagrams] Caption generation failed:', err)
  }

  // Fallback
  return refs.map((r) => ({
    caption: r.ref,
    alt_text: `${r.ref} from CBSE ${r.grade} ${r.subject} textbook`,
  }))
}

// ---------------------------------------------------------------------------
// GET handler – extraction status overview
// ---------------------------------------------------------------------------

async function handleGet(origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()

  // Count existing content_media records
  const { count: totalMedia, error: mediaErr } = await supabase
    .from('content_media')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  if (mediaErr) {
    return errorResponse(`DB error: ${mediaErr.message}`, 500, origin)
  }

  // Breakdown by grade and subject
  const { data: breakdown, error: breakdownErr } = await supabase
    .from('content_media')
    .select('grade, subject')
    .eq('is_active', true)

  // Aggregate manually since Supabase JS doesn't support GROUP BY easily
  const byGradeSubject: Record<string, number> = {}
  if (!breakdownErr && breakdown) {
    for (const row of breakdown) {
      const key = `${row.grade} / ${row.subject}`
      byGradeSubject[key] = (byGradeSubject[key] || 0) + 1
    }
  }

  // Count RAG chunks with diagram references (approximate via text pattern)
  const { count: chunksWithRefs, error: chunkErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .or(
      'chunk_text.ilike.%Figure %,' +
        'chunk_text.ilike.%Fig. %,' +
        'chunk_text.ilike.%Diagram %,' +
        'chunk_text.ilike.%Activity %,' +
        'chunk_text.ilike.%Table %',
    )

  return jsonResponse(
    {
      total_media_records: totalMedia ?? 0,
      rag_chunks_with_diagram_refs: chunksWithRefs ?? 0,
      breakdown_by_grade_subject: byGradeSubject,
      chunks_query_error: chunkErr?.message || null,
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// POST handler – batch extraction
// ---------------------------------------------------------------------------

interface PostParams {
  grade: string
  subject: string
  batch_size?: number
  generate_captions?: boolean
  dry_run?: boolean
}

interface DiagramRecord {
  grade: string
  subject: string
  chapter_number: number | null
  chapter_title: string | null
  page_number: number | null
  caption: string
  alt_text: string
  media_type: string
  storage_path: string | null
  storage_url: string | null
  source: string
  source_book: string | null
  is_active: boolean
}

async function handlePost(
  req: Request,
  origin: string | null,
): Promise<Response> {
  const supabase = getSupabaseAdmin()
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const startTime = Date.now()

  // Parse params
  let params: PostParams
  try {
    params = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  if (!params.grade || !params.subject) {
    return errorResponse('grade and subject are required', 400, origin)
  }

  const batchSize = Math.min(
    Math.max(params.batch_size ?? DEFAULT_BATCH_SIZE, 1),
    MAX_BATCH_SIZE,
  )
  const generateCaptions = params.generate_captions === true
  const dryRun = params.dry_run === true

  // Track results
  let totalChunksScanned = 0
  let totalRefsFound = 0
  let totalRecordsInserted = 0
  let totalDuplicatesSkipped = 0
  const errors: string[] = []
  const previewRecords: DiagramRecord[] = []

  // Track unique diagram refs to avoid duplicates
  // Key: "{grade}|{subject}|{chapter}|{ref}"
  const seenRefs: Set<string> = new Set()

  // Load existing content_media for this grade/subject to skip duplicates
  const { data: existingMedia } = await supabase
    .from('content_media')
    .select('grade, subject, chapter_number, caption')
    .eq('grade', params.grade)
    .eq('subject', params.subject)
    .eq('is_active', true)

  if (existingMedia) {
    for (const m of existingMedia) {
      const key = `${m.grade}|${m.subject}|${m.chapter_number || 0}|${m.caption || ''}`
      seenRefs.add(key)
    }
  }

  // Process chunks in batches via direct query (since RPC may not exist yet)
  let offset = 0

  while (true) {
    // Time check
    if (Date.now() - startTime >= MAX_EXECUTION_MS) {
      errors.push('Stopped: approaching execution time limit')
      break
    }

    // Fetch batch of chunks with diagram references
    const { data: chunks, error: fetchErr } = await supabase
      .from('rag_content_chunks')
      .select(
        'id, grade, subject, chapter_title, chapter_number, page_number, chunk_text, source_file',
      )
      .eq('is_active', true)
      .eq('grade', params.grade)
      .eq('subject', params.subject)
      .or(
        'chunk_text.ilike.%Figure %,' +
          'chunk_text.ilike.%Fig. %,' +
          'chunk_text.ilike.%Diagram %,' +
          'chunk_text.ilike.%Activity %,' +
          'chunk_text.ilike.%Table %,' +
          'chunk_text.ilike.%Chart %,' +
          'chunk_text.ilike.%Map %,' +
          'chunk_text.ilike.%Illustration %',
      )
      .order('chapter_number', { ascending: true })
      .order('page_number', { ascending: true, nullsFirst: false })
      .range(offset, offset + batchSize - 1)

    if (fetchErr) {
      errors.push(`Fetch error at offset ${offset}: ${fetchErr.message}`)
      break
    }

    if (!chunks || chunks.length === 0) {
      break // No more chunks
    }

    totalChunksScanned += chunks.length

    // Extract diagram references from each chunk
    const recordsToInsert: DiagramRecord[] = []
    const captionInputs: Array<{
      ref: string
      context: string
      grade: string
      subject: string
      recordIndex: number
    }> = []

    for (const chunk of chunks) {
      const text = chunk.chunk_text || ''
      const refs = extractDiagramRefs(text)

      for (const ref of refs) {
        totalRefsFound++

        // Dedup key
        const chapterNum = chunk.chapter_number || 0
        const dedupeKey = `${params.grade}|${params.subject}|${chapterNum}|${ref}`
        if (seenRefs.has(dedupeKey)) {
          totalDuplicatesSkipped++
          continue
        }
        seenRefs.add(dedupeKey)

        // Build storage path reference to source PDF
        const sourceFile = chunk.source_file || null
        let storagePath: string | null = null
        let storageUrl: string | null = null
        let sourceBook: string | null = null

        if (sourceFile) {
          // source_file might be the PDF filename or full path
          storagePath = sourceFile.includes('/')
            ? sourceFile
            : `${params.grade}/${params.subject}/${sourceFile}`
          storageUrl = buildPdfStorageUrl(supabaseUrl, storagePath)
          // Extract book name from path
          const pathParts = storagePath.split('/')
          if (pathParts.length >= 3) {
            sourceBook = pathParts[pathParts.length - 2] || params.subject
          }
        }

        const record: DiagramRecord = {
          grade: params.grade,
          subject: params.subject,
          chapter_number: chunk.chapter_number || null,
          chapter_title: chunk.chapter_title || null,
          page_number: chunk.page_number || null,
          caption: ref, // Will be enriched if generate_captions is true
          alt_text: `${ref} from CBSE ${params.grade} ${params.subject} textbook`,
          media_type: 'image',
          storage_path: storagePath,
          storage_url: storageUrl,
          source: 'ncert_2025',
          source_book: sourceBook,
          is_active: true,
        }

        const recordIndex = recordsToInsert.length
        recordsToInsert.push(record)

        if (generateCaptions) {
          captionInputs.push({
            ref,
            context: extractContext(text, ref),
            grade: params.grade,
            subject: params.subject,
            recordIndex,
          })
        }
      }
    }

    // Generate captions with Claude if requested
    if (generateCaptions && captionInputs.length > 0) {
      // Process in sub-batches to avoid large Claude requests
      for (let i = 0; i < captionInputs.length; i += CAPTION_BATCH_SIZE) {
        if (Date.now() - startTime >= MAX_EXECUTION_MS) {
          errors.push('Stopped caption generation: approaching time limit')
          break
        }

        const captionBatch = captionInputs.slice(i, i + CAPTION_BATCH_SIZE)
        const captions = await generateCaptionsForRefs(captionBatch)

        for (let j = 0; j < captionBatch.length; j++) {
          const idx = captionBatch[j].recordIndex
          if (captions[j]) {
            recordsToInsert[idx].caption = captions[j].caption
            recordsToInsert[idx].alt_text = captions[j].alt_text
          }
        }

        await sleep(INTER_BATCH_DELAY_MS)
      }
    }

    // Insert records (or preview in dry_run mode)
    if (recordsToInsert.length > 0) {
      if (dryRun) {
        previewRecords.push(...recordsToInsert.slice(0, 50))
      } else {
        // Insert in sub-batches of 50 (Supabase insert limit)
        for (let i = 0; i < recordsToInsert.length; i += 50) {
          const insertBatch = recordsToInsert.slice(i, i + 50)
          const { error: insertErr, count } = await supabase
            .from('content_media')
            .insert(insertBatch)

          if (insertErr) {
            errors.push(
              `Insert error (batch starting at ${i}): ${insertErr.message}`,
            )
          } else {
            totalRecordsInserted += insertBatch.length
          }
        }
      }
    }

    offset += batchSize
    await sleep(INTER_BATCH_DELAY_MS)
  }

  const elapsed = Date.now() - startTime

  return jsonResponse(
    {
      success: errors.length === 0 || totalRecordsInserted > 0,
      dry_run: dryRun,
      grade: params.grade,
      subject: params.subject,
      generate_captions: generateCaptions,
      chunks_scanned: totalChunksScanned,
      diagram_refs_found: totalRefsFound,
      duplicates_skipped: totalDuplicatesSkipped,
      records_inserted: dryRun ? 0 : totalRecordsInserted,
      preview_count: dryRun ? previewRecords.length : 0,
      preview: dryRun ? previewRecords : undefined,
      errors: errors.slice(0, 50),
      elapsed_ms: elapsed,
      hint:
        totalChunksScanned === 0
          ? `No RAG chunks found for grade="${params.grade}" subject="${params.subject}". Check rag_content_chunks data.`
          : undefined,
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

  // Authenticate — admin-only endpoint
  if (!authenticateAdmin(req)) {
    return errorResponse(
      'Unauthorized: invalid or missing x-admin-key',
      401,
      origin,
    )
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
    console.error('[extract-diagrams] Unhandled error:', message)
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
