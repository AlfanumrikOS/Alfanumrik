/**
 * generate-embeddings – Alfanumrik Edge Function
 *
 * Batch-generates vector embeddings (1024 dimensions) for all NCERT
 * content chunks in rag_content_chunks that are missing embeddings.
 *
 * Authentication: requires `x-admin-key` header matching ADMIN_API_KEY env var.
 *
 * POST body (all optional):
 * {
 *   batch_size?:        number   – rows per embedding API call (default 50, max 100)
 *   grade?:             string   – filter by grade, e.g. "Grade 7"
 *   subject?:           string   – filter by subject, e.g. "Mathematics"
 *   force_regenerate?:  boolean  – re-embed chunks that already have embeddings (default false)
 * }
 *
 * GET – returns status: counts of chunks with/without embeddings, grouped by grade and subject.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { generateEmbeddings, getEmbeddingModel } from '../_shared/embeddings.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BATCH_SIZE = 100
const DEFAULT_BATCH_SIZE = 50
const MAX_EXECUTION_MS = 120_000 // 2 minutes (stay under Supabase 150s gateway timeout)
const INTER_BATCH_DELAY_MS = 200 // throttle between batches to avoid API rate limits

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
 * Build the text string used for embedding a content chunk.
 * Combines metadata fields with the actual content for richer semantic signal.
 */
function buildEmbeddingText(chunk: Record<string, unknown>): string {
  const parts: string[] = []
  if (chunk.grade) parts.push(String(chunk.grade))
  if (chunk.subject) parts.push(String(chunk.subject))
  if (chunk.chapter_title) parts.push(String(chunk.chapter_title))
  if (chunk.topic) parts.push(String(chunk.topic))
  if (chunk.concept) parts.push(String(chunk.concept))
  if (chunk.chunk_text) parts.push(String(chunk.chunk_text))
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// GET handler – embedding status overview
// ---------------------------------------------------------------------------

async function handleGet(origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()

  // Count total active chunks
  const { count: totalActive, error: totalErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  if (totalErr) {
    return errorResponse(`DB error: ${totalErr.message}`, 500, origin)
  }

  // Count chunks with embeddings
  const { count: withEmbedding, error: embErr } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .not('embedding', 'is', null)

  if (embErr) {
    return errorResponse(`DB error: ${embErr.message}`, 500, origin)
  }

  // Breakdown by grade and subject
  const { data: breakdown, error: breakdownErr } = await supabase
    .rpc('embedding_status_by_grade_subject')
    .select('*')

  // If the RPC doesn't exist, return basic counts without breakdown
  const breakdownResult = breakdownErr ? null : breakdown

  return jsonResponse(
    {
      total_active: totalActive ?? 0,
      with_embedding: withEmbedding ?? 0,
      without_embedding: (totalActive ?? 0) - (withEmbedding ?? 0),
      coverage_percent:
        totalActive && totalActive > 0
          ? Math.round(((withEmbedding ?? 0) / totalActive) * 100)
          : 0,
      embedding_model: getEmbeddingModel(),
      breakdown: breakdownResult,
    },
    200,
    {},
    origin,
  )
}

// ---------------------------------------------------------------------------
// POST handler – batch embedding generation
// ---------------------------------------------------------------------------

interface PostParams {
  batch_size?: number
  grade?: string
  subject?: string
  force_regenerate?: boolean
}

async function handlePost(req: Request, origin: string | null): Promise<Response> {
  const supabase = getSupabaseAdmin()
  const startTime = Date.now()

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
  const forceRegenerate = params.force_regenerate === true

  // Build query for chunks that need embeddings
  let countQuery = supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  if (!forceRegenerate) {
    countQuery = countQuery.is('embedding', null)
  }
  if (params.grade) {
    countQuery = countQuery.eq('grade', params.grade)
  }
  if (params.subject) {
    countQuery = countQuery.eq('subject', params.subject)
  }

  const { count: totalFound, error: countErr } = await countQuery

  if (countErr) {
    return errorResponse(`DB count error: ${countErr.message}`, 500, origin)
  }

  if (!totalFound || totalFound === 0) {
    return jsonResponse(
      {
        success: true,
        total_found: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        errors: [],
        elapsed_ms: Date.now() - startTime,
        embedding_model: getEmbeddingModel(),
        remaining: 0,
      },
      200,
      {},
      origin,
    )
  }

  // Process chunks in batches
  let processed = 0
  let succeeded = 0
  let failed = 0
  const errors: string[] = []
  const embeddingModel = getEmbeddingModel()

  while (true) {
    // Time check: stop if we are approaching the 9 minute limit
    if (Date.now() - startTime >= MAX_EXECUTION_MS) {
      break
    }

    // Fetch next batch of chunks needing embeddings
    let fetchQuery = supabase
      .from('rag_content_chunks')
      .select('id, grade, subject, chapter_title, topic, concept, chunk_text')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .limit(batchSize)

    if (!forceRegenerate) {
      fetchQuery = fetchQuery.is('embedding', null)
    } else {
      // For force_regenerate, skip chunks we already processed this run
      // by using embedded_at < startTime or embedding IS NULL
      // This avoids re-processing chunks we just updated
      fetchQuery = fetchQuery.or(
        `embedding.is.null,embedded_at.lt.${new Date(startTime).toISOString()}`,
      )
    }
    if (params.grade) {
      fetchQuery = fetchQuery.eq('grade', params.grade)
    }
    if (params.subject) {
      fetchQuery = fetchQuery.eq('subject', params.subject)
    }

    const { data: chunks, error: fetchErr } = await fetchQuery

    if (fetchErr) {
      errors.push(`Fetch error: ${fetchErr.message}`)
      break
    }

    if (!chunks || chunks.length === 0) {
      break // No more chunks to process
    }

    // Build embedding texts for the batch
    const texts = chunks.map(buildEmbeddingText)
    const ids = chunks.map((c: Record<string, unknown>) => c.id as string)

    try {
      // Generate embeddings for the batch
      const embeddings = await generateEmbeddings(texts)

      // Update each chunk with its embedding
      for (let i = 0; i < chunks.length; i++) {
        const { error: updateErr } = await supabase
          .from('rag_content_chunks')
          .update({
            embedding: JSON.stringify(embeddings[i]),
            embedded_at: new Date().toISOString(),
            embedding_model: embeddingModel,
          })
          .eq('id', ids[i])

        if (updateErr) {
          failed++
          errors.push(`chunk ${ids[i]}: update error: ${updateErr.message}`)
        } else {
          succeeded++
        }
      }

      processed += chunks.length
    } catch (batchErr) {
      // Entire batch failed at the embedding API level
      const msg = batchErr instanceof Error ? batchErr.message : String(batchErr)
      failed += chunks.length
      processed += chunks.length
      errors.push(
        `Batch of ${chunks.length} chunks failed (starting ${ids[0]}): ${msg}`,
      )

      // Mark these chunks so we skip them on the next loop iteration
      // (for force_regenerate mode, we need to avoid an infinite loop)
      // Update embedded_at without changing the embedding to signal we attempted
      if (forceRegenerate) {
        for (const id of ids) {
          await supabase
            .from('rag_content_chunks')
            .update({ embedded_at: new Date().toISOString() })
            .eq('id', id)
        }
      }
    }

    // Cap errors list to avoid unbounded memory
    if (errors.length > 100) {
      errors.splice(50, errors.length - 100)
      errors.push('... (errors truncated)')
    }

    // Delay between batches to avoid API throttling
    await sleep(INTER_BATCH_DELAY_MS)
  }

  const remaining = (totalFound ?? 0) - succeeded

  return jsonResponse(
    {
      success: failed === 0 || succeeded > 0,
      total_found: totalFound,
      processed,
      succeeded,
      failed,
      errors: errors.slice(0, 50), // Limit error output in response
      elapsed_ms: Date.now() - startTime,
      embedding_model: embeddingModel,
      remaining: Math.max(0, remaining),
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
    console.error('[generate-embeddings] Unhandled error:', message)
    return errorResponse(`Internal error: ${message}`, 500, origin)
  }
})
