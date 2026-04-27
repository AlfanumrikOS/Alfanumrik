// supabase/functions/_shared/rag/retrieve.ts
//
// UNIFIED RAG RETRIEVAL CONTRACT — Phase 1 (TS-layer consolidation).
//
// Why this exists
//   Three RAG retrieval RPCs coexist in production with different param
//   shapes, different filter columns, and three TS client implementations.
//   Drift between them caused F10 in the 2026-04-27 audit. This module is
//   the single canonical interface that new callers MUST use.
//
//   Phase 1 consolidates the TS layer only — it does NOT drop the legacy
//   SQL RPCs (match_rag_chunks_v2 / match_rag_chunks). SQL-layer
//   consolidation is Phase 2.
//
// Default backend
//   `match_rag_chunks_ncert` — the RRF (k=60) hybrid RPC introduced by
//   migration 20260428000000_match_rag_chunks_ncert_rrf.sql. It pins
//   source = 'ncert_2025', uses snake_case `subject_code`, and accepts
//   P5 grade format ("6"-"12").
//
// Contract (per ai-engineer Boundary):
//   - NEVER throws. All failures surface via RetrievalError on a rejected
//     promise OR (when callers prefer best-effort) via an empty chunk
//     list with an `error` field on the result. We pick the latter to
//     match the existing grounded-answer/retrieval.ts contract — the AI
//     pipeline must keep flowing even if retrieval is degraded.
//   - Validates P5 (grade is string "6"-"12") at the boundary.
//   - Returns timing breakdown for observability.
//   - Never sends PII to Voyage (we send only `query`; caller must not
//     embed student_id / email / phone in the query string — separate
//     redaction layer in pipeline.ts handles this).
//
// Caller mapping (see docs/architecture/rag-retrieval.md):
//   grounded-answer  — primary consumer (Phase 1 migrated)
//   quiz-generator   — Phase 1 migrated via local adapter in its index.ts
//   ncert-solver     — Phase 1 deferred (uses _shared/retrieval.ts shim)
//   generate-answers — Phase 1 deferred (uses _shared/retrieval.ts shim)
//   foxy-tutor       — frozen (deprecated; F7 will delete)

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type Grade = '6' | '7' | '8' | '9' | '10' | '11' | '12';

export type RetrievePhase =
  | 'validation'
  | 'embedding'
  | 'retrieval'
  | 'rerank'
  | 'scope';

export type RpcBackend =
  | 'match_rag_chunks_ncert'
  | 'match_rag_chunks_v2'
  | 'match_rag_chunks';

export interface RetrieveOptions {
  /** Student query — never PII; sanitized upstream. */
  query: string;
  /** P5 grade ("6"-"12"). Validated at the boundary. */
  grade: Grade;
  /** snake_case subject code (e.g. "math", "science"). */
  subject: string;
  /** Optional chapter scope. INTEGER. The RPC signature is INTEGER NOT NULL DEFAULT NULL. */
  chapterNumber?: number | null;
  /** Optional chapter-title ILIKE filter. */
  chapterTitle?: string | null;
  /** Top-N to return after rerank. Default 8. */
  limit?: number;
  /** RPC-side `p_min_quality` floor. Defaults to 0.5 (matches v2 default). */
  minSimilarity?: number;
  /** Run Voyage rerank-2 over an over-fetched candidate set. Default true. */
  rerank?: boolean;
  /** When `rerank: true`, fetch this many candidates pre-rerank. Default = max(30, limit). */
  candidateCount?: number;
  /**
   * Caller name for tracing + circuit-breaker keying. Required so we can
   * attribute failures to the consuming Edge Function.
   *   examples: "grounded-answer", "quiz-generator", "concept-engine"
   */
  caller: string;
  /**
   * Embedding provider. Only voyage-3 supported in Phase 1; future providers
   * can be added once we measure cost/quality. The default tracks the value
   * baked into rag_content_chunks.embedding (vector(1024) from voyage-3).
   */
  embeddingProvider?: 'voyage-3';
  /**
   * Pre-computed query embedding. When provided, we skip the embedding
   * stage. Mainly used by callers that already embedded for another
   * purpose (cache key, paraphrase detection).
   */
  embedding?: number[] | null;
  /**
   * Per-call request timeout that bounds embedding + rerank network calls.
   * Defaults to 12 000 ms (matches /api/foxy timeout). Does NOT bound the
   * Postgres RPC itself — that runs under the Supabase client's own
   * connection timeout.
   */
  timeoutMs?: number;
  /**
   * Inject a Supabase client. Required because Edge Functions construct
   * their own client per-request (service role) — this module is
   * deliberately stateless.
   */
  supabase: SupabaseLike;
  /** Override Voyage API key. Defaults to Deno.env.get('VOYAGE_API_KEY'). */
  voyageApiKey?: string;
}

export interface RetrievalChunk {
  chunk_id: string;
  chapter_id: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  page_number: number | null;
  similarity: number;
  /** Truncated content text for prompt injection. */
  excerpt: string;
  /** Full chunk text (alias of excerpt for now — kept distinct in case of future trimming). */
  content: string;
  media_url: string | null;
  media_description: string | null;
  /** Q&A fields (populated when content_type='qa' on the source row). */
  question_text: string | null;
  answer_text: string | null;
  question_type: string | null;
  marks_expected: number | null;
  bloom_level: string | null;
  ncert_exercise: string | null;
  topic: string | null;
  concept: string | null;
  content_type: string | null;
  source: string | null;
  source_rpc: RpcBackend;
}

export interface RetrievalResult {
  chunks: RetrievalChunk[];
  embedding_ms: number;
  retrieval_ms: number;
  rerank_ms: number;
  total_ms: number;
  rpc_used: RpcBackend;
  /** Chunks that scored above threshold but failed scope filter (defense in depth). */
  scope_drops: number;
  /** True when rerank ran and returned a non-identity ordering. */
  reranked: boolean;
  /** When set, retrieval degraded to empty/partial results. Never throws. */
  error: { phase: RetrievePhase; message: string } | null;
}

export class RetrievalError extends Error {
  readonly phase: RetrievePhase;
  readonly caller: string;
  readonly cause?: unknown;
  constructor(phase: RetrievePhase, caller: string, message: string, cause?: unknown) {
    super(`[retrieve:${caller}:${phase}] ${message}`);
    this.name = 'RetrievalError';
    this.phase = phase;
    this.caller = caller;
    this.cause = cause;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Validation (P5 grade format + scope sanity)
// ────────────────────────────────────────────────────────────────────────────

const VALID_GRADES = new Set<string>(['6', '7', '8', '9', '10', '11', '12']);

function validateOptions(opts: RetrieveOptions): void {
  if (!opts || typeof opts !== 'object') {
    throw new RetrievalError('validation', '<unknown>', 'options is required');
  }
  const caller = opts.caller || '<unknown>';
  if (typeof opts.caller !== 'string' || opts.caller.trim().length === 0) {
    throw new RetrievalError('validation', caller, 'caller is required (non-empty string)');
  }
  if (typeof opts.query !== 'string' || opts.query.trim().length === 0) {
    throw new RetrievalError('validation', caller, 'query must be a non-empty string');
  }
  // P5: grade is a string between "6" and "12" — never an integer.
  if (typeof opts.grade !== 'string' || !VALID_GRADES.has(opts.grade)) {
    throw new RetrievalError(
      'validation',
      caller,
      `grade must be a string in {"6".."12"}, got ${typeof opts.grade}:${JSON.stringify(opts.grade)}`,
    );
  }
  if (typeof opts.subject !== 'string' || opts.subject.trim().length === 0) {
    throw new RetrievalError('validation', caller, 'subject must be a non-empty string');
  }
  if (
    opts.chapterNumber != null &&
    (typeof opts.chapterNumber !== 'number' || !Number.isInteger(opts.chapterNumber))
  ) {
    throw new RetrievalError(
      'validation',
      caller,
      `chapterNumber must be an integer or null, got ${typeof opts.chapterNumber}`,
    );
  }
  if (!opts.supabase || typeof (opts.supabase as { rpc?: unknown }).rpc !== 'function') {
    throw new RetrievalError(
      'validation',
      caller,
      'supabase client (with .rpc) is required',
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Voyage embedding (best-effort) and rerank — minimal inline wrappers.
// We intentionally do NOT import grounded-answer/embedding.ts because that
// would couple _shared to a specific Edge Function. Instead, we duplicate
// the minimal contract: timeout-bounded fetch, never throws.
// ────────────────────────────────────────────────────────────────────────────

const VOYAGE_EMBED_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_RERANK_ENDPOINT = 'https://api.voyageai.com/v1/rerank';
const VOYAGE_EMBED_MODEL = 'voyage-3';
const VOYAGE_RERANK_MODEL = 'voyage-rerank-2';
const EMBEDDING_DIMENSIONS = 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_LIMIT = 8;
const DEFAULT_MIN_SIMILARITY = 0.5;
const RERANK_DEFAULT_FETCH = 30;

async function callVoyageEmbedding(
  text: string,
  apiKey: string,
  timeoutMs: number,
): Promise<number[] | null> {
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(VOYAGE_EMBED_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_EMBED_MODEL,
        input: [text],
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      return null;
    }
    const body = await res.json().catch(() => null) as
      | { data?: Array<{ embedding?: number[] }> }
      | null;
    const emb = body?.data?.[0]?.embedding;
    if (!Array.isArray(emb) || emb.length !== EMBEDDING_DIMENSIONS) return null;
    return emb;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callVoyageRerank(
  query: string,
  documents: string[],
  topK: number,
  apiKey: string,
  timeoutMs: number,
): Promise<{ rankedIndices: number[]; reranked: boolean }> {
  if (!apiKey || documents.length === 0) {
    return { rankedIndices: documents.map((_, i) => i).slice(0, topK), reranked: false };
  }
  if (documents.length <= topK) {
    return { rankedIndices: documents.map((_, i) => i), reranked: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(VOYAGE_RERANK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_RERANK_MODEL,
        query,
        documents,
        top_k: topK,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.text().catch(() => '');
      return { rankedIndices: documents.map((_, i) => i).slice(0, topK), reranked: false };
    }
    const body = await res.json().catch(() => null) as
      | { data?: Array<{ index: number; relevance_score?: number }> }
      | null;
    const ranked = body?.data;
    if (!Array.isArray(ranked) || ranked.length === 0) {
      return { rankedIndices: documents.map((_, i) => i).slice(0, topK), reranked: false };
    }
    return {
      rankedIndices: ranked.slice(0, topK).map((r) => r.index).filter((i) => Number.isInteger(i)),
      reranked: true,
    };
  } catch {
    return { rankedIndices: documents.map((_, i) => i).slice(0, topK), reranked: false };
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Raw RPC row shape (match_rag_chunks_ncert, post-RRF migration).
// Fields the RPC does NOT return are typed as undefined here on purpose —
// they survive as `null` on RetrievalChunk so downstream consumers can
// ignore them safely.
// ────────────────────────────────────────────────────────────────────────────

interface NcertRpcRow {
  id: string;
  content?: string | null;
  chapter_title?: string | null;
  topic?: string | null;
  concept?: string | null;
  similarity?: number | null;
  content_type?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  media_description?: string | null;
  question_text?: string | null;
  answer_text?: string | null;
  question_type?: string | null;
  marks_expected?: number | null;
  bloom_level?: string | null;
  ncert_exercise?: string | null;
  page_number?: number | null;
  chapter_number?: number | null;
  source?: string | null;
  // Defense in depth: if a future RPC extension surfaces these, we use them
  // for scope verification. The current RPC does NOT return them; the RPC's
  // own WHERE clause already enforces grade/subject filtering.
  grade_short?: string | null;
  subject_code?: string | null;
}

function mapNcertRow(row: NcertRpcRow): RetrievalChunk {
  const sim = typeof row.similarity === 'number' ? row.similarity : 0;
  const content = row.content ?? '';
  return {
    chunk_id: row.id,
    chapter_id: null, // RPC doesn't surface chapter_id today.
    chapter_number: row.chapter_number ?? null,
    chapter_title: row.chapter_title ?? null,
    page_number: row.page_number ?? null,
    similarity: sim,
    excerpt: content.length > 600 ? content.slice(0, 600) : content,
    content,
    media_url: row.media_url ?? null,
    media_description: row.media_description ?? null,
    question_text: row.question_text ?? null,
    answer_text: row.answer_text ?? null,
    question_type: row.question_type ?? null,
    marks_expected: row.marks_expected ?? null,
    bloom_level: row.bloom_level ?? null,
    ncert_exercise: row.ncert_exercise ?? null,
    topic: row.topic ?? null,
    concept: row.concept ?? null,
    content_type: row.content_type ?? null,
    source: row.source ?? null,
    source_rpc: 'match_rag_chunks_ncert',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry
// ────────────────────────────────────────────────────────────────────────────

/**
 * Unified RAG retrieval. Default backend = `match_rag_chunks_ncert`.
 *
 * - Validates inputs (P5 grade, non-empty subject/query/caller).
 * - Generates a Voyage embedding when not supplied (best-effort; null is OK,
 *   the RPC falls back to FTS).
 * - Calls match_rag_chunks_ncert with normalized snake_case params.
 * - Applies defense-in-depth scope verification.
 * - Optionally reranks via Voyage rerank-2.
 *
 * Returns the unified RetrievalResult shape with timing breakdown. Never
 * throws on retrieval-stage errors — surfaces them via `result.error`.
 * Throws RetrievalError ONLY on validation failure (programming bug).
 */
export async function retrieve(opts: RetrieveOptions): Promise<RetrievalResult> {
  validateOptions(opts);

  const startedAt = Date.now();
  const limit = Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT));
  const minSimilarity = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const wantRerank = opts.rerank !== false;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const candidateCount = wantRerank
    ? Math.max(opts.candidateCount ?? RERANK_DEFAULT_FETCH, limit)
    : limit;

  // Resolve Voyage key once. Both embed and rerank may use it.
  let voyageKey = opts.voyageApiKey;
  if (voyageKey == null) {
    try {
      voyageKey = (globalThis as unknown as {
        Deno?: { env: { get: (k: string) => string | undefined } };
      }).Deno?.env.get('VOYAGE_API_KEY') ?? '';
    } catch {
      voyageKey = '';
    }
  }

  // ── Stage 1: Embedding ────────────────────────────────────────────────────
  const embedStart = Date.now();
  let embedding: number[] | null = opts.embedding ?? null;
  let embedError: { phase: RetrievePhase; message: string } | null = null;
  if (embedding == null && voyageKey) {
    embedding = await callVoyageEmbedding(opts.query, voyageKey, Math.min(timeoutMs * 0.4, 8_000));
    if (embedding == null) {
      // Embedding failure is non-fatal — RPC has FTS fallback.
      embedError = { phase: 'embedding', message: 'voyage embedding returned null' };
    }
  }
  const embeddingMs = Date.now() - embedStart;

  // ── Stage 2: Retrieval (RPC) ──────────────────────────────────────────────
  const retrievalStart = Date.now();
  // Note: when calling Postgres via supabase-js, vector params must be
  // either a number[] (pg-rest serializer) or null. Some deployments require
  // JSON-stringifying the embedding array; the existing _shared/retrieval.ts
  // does that for v2. For ncert RPC, the existing grounded-answer/retrieval.ts
  // passes the raw array and it works — match that behavior.
  let rpcRows: NcertRpcRow[] = [];
  let retrievalError: { phase: RetrievePhase; message: string } | null = null;
  try {
    const result = await opts.supabase.rpc('match_rag_chunks_ncert', {
      query_text: opts.query,
      p_subject_code: opts.subject,
      p_grade: opts.grade,
      match_count: candidateCount,
      p_chapter_number: opts.chapterNumber ?? null,
      p_chapter_title: opts.chapterTitle ?? null,
      p_min_quality: minSimilarity,
      query_embedding: embedding,
    });
    if (result?.error) {
      retrievalError = {
        phase: 'retrieval',
        message: String(result.error?.message ?? result.error),
      };
    } else if (Array.isArray(result?.data)) {
      rpcRows = result.data as NcertRpcRow[];
    }
  } catch (err) {
    retrievalError = {
      phase: 'retrieval',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const retrievalMs = Date.now() - retrievalStart;

  // ── Stage 3: Scope verification (defense in depth) ────────────────────────
  // The RPC's own WHERE clause already enforces grade/subject; this layer
  // is a guard against a future RPC refactor silently returning wrong-scope
  // rows. Only fields the RPC actually surfaces are checked.
  let scopeDrops = 0;
  const surviving: NcertRpcRow[] = [];
  for (const row of rpcRows) {
    if (
      row.grade_short !== undefined &&
      row.grade_short !== null &&
      row.grade_short !== opts.grade
    ) {
      scopeDrops++;
      continue;
    }
    if (
      row.subject_code !== undefined &&
      row.subject_code !== null &&
      row.subject_code !== opts.subject
    ) {
      scopeDrops++;
      continue;
    }
    if (
      opts.chapterNumber != null &&
      row.chapter_number != null &&
      row.chapter_number !== opts.chapterNumber
    ) {
      scopeDrops++;
      continue;
    }
    surviving.push(row);
  }

  // ── Stage 4: Optional rerank ──────────────────────────────────────────────
  const rerankStart = Date.now();
  let chunks: RetrievalChunk[] = surviving.map(mapNcertRow);
  let reranked = false;
  if (wantRerank && chunks.length > limit && voyageKey) {
    const rr = await callVoyageRerank(
      opts.query,
      chunks.map((c) => c.content),
      limit,
      voyageKey,
      Math.min(timeoutMs * 0.4, 8_000),
    );
    if (rr.reranked) {
      chunks = rr.rankedIndices.map((i) => chunks[i]).filter(Boolean);
      reranked = true;
    } else {
      chunks = chunks.slice(0, limit);
    }
  } else {
    chunks = chunks.slice(0, limit);
  }
  const rerankMs = Date.now() - rerankStart;

  const totalMs = Date.now() - startedAt;

  // Collapse stage errors. Retrieval error trumps embedding error because
  // it actually empties the result; embedding-only failure is a soft warning.
  const error =
    retrievalError ??
    (chunks.length === 0 && embedError ? embedError : null);

  return {
    chunks,
    embedding_ms: embeddingMs,
    retrieval_ms: retrievalMs,
    rerank_ms: rerankMs,
    total_ms: totalMs,
    rpc_used: 'match_rag_chunks_ncert',
    scope_drops: scopeDrops,
    reranked,
    error,
  };
}
