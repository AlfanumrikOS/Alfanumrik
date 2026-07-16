/**
 * embed-questions -- Alfanumrik Edge Function
 *
 * Batch-generates vector embeddings (1024 dimensions) for question_bank rows
 * that are missing embeddings. Uses the shared Voyage/OpenAI embedding utility.
 *
 * Authentication: requires `x-admin-key` header matching ADMIN_API_KEY env var.
 *
 * GET  ?grade=&subject=  -- returns embedding status (counts)
 * POST ?grade=&subject=&force=true&limit=500 -- batch-generate embeddings
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { generateEmbeddings, getEmbeddingModel } from '../_shared/embeddings.ts'
import { admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile } from '../_shared/security/ai-admission.ts'
import { bumpRagContentVersion } from '../_shared/rag-content-version.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMBEDDING_BATCH_SIZE = 128 // Voyage max batch size
const DEFAULT_LIMIT = 500
const MAX_LIMIT = 2000
const MAX_EXECUTION_MS = 120_000 // 2 minutes (stay under Supabase 150s gateway timeout)
const INTER_BATCH_DELAY_MS = 200 // throttle between batches

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

/**
 * Build the text string used for embedding a question.
 * Combines question text, options, explanation, and metadata for rich
 * semantic signal that supports retrieval for similar-question search.
 */
function buildQuestionEmbeddingText(question: Record<string, unknown>): string {
  const parts: string[] = []

  // Core question text
  if (question.question_text) {
    parts.push(String(question.question_text))
  }

  // Options -- parse from JSON and format readably
  if (question.options) {
    const labels = ['A', 'B', 'C', 'D']
    try {
      const opts: string[] =
        typeof question.options === 'string'
          ? JSON.parse(question.options)
          : Array.isArray(question.options)
            ? question.options
            : []

      if (opts.length > 0) {
        const formatted = opts
          .map((opt: string, i: number) => `${labels[i] ?? String(i + 1)}) ${opt}`)
          .join(', ')
        parts.push(`Options: ${formatted}`)
      }
    } catch {
      // If options parsing fails, include raw string
      parts.push(`Options: ${String(question.options)}`)
    }
  }

  // Explanation
  if (question.explanation) {
    parts.push(`Explanation: ${String(question.explanation)}`)
  }

  // Metadata for retrieval filtering context
  if (question.difficulty) {
    parts.push(`Difficulty: ${String(question.difficulty)}`)
  }
  if (question.bloom_level) {
    parts.push(`Bloom: ${String(question.bloom_level)}`)
  }

  return parts.join(' | ')
}

// ---------------------------------------------------------------------------
// GET handler -- embedding status overview
// ---------------------------------------------------------------------------

async function handleGet(
  origin: string | null,
  grade: string | null,
  subject: string | null,
): Promise<Response> {
  const supabase = getSupabaseAdmin()

  // Count total active questions (with optional filters)
  let totalQuery = supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
  if (grade) totalQuery = totalQuery.eq('grade', grade)
  if (subject) totalQuery = totalQuery.eq('subject', subject)

  const { count: totalActive, error: totalErr } = await totalQuery

  if (totalErr) {
    return errorResponse(`DB error: ${totalErr.message}`, 500, origin)
  }

  // Count questions with embeddings
  let embeddedQuery = supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .not('embedding', 'is', null)
  if (grade) embeddedQuery = embeddedQuery.eq('grade', grade)
  if (subject) embeddedQuery = embeddedQuery.eq('subject', subject)

  const { count: withEmbedding, error: embErr } = await embeddedQuery

  if (embErr) {
    return errorResponse(`DB error: ${embErr.message}`, 500, origin)
  }

  const total = totalActive ?? 0
  const embedded = withEmbedding ?? 0
  const pending = total - embedded

  return jsonResponse(
    {
      total,
      embedded,
      pending,
      coverage_percent: total > 0 ? Math.round((embedded / total) * 100) : 0,
      model: getEmbeddingModel(),
      ...(grade ? { grade } : {}),
      ...(subject ? { subject } : {}),
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// POST handler -- batch embedding generation
// ---------------------------------------------------------------------------

async function handlePost(
  req: Request,
  origin: string | null,
  grade: string | null,
  subject: string | null,
): Promise<Response> {
  const supabase = getSupabaseAdmin()
  const startTime = Date.now()
  const url = new URL(req.url)

  const force = url.searchParams.get('force') === 'true'
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )

  // Fetch questions needing embeddings. grade + subject are selected so the
  // post-run rag_content_versions bump knows which scopes changed
  // (response-cache v2, design item 4).
  let query = supabase
    .from('question_bank')
    .select('id, question_text, options, explanation, difficulty, bloom_level, chapter_number, grade, subject')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (!force) {
    query = query.is('embedding', null)
  }
  if (grade) query = query.eq('grade', grade)
  if (subject) query = query.eq('subject', subject)

  const { data: questions, error: fetchErr } = await query

  if (fetchErr) {
    return errorResponse(`DB fetch error: ${fetchErr.message}`, 500, origin)
  }

  if (!questions || questions.length === 0) {
    return jsonResponse(
      {
        processed: 0,
        failed: 0,
        skipped: 0,
        model: getEmbeddingModel(),
        duration_ms: Date.now() - startTime,
        message: 'No questions need embedding',
      },
      200,
      {},
      origin,
    )
  }

  // Build embedding texts for all questions
  const embeddingTexts = questions.map(buildQuestionEmbeddingText)
  const embeddingModel = getEmbeddingModel()

  let processed = 0
  let failed = 0
  const errors: string[] = []
  // Response-cache v2 (design item 4): distinct (grade, subject) pairs whose
  // questions gained/changed embeddings this run.
  const touchedScopes = new Map<string, { grade: string; subject: string }>()

  // Process in batches of EMBEDDING_BATCH_SIZE
  for (let batchStart = 0; batchStart < questions.length; batchStart += EMBEDDING_BATCH_SIZE) {
    // Time guard
    if (Date.now() - startTime >= MAX_EXECUTION_MS) {
      console.warn(
        `[embed-questions] Time limit reached after processing ${processed} questions. Stopping.`,
      )
      break
    }

    const batchEnd = Math.min(batchStart + EMBEDDING_BATCH_SIZE, questions.length)
    const batchQuestions = questions.slice(batchStart, batchEnd)
    const batchTexts = embeddingTexts.slice(batchStart, batchEnd)
    const batchIds = batchQuestions.map((q: Record<string, unknown>) => q.id as string)

    console.info(
      `[embed-questions] Processing batch ${Math.floor(batchStart / EMBEDDING_BATCH_SIZE) + 1}: ` +
        `questions ${batchStart + 1}-${batchEnd} of ${questions.length}`,
    )

    try {
      const embeddings = await generateEmbeddings(batchTexts)

      // Update each question with its embedding
      for (let i = 0; i < batchQuestions.length; i++) {
        const { error: updateErr } = await supabase
          .from('question_bank')
          .update({
            embedding: JSON.stringify(embeddings[i]),
            embedded_at: new Date().toISOString(),
          })
          .eq('id', batchIds[i])

        if (updateErr) {
          failed++
          errors.push(`question ${batchIds[i]}: ${updateErr.message}`)
          console.error(
            `[embed-questions] Update failed for question ${batchIds[i]}: ${updateErr.message}`,
          )
        } else {
          processed++
          const qGrade = String((batchQuestions[i] as Record<string, unknown>).grade ?? '')
          const qSubject = String((batchQuestions[i] as Record<string, unknown>).subject ?? '')
          if (qGrade && qSubject) {
            touchedScopes.set(`${qGrade}|${qSubject}`, { grade: qGrade, subject: qSubject })
          }
        }
      }
    } catch (batchErr) {
      // Entire batch failed at the embedding API level
      const msg = batchErr instanceof Error ? batchErr.message : String(batchErr)
      failed += batchQuestions.length
      errors.push(
        `Batch ${Math.floor(batchStart / EMBEDDING_BATCH_SIZE) + 1} failed ` +
          `(${batchQuestions.length} questions, starting ${batchIds[0]}): ${msg}`,
      )
      console.error(`[embed-questions] Batch embedding error: ${msg}`)
    }

    // Cap errors list
    if (errors.length > 50) {
      errors.splice(25, errors.length - 50)
      errors.push('... (errors truncated)')
    }

    // Throttle between batches
    if (batchEnd < questions.length) {
      await sleep(INTER_BATCH_DELAY_MS)
    }
  }

  // Response-cache v2 (design item 4): bump the content version for every
  // (grade, subject) scope whose retrievable state changed. Best-effort;
  // never fails the ingestion response.
  for (const scope of touchedScopes.values()) {
    await bumpRagContentVersion(supabase, scope.grade, scope.subject)
  }

  const durationMs = Date.now() - startTime

  console.log(
    `[embed-questions] Complete: ${processed} processed, ${failed} failed in ${durationMs}ms`,
  )

  return jsonResponse(
    {
      processed,
      failed,
      total_fetched: questions.length,
      model: embeddingModel,
      duration_ms: durationMs,
      ...(errors.length > 0 ? { errors: errors.slice(0, 25) } : {}),
      ...(grade ? { grade } : {}),
      ...(subject ? { subject } : {}),
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// Platform Security Layer — route profile
// ---------------------------------------------------------------------------

const EMBED_QUESTIONS_ROUTE_PROFILE = createStaticAiRouteProfile({
  route: 'embed-questions',
  callerTypes: ['internal_service'],
  modelProvider: 'voyage',
  modelName: 'voyage-large-2-instruct',
  inputTokenFloor: 64,
  outputTokens: 0,
})

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
          'authorization, x-client-info, apikey, content-type, x-request-id, x-admin-key, x-internal-caller, x-internal-timestamp, x-internal-signature',
      },
    })
  }

  // Method check before admission
  if (req.method !== 'GET' && req.method !== 'POST') {
    const sb = getSupabaseAdmin()
    const bodyText = ''
    const admitResult = await admitAiRoute({ req, sb, profile: EMBED_QUESTIONS_ROUTE_PROFILE, bodyText })
    if (!admitResult.ok) return admitResult.response
    await finalizeAiRoute({ sb, admission: admitResult.admission, statusCode: 405, errorCode: 'method_not_allowed' })
    return errorResponse('Method not allowed', 405, origin)
  }

  // Read body as text first — admitAiRoute needs bodyText for request body hash
  const bodyText = req.method === 'POST' ? await req.text() : ''

  // Create Supabase admin client for security layer RPCs
  const sb = getSupabaseAdmin()

  // Platform Security Layer admission
  const admitResult = await admitAiRoute({ req, sb, profile: EMBED_QUESTIONS_ROUTE_PROFILE, bodyText })
  if (!admitResult.ok) return admitResult.response
  const { admission } = admitResult

  // Parse shared query params
  const url = new URL(req.url)
  const grade = url.searchParams.get('grade')
  const subject = url.searchParams.get('subject')

  try {
    if (req.method === 'GET') {
      const response = await handleGet(origin, grade, subject)
      await finalizeAiRoute({ sb, admission, statusCode: response.status, errorCode: response.status >= 500 ? 'db_error' : null })
      return response
    }

    // POST — reconstruct a Request with the already-read body text
    const postReq = new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: bodyText,
    })
    const response = await handlePost(postReq, origin, grade, subject)
    await finalizeAiRoute({ sb, admission, statusCode: response.status, errorCode: response.status >= 500 ? 'db_error' : null })
    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[embed-questions] Unhandled error:', message)
    await finalizeAiRoute({ sb, admission, statusCode: 500, errorCode: 'unhandled_error' })
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
