/**
 * Shared Embedding Utility for Alfanumrik RAG Pipeline
 *
 * Generates vector embeddings (1024 dimensions) for content chunks
 * used in semantic search across foxy-tutor and ncert-solver.
 *
 * Provider priority:
 *   1. Voyage AI (voyage-3) — preferred, purpose-built for retrieval
 *   2. OpenAI (text-embedding-3-small) — fallback
 *
 * All vectors are 1024-dimensional to match the rag_content_chunks
 * table column: embedding vector(1024).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  name: string;
  model: string;
  endpoint: string;
  maxBatchSize: number;
  buildHeaders: (apiKey: string) => Record<string, string>;
  buildBody: (model: string, texts: string[]) => Record<string, unknown>;
}

interface EmbeddingAPIResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMBEDDING_DIMENSIONS = 1024;
const MAX_TEXT_CHARS = 32_000; // ~8000 tokens safety limit
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const VOYAGE_PROVIDER: EmbeddingProvider = {
  name: 'voyage',
  model: 'voyage-3',
  endpoint: 'https://api.voyageai.com/v1/embeddings',
  maxBatchSize: 128,
  buildHeaders: (apiKey: string) => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }),
  buildBody: (model: string, texts: string[]) => ({
    model,
    input: texts,
    output_dimension: EMBEDDING_DIMENSIONS,
  }),
};

const OPENAI_PROVIDER: EmbeddingProvider = {
  name: 'openai',
  model: 'text-embedding-3-small',
  endpoint: 'https://api.openai.com/v1/embeddings',
  maxBatchSize: 2048,
  buildHeaders: (apiKey: string) => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }),
  buildBody: (model: string, texts: string[]) => ({
    model,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  }),
};

// ---------------------------------------------------------------------------
// Provider Resolution
// ---------------------------------------------------------------------------

interface ResolvedProvider {
  provider: EmbeddingProvider;
  apiKey: string;
}

function resolveProvider(): ResolvedProvider {
  const voyageKey = Deno.env.get('VOYAGE_API_KEY');
  if (voyageKey) {
    return { provider: VOYAGE_PROVIDER, apiKey: voyageKey };
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (openaiKey) {
    return { provider: OPENAI_PROVIDER, apiKey: openaiKey };
  }

  throw new Error(
    'No embedding API key configured. Set VOYAGE_API_KEY (preferred) or OPENAI_API_KEY in environment variables.',
  );
}

// ---------------------------------------------------------------------------
// Text Preparation
// ---------------------------------------------------------------------------

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return text.slice(0, MAX_TEXT_CHARS);
}

function validateTexts(texts: string[]): void {
  if (texts.length === 0) {
    throw new Error('embeddings: input texts array is empty');
  }
  for (let i = 0; i < texts.length; i++) {
    if (typeof texts[i] !== 'string' || texts[i].trim().length === 0) {
      throw new Error(`embeddings: text at index ${i} is empty or not a string`);
    }
  }
}

// ---------------------------------------------------------------------------
// Retry Logic
// ---------------------------------------------------------------------------

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Retry on rate-limit (429) or server errors (5xx)
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get('retry-after');
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);

        lastError = new Error(
          `Embedding API returned ${response.status}: ${await response.text()}`,
        );

        if (attempt < retries - 1) {
          await sleep(delayMs);
          continue;
        }
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Embedding API error (${response.status}): ${body}`,
        );
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Network errors — retry with backoff
      if (attempt < retries - 1) {
        await sleep(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw lastError ?? new Error('Embedding API request failed after retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Core API Call
// ---------------------------------------------------------------------------

async function callEmbeddingAPI(
  texts: string[],
  provider: EmbeddingProvider,
  apiKey: string,
): Promise<number[][]> {
  const body = provider.buildBody(provider.model, texts);
  const headers = provider.buildHeaders(apiKey);

  const response = await fetchWithRetry(provider.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const result: EmbeddingAPIResponse = await response.json();

  if (!result.data || !Array.isArray(result.data)) {
    throw new Error(
      `Embedding API returned unexpected format: missing data array (provider: ${provider.name})`,
    );
  }

  // Sort by index to maintain input order
  const sorted = result.data.sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((item) => item.embedding);

  // Validate dimensions
  for (let i = 0; i < embeddings.length; i++) {
    if (embeddings[i].length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch at index ${i}: expected ${EMBEDDING_DIMENSIONS}, got ${embeddings[i].length} (provider: ${provider.name})`,
      );
    }
  }

  if (embeddings.length !== texts.length) {
    throw new Error(
      `Embedding count mismatch: sent ${texts.length} texts, received ${embeddings.length} embeddings (provider: ${provider.name})`,
    );
  }

  return embeddings;
}

// ---------------------------------------------------------------------------
// Batched Processing
// ---------------------------------------------------------------------------

async function generateEmbeddingsBatched(
  texts: string[],
  provider: EmbeddingProvider,
  apiKey: string,
): Promise<number[][]> {
  const prepared = texts.map(truncateText);
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < prepared.length; i += provider.maxBatchSize) {
    const batch = prepared.slice(i, i + provider.maxBatchSize);
    const batchEmbeddings = await callEmbeddingAPI(batch, provider, apiKey);
    allEmbeddings.push(...batchEmbeddings);
  }

  return allEmbeddings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an embedding vector for a single text.
 * Returns a 1024-dimensional number array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  validateTexts([text]);
  const { provider, apiKey } = resolveProvider();
  const [embedding] = await generateEmbeddingsBatched([text], provider, apiKey);
  return embedding;
}

/**
 * Generate embedding vectors for a batch of texts.
 * Automatically handles batching per provider limits.
 * Returns array of 1024-dimensional number arrays, in input order.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  validateTexts(texts);
  const { provider, apiKey } = resolveProvider();
  return generateEmbeddingsBatched(texts, provider, apiKey);
}

/**
 * Get the name of the embedding model currently configured.
 * Useful for logging which provider is active.
 */
export function getEmbeddingModel(): string {
  const { provider } = resolveProvider();
  return `${provider.name}/${provider.model}`;
}
