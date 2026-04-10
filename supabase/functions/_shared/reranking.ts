/**
 * Voyage AI Reranking for Alfanumrik RAG Pipeline
 *
 * Uses voyage-rerank-2 to reorder retrieved chunks by relevance to the query.
 * Best-effort: returns original order on any error.
 *
 * Only invoke when:
 *   - VOYAGE_API_KEY is set
 *   - retrieved chunk count > finalCount (reranking K→N makes sense)
 *   - caller has opted in via useReranking=true
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RERANK_MODEL = 'voyage-rerank-2'
const RERANK_ENDPOINT = 'https://api.voyageai.com/v1/rerank'
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 500

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RerankInput {
  query: string
  documents: string[] // chunk content texts, in retrieval order
}

export interface RerankResult {
  rankedIndices: number[] // original indices, reordered by relevance
  reranked: boolean       // false if reranking was skipped/failed
}

interface RerankAPIResponse {
  data: Array<{ index: number; relevance_score: number }>
}

// ---------------------------------------------------------------------------
// Retry helper (mirrors embeddings.ts pattern)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options)

      // Retry on rate-limit (429) or server errors (5xx)
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get('retry-after')
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)

        lastError = new Error(
          `Rerank API returned ${response.status}: ${await response.text()}`,
        )

        if (attempt < retries - 1) {
          await sleep(delayMs)
          continue
        }
      }

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Rerank API error (${response.status}): ${body}`)
      }

      return response
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Network errors — retry with backoff
      if (attempt < retries - 1) {
        await sleep(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt))
        continue
      }
    }
  }

  throw lastError ?? new Error('Rerank API request failed after retries')
}

// ---------------------------------------------------------------------------
// Build identity result (original order, no reranking)
// ---------------------------------------------------------------------------

function identityResult(docCount: number, finalCount: number): RerankResult {
  const indices = Array.from({ length: docCount }, (_, i) => i).slice(0, finalCount)
  return { rankedIndices: indices, reranked: false }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rerank retrieved documents using Voyage AI rerank-2.
 *
 * Returns original order (best-effort) if:
 *   - VOYAGE_API_KEY is not set
 *   - document count <= finalCount (reranking would not change anything)
 *   - API call fails for any reason
 *
 * NEVER throws — always returns a RerankResult.
 */
export async function rerankDocuments(
  input: RerankInput,
  finalCount: number,
): Promise<RerankResult> {
  const { query, documents } = input

  // Guard: no documents to rerank
  if (!documents || documents.length === 0) {
    return { rankedIndices: [], reranked: false }
  }

  // Guard: no API key configured
  const apiKey = Deno.env.get('VOYAGE_API_KEY')
  if (!apiKey) {
    console.warn('reranking: VOYAGE_API_KEY not set, skipping reranking')
    return identityResult(documents.length, finalCount)
  }

  // Guard: reranking K→N only makes sense when we have more candidates than desired
  if (documents.length <= finalCount) {
    return identityResult(documents.length, finalCount)
  }

  try {
    const response = await fetchWithRetry(RERANK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents,
        top_k: finalCount,
      }),
    })

    const result: RerankAPIResponse = await response.json()

    if (!result.data || !Array.isArray(result.data) || result.data.length === 0) {
      console.warn('reranking: unexpected API response format, falling back to original order')
      return identityResult(documents.length, finalCount)
    }

    // API returns results sorted by relevance_score descending already
    // Extract original indices in that order
    const rankedIndices = result.data
      .slice(0, finalCount)
      .map((item) => item.index)

    return { rankedIndices, reranked: true }
  } catch (err) {
    // Best-effort: never let reranking failure break retrieval
    console.warn(
      'reranking: API call failed, falling back to original order:',
      err instanceof Error ? err.message : String(err),
    )
    return identityResult(documents.length, finalCount)
  }
}
