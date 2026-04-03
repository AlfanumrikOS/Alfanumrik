/**
 * embed-ncert-qa -- Alfanumrik Edge Function
 *
 * Extracts questions and answers from NCERT textbook content (already stored
 * in rag_content_chunks) using Claude Haiku, then creates new Q&A-type RAG
 * chunks with Voyage embeddings.
 *
 * This enriches the RAG pipeline so foxy-tutor and ncert-solver can retrieve
 * Q&A pairs directly -- improving answer quality for exercise-type queries.
 *
 * Authentication: requires `x-admin-key` header matching ADMIN_API_KEY env var.
 *
 * POST body:
 * {
 *   grade:       string   -- e.g. "Grade 10"
 *   subject:     string   -- e.g. "Science"
 *   batch_size?: number   -- chapters per run (default 3, max 10)
 *   dry_run?:    boolean  -- if true, report what would be extracted without writing
 * }
 *
 * GET -- returns status: chapters with Q&A chunks vs total chapters.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { generateEmbedding, getEmbeddingModel } from '../_shared/embeddings.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
const MAX_CONTENT_CHARS = 6000 // ~1500 tokens of source text per Claude call
const MAX_BATCH_SIZE = 10
const DEFAULT_BATCH_SIZE = 3
const MAX_EXECUTION_MS = 120_000 // 2 minutes
const INTER_CHAPTER_DELAY_MS = 1000
const CLAUDE_TIMEOUT_MS = 60_000 // 60s per Claude call

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

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

const QA_EXTRACTION_SYSTEM_PROMPT = `You are an NCERT textbook Q&A extractor. Given NCERT chapter content, extract ALL questions that appear in the text:

1. In-text questions (questions within the chapter body, usually after concepts)
2. Exercise questions (end-of-chapter exercises)
3. Example problems (worked examples)
4. Activity questions (questions from activities/experiments)

For each question, extract:
- question_text: The exact question as written in NCERT
- answer_text: The answer (from the text, worked solution, or exercise answer)
- question_type: "intext" | "exercise" | "example" | "numerical" | "short_answer" | "long_answer" | "mcq" | "hots"
- ncert_exercise: Reference like "Exercise 1.2, Q3" or "In-text Q, Page 12"
- marks_expected: Estimated marks (1 for MCQ/intext, 2-3 for short, 5 for long)
- bloom_level: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create"
- topic: The specific topic this question relates to
- concept: The specific concept being tested

Return as a JSON array. If no answer is available in the text, set answer_text to null.
Do NOT invent questions. Only extract what actually appears in the NCERT text.
Return ONLY valid JSON -- no markdown code fences, no commentary.`

interface QAItem {
  question_text: string
  answer_text: string | null
  question_type: string
  ncert_exercise: string
  marks_expected: number
  bloom_level: string
  topic: string
  concept: string
}

const VALID_QUESTION_TYPES = new Set([
  'intext', 'exercise', 'example', 'numerical',
  'short_answer', 'long_answer', 'mcq', 'hots',
])

const VALID_BLOOM_LEVELS = new Set([
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
])

/**
 * Call Claude Haiku to extract Q&A items from chapter content.
 */
async function extractQAFromContent(chapterText: string): Promise<QAItem[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  // Truncate to stay within token budget
  const truncated = chapterText.length > MAX_CONTENT_CHARS
    ? chapterText.slice(0, MAX_CONTENT_CHARS)
    : chapterText

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        temperature: 0.3, // Factual extraction -- keep hallucination low
        system: QA_EXTRACTION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Extract all questions and answers from this NCERT chapter content:\n\n${truncated}`,
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errBody = await response.text()
      throw new Error(`Claude API error (${response.status}): ${errBody}`)
    }

    const result = await response.json()
    const textContent = result.content?.[0]?.text
    if (!textContent) {
      throw new Error('Claude returned empty content')
    }

    // Strip markdown code fences if present
    const cleaned = textContent
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) {
      throw new Error('Claude response is not a JSON array')
    }

    // Validate and sanitize each item
    return parsed
      .filter((item: Record<string, unknown>) =>
        item.question_text &&
        typeof item.question_text === 'string' &&
        item.question_text.trim().length > 0,
      )
      .map((item: Record<string, unknown>): QAItem => ({
        question_text: String(item.question_text).trim(),
        answer_text: item.answer_text ? String(item.answer_text).trim() : null,
        question_type: VALID_QUESTION_TYPES.has(String(item.question_type))
          ? String(item.question_type)
          : 'short_answer',
        ncert_exercise: item.ncert_exercise
          ? String(item.ncert_exercise).trim()
          : 'Unknown',
        marks_expected: typeof item.marks_expected === 'number'
          ? Math.min(Math.max(Math.round(item.marks_expected), 1), 10)
          : 2,
        bloom_level: VALID_BLOOM_LEVELS.has(String(item.bloom_level))
          ? String(item.bloom_level)
          : 'understand',
        topic: item.topic ? String(item.topic).trim() : '',
        concept: item.concept ? String(item.concept).trim() : '',
      }))
  } finally {
    clearTimeout(timeoutId)
  }
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
  source_chunks: number
  qa_extracted: number
  chunks_created: number
  skipped: boolean
  errors: string[]
}

// ---------------------------------------------------------------------------
// GET handler -- Q&A embedding status
// ---------------------------------------------------------------------------

async function handleGet(origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()

  // Count total chapters (distinct grade/subject/chapter_number with content)
  const { data: totalChapters, error: totalErr } = await supabase
    .from('rag_content_chunks')
    .select('grade, subject, chapter_number')
    .eq('is_active', true)
    .eq('content_type', 'content')

  if (totalErr) {
    return errorResponse(`DB error: ${totalErr.message}`, 500, origin)
  }

  // Deduplicate chapters
  const allChapters = new Set(
    (totalChapters || []).map(
      (r: Record<string, unknown>) =>
        `${r.grade}|${r.subject}|${r.chapter_number}`,
    ),
  )

  // Count chapters that have Q&A chunks
  const { data: qaChapters, error: qaErr } = await supabase
    .from('rag_content_chunks')
    .select('grade, subject, chapter_number')
    .eq('is_active', true)
    .eq('content_type', 'qa')

  if (qaErr) {
    return errorResponse(`DB error: ${qaErr.message}`, 500, origin)
  }

  const chaptersWithQA = new Set(
    (qaChapters || []).map(
      (r: Record<string, unknown>) =>
        `${r.grade}|${r.subject}|${r.chapter_number}`,
    ),
  )

  // Count total Q&A chunks
  const { count: totalQAChunks, error: qaCountErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('content_type', 'qa')

  if (qaCountErr) {
    return errorResponse(`DB error: ${qaCountErr.message}`, 500, origin)
  }

  // Count Q&A chunks with embeddings
  const { count: qaWithEmbedding, error: embErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('content_type', 'qa')
    .not('embedding', 'is', null)

  if (embErr) {
    return errorResponse(`DB error: ${embErr.message}`, 500, origin)
  }

  return jsonResponse(
    {
      total_chapters: allChapters.size,
      chapters_with_qa: chaptersWithQA.size,
      chapters_without_qa: allChapters.size - chaptersWithQA.size,
      coverage_percent:
        allChapters.size > 0
          ? Math.round((chaptersWithQA.size / allChapters.size) * 100)
          : 0,
      total_qa_chunks: totalQAChunks ?? 0,
      qa_chunks_with_embedding: qaWithEmbedding ?? 0,
      embedding_model: getEmbeddingModel(),
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// POST handler -- batch Q&A extraction and embedding
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
      return errorResponse(
        'Request body required with grade and subject',
        400,
        origin,
      )
    }
    params = JSON.parse(body)
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  if (!params.grade || !params.subject) {
    return errorResponse('Both "grade" and "subject" are required', 400, origin)
  }

  if (!ANTHROPIC_API_KEY) {
    return errorResponse(
      'ANTHROPIC_API_KEY not configured on server',
      500,
      origin,
    )
  }

  const batchSize = Math.min(
    Math.max(params.batch_size ?? DEFAULT_BATCH_SIZE, 1),
    MAX_BATCH_SIZE,
  )
  const dryRun = params.dry_run === true
  const embeddingModel = getEmbeddingModel()

  // -------------------------------------------------------------------------
  // Step 1: Find all distinct chapters for this grade/subject
  // -------------------------------------------------------------------------

  const { data: chapterRows, error: chapterErr } = await supabase
    .from('rag_content_chunks')
    .select('chapter_number, chapter_title')
    .eq('is_active', true)
    .eq('content_type', 'content')
    .eq('grade', params.grade)
    .eq('subject', params.subject)
    .order('chapter_number', { ascending: true })

  if (chapterErr) {
    return errorResponse(`DB error: ${chapterErr.message}`, 500, origin)
  }

  if (!chapterRows || chapterRows.length === 0) {
    return jsonResponse(
      {
        success: true,
        dry_run: dryRun,
        grade: params.grade,
        subject: params.subject,
        total_chapters: 0,
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

  // Deduplicate chapters
  const chapterMap = new Map<
    number,
    string
  >()
  for (const row of chapterRows) {
    const num = row.chapter_number as number
    if (!chapterMap.has(num)) {
      chapterMap.set(num, (row.chapter_title as string) || `Chapter ${num}`)
    }
  }

  const chapterNumbers = [...chapterMap.keys()].sort((a, b) => a - b)

  // -------------------------------------------------------------------------
  // Step 2: Process chapters up to batch_size
  // -------------------------------------------------------------------------

  const results: ChapterResult[] = []
  let chaptersProcessed = 0
  let totalQACreated = 0
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

    const chapterTitle = chapterMap.get(chapterNum)!

    const chapterResult: ChapterResult = {
      chapter_number: chapterNum,
      chapter_title: chapterTitle,
      source_chunks: 0,
      qa_extracted: 0,
      chunks_created: 0,
      skipped: false,
      errors: [],
    }

    try {
      // Check if Q&A chunks already exist for this chapter
      const { count: existingQA, error: existErr } = await supabase
        .from('rag_content_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('content_type', 'qa')
        .eq('grade', params.grade)
        .eq('subject', params.subject)
        .eq('chapter_number', chapterNum)

      if (existErr) {
        chapterResult.errors.push(`Check existing Q&A failed: ${existErr.message}`)
        totalErrors++
        results.push(chapterResult)
        chaptersProcessed++
        continue
      }

      if (existingQA && existingQA > 0) {
        chapterResult.skipped = true
        chapterResult.errors.push(
          `Skipped: ${existingQA} Q&A chunks already exist`,
        )
        results.push(chapterResult)
        chaptersProcessed++
        continue
      }

      // Fetch text content chunks for this chapter
      const { data: contentChunks, error: fetchErr } = await supabase
        .from('rag_content_chunks')
        .select('chunk_text, topic, concept, chapter_title, page_number')
        .eq('content_type', 'content')
        .eq('is_active', true)
        .eq('grade', params.grade)
        .eq('subject', params.subject)
        .eq('chapter_number', chapterNum)
        .order('chunk_index', { ascending: true })

      if (fetchErr) {
        chapterResult.errors.push(`Fetch content chunks failed: ${fetchErr.message}`)
        totalErrors++
        results.push(chapterResult)
        chaptersProcessed++
        continue
      }

      if (!contentChunks || contentChunks.length === 0) {
        chapterResult.errors.push('No content chunks found for this chapter')
        results.push(chapterResult)
        chaptersProcessed++
        continue
      }

      chapterResult.source_chunks = contentChunks.length

      // Concatenate chunk texts, truncating to MAX_CONTENT_CHARS
      let concatenated = ''
      for (const chunk of contentChunks) {
        const text = chunk.chunk_text as string
        if (concatenated.length + text.length + 2 > MAX_CONTENT_CHARS) {
          // Add as much as we can fit
          const remaining = MAX_CONTENT_CHARS - concatenated.length - 2
          if (remaining > 100) {
            concatenated += '\n\n' + text.slice(0, remaining)
          }
          break
        }
        concatenated += (concatenated ? '\n\n' : '') + text
      }

      if (concatenated.trim().length < 50) {
        chapterResult.errors.push('Chapter content too short for Q&A extraction')
        results.push(chapterResult)
        chaptersProcessed++
        continue
      }

      // Call Claude to extract Q&A
      if (dryRun) {
        // In dry run, just report that we would process this chapter
        chapterResult.qa_extracted = -1 // -1 signals "would process"
        results.push(chapterResult)
        chaptersProcessed++
        continue
      }

      const qaItems = await extractQAFromContent(concatenated)
      chapterResult.qa_extracted = qaItems.length

      if (qaItems.length === 0) {
        chapterResult.errors.push('Claude extracted 0 Q&A items from content')
        results.push(chapterResult)
        chaptersProcessed++
        continue
      }

      // Create RAG chunks for each Q&A item
      for (const qa of qaItems) {
        // Time check within chapter
        if (Date.now() - startTime >= MAX_EXECUTION_MS) {
          chapterResult.errors.push('Stopped: execution time limit reached')
          break
        }

        const chunkText = qa.answer_text
          ? `Q: ${qa.question_text}\nA: ${qa.answer_text}`
          : `Q: ${qa.question_text}`

        const embeddingText = [
          params.grade,
          params.subject,
          chapterTitle,
          `Question: ${qa.question_text}`,
          qa.answer_text ? `Answer: ${qa.answer_text}` : '',
        ]
          .filter(Boolean)
          .join(' ')

        try {
          const embedding = await generateEmbedding(embeddingText)

          const { error: insertErr } = await supabase
            .from('rag_content_chunks')
            .insert({
              chunk_text: chunkText,
              content_type: 'qa',
              question_text: qa.question_text,
              answer_text: qa.answer_text,
              question_type: qa.question_type,
              ncert_exercise: qa.ncert_exercise,
              marks_expected: qa.marks_expected,
              bloom_level: qa.bloom_level,
              grade: params.grade,
              subject: params.subject,
              chapter_number: chapterNum,
              chapter_title: chapterTitle,
              topic: qa.topic || null,
              concept: qa.concept || null,
              source: 'ncert_2025',
              is_active: true,
              embedding: JSON.stringify(embedding),
              embedded_at: new Date().toISOString(),
              embedding_model: embeddingModel,
            })

          if (insertErr) {
            chapterResult.errors.push(
              `Insert Q&A chunk failed: ${insertErr.message}`,
            )
            totalErrors++
          } else {
            chapterResult.chunks_created++
            totalQACreated++
          }
        } catch (embErr) {
          const msg =
            embErr instanceof Error ? embErr.message : String(embErr)
          chapterResult.errors.push(
            `Embedding/insert failed for Q: "${qa.question_text.slice(0, 60)}...": ${msg}`,
          )
          totalErrors++
        }
      }
    } catch (chapterErr) {
      const msg =
        chapterErr instanceof Error ? chapterErr.message : String(chapterErr)
      chapterResult.errors.push(`Chapter processing error: ${msg}`)
      totalErrors++
    }

    // Cap errors per chapter
    if (chapterResult.errors.length > 20) {
      chapterResult.errors = chapterResult.errors.slice(0, 20)
      chapterResult.errors.push('... (errors truncated)')
    }

    results.push(chapterResult)
    chaptersProcessed++

    // Delay between chapters
    if (chaptersProcessed < batchSize) {
      await sleep(INTER_CHAPTER_DELAY_MS)
    }
  }

  return jsonResponse(
    {
      success: totalErrors === 0 || totalQACreated > 0,
      dry_run: dryRun,
      grade: params.grade,
      subject: params.subject,
      total_chapters: chapterNumbers.length,
      chapters_processed: chaptersProcessed,
      qa_chunks_created: totalQACreated,
      total_errors: totalErrors,
      chapters: results,
      elapsed_ms: Date.now() - startTime,
      embedding_model: embeddingModel,
      remaining_chapters: Math.max(
        0,
        chapterNumbers.length - chaptersProcessed,
      ),
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
    console.error('[embed-ncert-qa] Unhandled error:', message)
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
