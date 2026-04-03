/**
 * generate-concepts -- Alfanumrik Edge Function
 *
 * Batch-generates structured concept cards for NCERT chapters that are
 * missing entries in `chapter_concepts`.
 *
 * Uses Claude Haiku with RAG context from NCERT content chunks plus
 * question_bank and content_media to produce 3-6 concepts per chapter.
 *
 * Authentication: requires `x-admin-key` header matching ADMIN_API_KEY env var.
 *
 * POST body (all optional):
 * {
 *   grade?:      string   -- filter by grade, e.g. "10"
 *   subject?:    string   -- filter by subject code, e.g. "science"
 *   batch_size?: number   -- chapters per run (default 5, max 15)
 *   dry_run?:    boolean  -- if true, list chapters but skip generation
 * }
 *
 * GET -- returns status: counts of chapters with/without concepts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BATCH_SIZE = 15
const DEFAULT_BATCH_SIZE = 5
const MAX_EXECUTION_MS = 120_000 // 2 minutes (stay under Supabase 150s gateway timeout)
const INTER_CHAPTER_DELAY_MS = 500 // throttle between Claude API calls
const CLAUDE_TIMEOUT_MS = 60_000 // 60s timeout per Claude call (concepts are larger responses)
const MIN_RAG_CHUNKS = 3
const MAX_RAG_CHARS = 5000

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const VALID_BLOOM_LEVELS = [
  'remember',
  'understand',
  'apply',
  'analyze',
] as const

type BloomLevel = typeof VALID_BLOOM_LEVELS[number]

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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChapterInfo {
  grade: string
  subject: string
  chapter_number: number
  chapter_title: string
}

interface GeneratedConcept {
  title: string
  learning_objective: string
  explanation: string
  key_formula: string | null
  example_title: string
  example_content: string
  common_mistakes: string[]
  difficulty: number
  bloom_level: string
}

interface QuestionRow {
  id: string
  question_text: string
  options: unknown
  correct_answer_index: number | null
  explanation: string | null
}

interface DiagramRef {
  media_type: string
  caption: string | null
  url: string | null
}

// ---------------------------------------------------------------------------
// Data Fetching
// ---------------------------------------------------------------------------

async function fetchChaptersWithoutConcepts(
  supabase: ReturnType<typeof createClient>,
  grade?: string,
  subject?: string,
  limit?: number,
): Promise<ChapterInfo[]> {
  // Get distinct chapters from rag_content_chunks
  let chapterQuery = supabase
    .from('rag_content_chunks')
    .select('grade, subject, chapter_number, chapter_title')
    .order('grade', { ascending: true })
    .order('subject', { ascending: true })
    .order('chapter_number', { ascending: true })

  if (grade) chapterQuery = chapterQuery.eq('grade', grade)
  if (subject) chapterQuery = chapterQuery.eq('subject', subject)

  const { data: allChunks, error: chunkErr } = await chapterQuery

  if (chunkErr || !allChunks) return []

  // Deduplicate to get distinct chapters
  const chapterMap = new Map<string, ChapterInfo>()
  for (const row of allChunks) {
    const key = `${row.grade}|${row.subject}|${row.chapter_number}`
    if (!chapterMap.has(key)) {
      chapterMap.set(key, {
        grade: row.grade,
        subject: row.subject,
        chapter_number: row.chapter_number,
        chapter_title: row.chapter_title || `Chapter ${row.chapter_number}`,
      })
    }
  }

  // Get chapters that already have concepts
  let conceptQuery = supabase
    .from('chapter_concepts')
    .select('grade, subject, chapter_number')

  if (grade) conceptQuery = conceptQuery.eq('grade', grade)
  if (subject) conceptQuery = conceptQuery.eq('subject', subject)

  const { data: existingConcepts } = await conceptQuery

  const existingSet = new Set(
    (existingConcepts || []).map(
      (r: { grade: string; subject: string; chapter_number: number }) =>
        `${r.grade}|${r.subject}|${r.chapter_number}`,
    ),
  )

  // Filter to chapters without concepts
  const missing: ChapterInfo[] = []
  for (const [key, chapter] of chapterMap) {
    if (!existingSet.has(key)) {
      missing.push(chapter)
    }
  }

  return missing.slice(0, limit ?? DEFAULT_BATCH_SIZE)
}

async function fetchRAGChunks(
  supabase: ReturnType<typeof createClient>,
  grade: string,
  subject: string,
  chapterNumber: number,
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc('get_chapter_rag_content', {
      p_grade: grade,
      p_subject: subject,
      p_chapter_number: chapterNumber,
    })

    if (error || !data) return []

    if (Array.isArray(data)) {
      return data.map((chunk: { content?: string }) => chunk.content || '')
        .filter((c: string) => c.length > 0)
    }

    // If the RPC returns a single string
    if (typeof data === 'string' && data.length > 0) {
      return [data]
    }

    return []
  } catch {
    return []
  }
}

async function fetchChapterQuestions(
  supabase: ReturnType<typeof createClient>,
  grade: string,
  subject: string,
  chapterNumber: number,
): Promise<QuestionRow[]> {
  const { data, error } = await supabase
    .from('question_bank')
    .select('id, question_text, options, correct_answer_index, explanation')
    .eq('grade', grade)
    .eq('subject', subject)
    .eq('chapter_number', chapterNumber)
    .eq('is_active', true)
    .limit(20)

  if (error || !data) return []
  return data as QuestionRow[]
}

async function fetchDiagramRefs(
  supabase: ReturnType<typeof createClient>,
  grade: string,
  subject: string,
  chapterNumber: number,
): Promise<DiagramRef[]> {
  const { data, error } = await supabase
    .from('content_media')
    .select('media_type, caption, url')
    .eq('grade', grade)
    .eq('subject', subject)
    .eq('chapter_number', chapterNumber)
    .limit(10)

  if (error || !data) return []
  return data as DiagramRef[]
}

// ---------------------------------------------------------------------------
// Claude API Call
// ---------------------------------------------------------------------------

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        temperature: 0.3, // factual — low hallucination risk
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })

    const data = await res.json()
    return data.content?.[0]?.text || ''
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(grade: string, subject: string): string {
  return `You are a CBSE curriculum designer for Class ${grade} ${subject}. Extract 3-6 key concepts from this NCERT chapter content.

For each concept output:
- title: short concept name
- learning_objective: one sentence starting with a verb
- explanation: 3-5 simple sentences for Class ${grade}. NOT a text dump.
- key_formula: formula if math/science, null otherwise
- example_title: brief example title
- example_content: one worked example (2-4 steps)
- common_mistakes: array of 2-3 student errors
- difficulty: 1/2/3
- bloom_level: remember/understand/apply/analyze

Output ONLY valid JSON array. No markdown.`
}

function buildUserPrompt(
  chapter: ChapterInfo,
  ragChunks: string[],
  diagramRefs: DiagramRef[],
  sampleQuestion: QuestionRow | null,
): string {
  // Build RAG content, truncated to MAX_RAG_CHARS
  let ragContent = ragChunks.join('\n\n---\n\n')
  if (ragContent.length > MAX_RAG_CHARS) {
    ragContent = ragContent.slice(0, MAX_RAG_CHARS)
  }

  let prompt = `CHAPTER: ${chapter.chapter_title} (Chapter ${chapter.chapter_number})
GRADE: ${chapter.grade}
SUBJECT: ${chapter.subject}

=== NCERT CONTENT ===
${ragContent}
=== END CONTENT ===`

  if (diagramRefs.length > 0) {
    const diagramList = diagramRefs
      .map((d) => `- [${d.media_type}] ${d.caption || 'Untitled'}`)
      .join('\n')
    prompt += `

=== DIAGRAMS IN THIS CHAPTER ===
${diagramList}
=== END DIAGRAMS ===`
  }

  if (sampleQuestion) {
    const options = sampleQuestion.options as string[] | null
    const optionsText = options && Array.isArray(options)
      ? options.map((o: string, i: number) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')
      : ''
    prompt += `

=== SAMPLE QUESTION ===
${sampleQuestion.question_text}
${optionsText ? `Options: ${optionsText}` : ''}
=== END SAMPLE ===`
  }

  return prompt
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function parseConceptsResponse(raw: string): GeneratedConcept[] | null {
  try {
    // Extract JSON array from response
    const arrayMatch = raw.match(/\[[\s\S]*\]/)
    if (!arrayMatch) return null

    const parsed = JSON.parse(arrayMatch[0])
    if (!Array.isArray(parsed) || parsed.length === 0) return null

    const concepts: GeneratedConcept[] = []

    for (const item of parsed) {
      // Validate required fields
      if (
        !item.title ||
        typeof item.title !== 'string' ||
        !item.learning_objective ||
        typeof item.learning_objective !== 'string' ||
        !item.explanation ||
        typeof item.explanation !== 'string' ||
        !item.example_title ||
        typeof item.example_title !== 'string' ||
        !item.example_content ||
        typeof item.example_content !== 'string'
      ) {
        continue
      }

      // Validate difficulty
      const difficulty = typeof item.difficulty === 'number' && [1, 2, 3].includes(item.difficulty)
        ? item.difficulty
        : 2

      // Validate bloom_level
      const bloomLevel = VALID_BLOOM_LEVELS.includes(item.bloom_level)
        ? item.bloom_level
        : 'understand'

      // Validate common_mistakes
      const commonMistakes = Array.isArray(item.common_mistakes)
        ? item.common_mistakes.filter((m: unknown) => typeof m === 'string' && m.length > 0).slice(0, 3)
        : []

      concepts.push({
        title: item.title.trim(),
        learning_objective: item.learning_objective.trim(),
        explanation: item.explanation.trim(),
        key_formula: typeof item.key_formula === 'string' ? item.key_formula.trim() : null,
        example_title: item.example_title.trim(),
        example_content: item.example_content.trim(),
        common_mistakes: commonMistakes,
        difficulty,
        bloom_level: bloomLevel,
      })
    }

    // Must have 3-6 concepts
    if (concepts.length < 3) return null
    return concepts.slice(0, 6)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// GET handler -- concept generation status overview
// ---------------------------------------------------------------------------

async function handleGet(origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()

  // Count distinct chapters in rag_content_chunks
  const { data: allChunks, error: chunkErr } = await supabase
    .from('rag_content_chunks')
    .select('grade, subject, chapter_number')

  if (chunkErr) {
    return errorResponse(`DB error: ${chunkErr.message}`, 500, origin)
  }

  const totalChapters = new Set(
    (allChunks || []).map(
      (r: { grade: string; subject: string; chapter_number: number }) =>
        `${r.grade}|${r.subject}|${r.chapter_number}`,
    ),
  )

  // Count chapters with concepts
  const { data: conceptChapters, error: conceptErr } = await supabase
    .from('chapter_concepts')
    .select('grade, subject, chapter_number')

  if (conceptErr) {
    return errorResponse(`DB error: ${conceptErr.message}`, 500, origin)
  }

  const withConcepts = new Set(
    (conceptChapters || []).map(
      (r: { grade: string; subject: string; chapter_number: number }) =>
        `${r.grade}|${r.subject}|${r.chapter_number}`,
    ),
  )

  // Breakdown by grade/subject
  const breakdown: Record<string, { total: number; with_concepts: number; without_concepts: number }> = {}
  for (const key of totalChapters) {
    const [grade, subject] = key.split('|')
    const bKey = `Grade ${grade} - ${subject}`
    if (!breakdown[bKey]) breakdown[bKey] = { total: 0, with_concepts: 0, without_concepts: 0 }
    breakdown[bKey].total++
    if (withConcepts.has(key)) {
      breakdown[bKey].with_concepts++
    } else {
      breakdown[bKey].without_concepts++
    }
  }

  return jsonResponse(
    {
      total_chapters: totalChapters.size,
      with_concepts: withConcepts.size,
      without_concepts: totalChapters.size - withConcepts.size,
      coverage_percent:
        totalChapters.size > 0
          ? Math.round((withConcepts.size / totalChapters.size) * 100)
          : 0,
      breakdown,
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// POST handler -- batch concept generation
// ---------------------------------------------------------------------------

interface PostParams {
  grade?: string
  subject?: string
  batch_size?: number
  dry_run?: boolean
}

async function handlePost(req: Request, origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()
  const startTime = Date.now()

  // Validate Anthropic API key
  if (!ANTHROPIC_API_KEY) {
    return errorResponse('ANTHROPIC_API_KEY not configured', 500, origin)
  }

  // Parse params
  let params: PostParams = {}
  try {
    const body = await req.text()
    if (body.trim()) {
      params = JSON.parse(body)
    }
  } catch {
    return errorResponse('Invalid JSON body', 400, origin)
  }

  const batchSize = Math.min(
    Math.max(params.batch_size ?? DEFAULT_BATCH_SIZE, 1),
    MAX_BATCH_SIZE,
  )
  const dryRun = params.dry_run === true

  // Fetch chapters that need concepts
  const chapters = await fetchChaptersWithoutConcepts(
    supabase,
    params.grade,
    params.subject,
    batchSize,
  )

  if (chapters.length === 0) {
    return jsonResponse(
      {
        success: true,
        total_found: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        elapsed_ms: Date.now() - startTime,
        dry_run: dryRun,
      },
      200,
      {},
      origin,
    )
  }

  // Dry run: return the chapters that would be processed
  if (dryRun) {
    return jsonResponse(
      {
        success: true,
        dry_run: true,
        total_found: chapters.length,
        chapters: chapters.map((ch) => ({
          grade: ch.grade,
          subject: ch.subject,
          chapter_number: ch.chapter_number,
          chapter_title: ch.chapter_title,
        })),
        elapsed_ms: Date.now() - startTime,
      },
      200,
      {},
      origin,
    )
  }

  // Process each chapter
  let processed = 0
  let succeeded = 0
  let failed = 0
  let skipped = 0
  const errors: string[] = []

  for (const chapter of chapters) {
    const chapterKey = `Grade ${chapter.grade} ${chapter.subject} Ch${chapter.chapter_number}`

    // Time check: stop if approaching the execution limit
    if (Date.now() - startTime >= MAX_EXECUTION_MS) {
      errors.push(
        `Stopped early: approaching ${MAX_EXECUTION_MS}ms execution limit after ${processed} chapters`,
      )
      break
    }

    processed++

    try {
      // Step 1: Fetch RAG chunks
      const ragChunks = await fetchRAGChunks(
        supabase,
        chapter.grade,
        chapter.subject,
        chapter.chapter_number,
      )

      if (ragChunks.length < MIN_RAG_CHUNKS) {
        skipped++
        errors.push(`${chapterKey}: skipped — only ${ragChunks.length} RAG chunks (need >= ${MIN_RAG_CHUNKS})`)
        continue
      }

      // Step 2: Fetch questions and diagram refs in parallel
      const [questions, diagramRefs] = await Promise.all([
        fetchChapterQuestions(supabase, chapter.grade, chapter.subject, chapter.chapter_number),
        fetchDiagramRefs(supabase, chapter.grade, chapter.subject, chapter.chapter_number),
      ])

      // Pick one sample question
      const sampleQuestion = questions.length > 0 ? questions[0] : null

      // Step 3: Build prompts
      const systemPrompt = buildSystemPrompt(chapter.grade, chapter.subject)
      const userPrompt = buildUserPrompt(chapter, ragChunks, diagramRefs, sampleQuestion)

      // Step 4: Call Claude
      const rawResponse = await callClaude(systemPrompt, userPrompt, 4096)

      // Step 5: Parse response
      const concepts = parseConceptsResponse(rawResponse)

      if (!concepts) {
        failed++
        errors.push(`${chapterKey}: failed to parse Claude response`)
        continue
      }

      // Step 6: Build rows for insertion
      const rows = concepts.map((concept, index) => {
        // Try to assign a practice question per concept
        const practiceQ = questions[index] || null
        const practiceOptions = practiceQ?.options as string[] | null

        // Find matching diagram refs by checking if concept title keywords appear in captions
        const titleWords = concept.title.toLowerCase().split(/\s+/)
        const matchingDiagrams = diagramRefs
          .filter((d) => {
            if (!d.caption) return false
            const captionLower = d.caption.toLowerCase()
            return titleWords.some((w) => w.length > 3 && captionLower.includes(w))
          })
          .map((d) => ({ media_type: d.media_type, caption: d.caption, url: d.url }))

        return {
          grade: chapter.grade, // P5: grade as string
          subject: chapter.subject,
          chapter_number: chapter.chapter_number,
          chapter_title: chapter.chapter_title,
          concept_number: index + 1,
          title: concept.title,
          slug: slugify(concept.title),
          learning_objective: concept.learning_objective,
          explanation: concept.explanation,
          key_formula: concept.key_formula,
          example_title: concept.example_title,
          example_content: concept.example_content,
          common_mistakes: concept.common_mistakes,
          exam_tips: [],
          diagram_refs: matchingDiagrams,
          practice_question: practiceQ?.question_text || null,
          practice_options: practiceOptions || null,
          practice_correct_index: practiceQ?.correct_answer_index ?? null,
          practice_explanation: practiceQ?.explanation || null,
          difficulty: concept.difficulty,
          bloom_level: concept.bloom_level,
          estimated_minutes: 5,
          is_active: true,
          source: 'ncert_2025',
        }
      })

      // Step 7: Insert into chapter_concepts
      const { error: insertErr } = await supabase
        .from('chapter_concepts')
        .insert(rows)

      if (insertErr) {
        failed++
        errors.push(`${chapterKey}: DB insert error: ${insertErr.message}`)
      } else {
        succeeded++
      }
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${chapterKey}: ${msg}`)
    }

    // Cap errors list
    if (errors.length > 100) {
      errors.splice(50, errors.length - 100)
      errors.push('... (errors truncated)')
    }

    // Delay between chapters to avoid Claude API rate limiting
    if (processed < chapters.length) {
      await sleep(INTER_CHAPTER_DELAY_MS)
    }
  }

  // Count remaining chapters without concepts
  const remainingChapters = await fetchChaptersWithoutConcepts(
    supabase,
    params.grade,
    params.subject,
    999, // large limit to count all
  )

  return jsonResponse(
    {
      success: failed === 0 || succeeded > 0,
      total_found: chapters.length,
      processed,
      succeeded,
      failed,
      skipped,
      errors: errors.slice(0, 50),
      elapsed_ms: Date.now() - startTime,
      remaining: remainingChapters.length,
      dry_run: false,
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
    console.error('[generate-concepts] Unhandled error:', message)
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
