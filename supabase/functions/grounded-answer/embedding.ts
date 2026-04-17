// supabase/functions/grounded-answer/embedding.ts
// Voyage AI embedding call with timeout + single retry.
//
// Single responsibility: turn a student query into a 1024-dim embedding
// for cosine search against rag_content_chunks. Spec §6.4 step 2.
//
// Contract:
//   - Never throws. Returns `null` on any failure (HTTP error, network
//     error, timeout twice, missing API key). Callers are expected to
//     degrade gracefully (retrieval still runs with keyword-only search
//     when embedding is null).
//   - Per-call timeout = min(timeoutMs * 0.4, 8s); retry at min(timeoutMs * 0.8, 16s).
//     These caps protect the overall per-request time budget (spec §3.7).
//   - Uses voyage-3 / output_dimension 1024 to match rag_content_chunks.embedding vector(1024).

const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-3';
const EMBEDDING_DIMENSIONS = 1024;

const FIRST_ATTEMPT_TIMEOUT_CAP_MS = 8_000;
const SECOND_ATTEMPT_TIMEOUT_CAP_MS = 16_000;
const FIRST_ATTEMPT_BUDGET_FRAC = 0.4;
const SECOND_ATTEMPT_BUDGET_FRAC = 0.8;

export async function generateEmbedding(
  text: string,
  timeoutMs: number,
  voyageApiKey: string,
): Promise<number[] | null> {
  if (!voyageApiKey) {
    console.warn('embedding: VOYAGE_API_KEY not set — skipping embedding');
    return null;
  }
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  const firstTimeout = Math.min(timeoutMs * FIRST_ATTEMPT_BUDGET_FRAC, FIRST_ATTEMPT_TIMEOUT_CAP_MS);
  const firstResult = await callVoyage(text, firstTimeout, voyageApiKey);
  if (firstResult.kind === 'ok') return firstResult.embedding;

  // Only retry on timeout — HTTP errors won't magically fix themselves in 200ms.
  if (firstResult.kind === 'timeout') {
    const secondTimeout = Math.min(timeoutMs * SECOND_ATTEMPT_BUDGET_FRAC, SECOND_ATTEMPT_TIMEOUT_CAP_MS);
    const secondResult = await callVoyage(text, secondTimeout, voyageApiKey);
    if (secondResult.kind === 'ok') return secondResult.embedding;
  }

  return null;
}

type VoyageResult =
  | { kind: 'ok'; embedding: number[] }
  | { kind: 'timeout' }
  | { kind: 'error' };

async function callVoyage(
  text: string,
  timeoutMs: number,
  apiKey: string,
): Promise<VoyageResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(VOYAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [text],
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Drain body to free the connection, but don't throw — this is a best-effort path.
      await response.text().catch(() => '');
      console.warn(`embedding: voyage returned HTTP ${response.status}`);
      return { kind: 'error' };
    }

    const body = await response.json().catch(() => null);
    const embedding = body?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      console.warn('embedding: voyage returned malformed or wrong-dim embedding');
      return { kind: 'error' };
    }

    return { kind: 'ok', embedding };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'timeout' };
    }
    console.warn(`embedding: network error — ${String(err)}`);
    return { kind: 'error' };
  } finally {
    clearTimeout(timeoutId);
  }
}