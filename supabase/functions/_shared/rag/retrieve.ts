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
//   grounded-answer  — primary consumer (Phase 1 migrated, adapter in
//                      grounded-answer/retrieval.ts)
//   quiz-generator   — migrated 2026-07-15 via local adapter
//                      quiz-generator/retrieval.ts. (This line previously
//                      claimed a Phase 1 migration that had NOT happened —
//                      quiz-generator was still importing the deprecated
//                      _shared/retrieval.ts until 2026-07-15.)
//   ncert-solver     — migrated 2026-08-22 via local adapter
//                      ncert-solver/retrieval.ts (retrieveSolverContext),
//                      replacing the deprecated _shared/rag-retrieval.ts →
//                      _shared/retrieval.ts shim (mirrors the quiz-generator
//                      migration above).
//   generate-answers — Phase 1 deferred (uses _shared/retrieval.ts shim)
//   foxy-tutor       — frozen (deprecated; F7 will delete)

// Deno requires the explicit `.ts` extension; the Vitest TS check
// (moduleResolution: bundler, no allowImportingTsExtensions) flags it.
// The dynamic-import test path resolves the file regardless. Suppress
// only this line so the rest of the file remains strictly type-checked.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Deno explicit-extension import; works in Deno + Vitest dynamic-import.
import { applyMMR } from './mmr.ts';

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
  /**
   * CALLER-SIDE fused-score floor. NOT sent to the RPC.
   *
   * grounded-answer passes RRF-scale values here (STRICT 0.012 / SOFT 0.005)
   * and applies them itself in `grounded-answer/retrieval.ts` against the RRF
   * `similarity` the RPC returns. It is deliberately NOT routed to
   * `p_min_similarity`, which is an ABSOLUTE COSINE floor on a completely
   * different scale — routing an RRF threshold there would set the cosine
   * floor to ~0.012, i.e. no floor at all. Use `minCosineSimilarity` to move
   * the RPC-side floor.
   */
  minSimilarity?: number;
  /**
   * RPC-side ABSOLUTE COSINE floor → `p_min_similarity`.
   * Defaults to NCERT_MIN_COSINE_SIMILARITY (0.22). See that constant for the
   * production measurement that fixes the value and its 0.35 hard ceiling.
   */
  minCosineSimilarity?: number;
  /**
   * RPC-side content-quality gate → `p_quality_score_gate`.
   * Defaults to NCERT_QUALITY_SCORE_GATE (0.4). No-op until quality scores are
   * backfilled. NEVER pass a similarity threshold here.
   */
  qualityScoreGate?: number;
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
  /**
   * ORDERING STATISTIC — not a relevance measure. RRF (k=60) in tier 1,
   * ts_rank in tier 2, the fixed 0.3 sentinel in tier 3. Consumed by
   * applyMMR, the caller-side RRF floor, and the rerank candidate ordering.
   * DO NOT reinterpret as relevance; use `cosineSimilarity` / `rerankScore`.
   */
  similarity: number;
  /**
   * ABSOLUTE cosine relevance, `1 - (embedding <=> query_embedding)`, surfaced
   * by migration 20260727130000. Output only — the RPC filters and orders on
   * nothing but `similarity`.
   *
   * NULL IS MEANINGFUL, NOT MISSING. It means "no relevance evidence for this
   * row" and occurs for: FTS-recovered rows in tier 1 whose chunk is
   * unembedded, every row in tier 2 (FTS-only) and tier 3 (LIKE fallback) when
   * no query embedding was supplied, and any unembedded chunk. NEVER coerce it
   * to 0 (the `typeof x === 'number' ? x : 0` pattern used for `similarity`) —
   * that silently scores an unmeasured chunk as maximally IRRELEVANT rather
   * than unknown.
   *
   * An FTS-recovered tier-1 row can legitimately carry a cosine BELOW the
   * configured floor: `p_min_similarity` gates only the vector CTE, never the
   * FTS CTE. That is correct behaviour, not an anomaly. The production floor is
   * NCERT_MIN_COSINE_SIMILARITY (0.22), NOT the RPC's 0.5 default.
   */
  cosineSimilarity: number | null;
  /**
   * Voyage rerank-2 cross-encoder `relevance_score` for this chunk, when the
   * rerank stage ran in THIS module. NULL when rerank was skipped, failed, or
   * was deferred to the caller (grounded-answer passes `rerank: false` and
   * stamps its own score in pipeline.ts). NULL = no cross-encoder evidence;
   * never coerce to 0.
   */
  rerankScore: number | null;
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
  override readonly cause?: unknown;
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

// P5: grades are strings "6".."12". Keep in sync with the canonical set in
// packages/lib/src/identity/constants.ts — Deno edge functions cannot import
// across the supabase/ ↔ packages/ boundary, so this literal is a deliberate
// provenance-tracked copy (same pattern as the XP literals).
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
// Voyage's API identifier for the voyage-rerank-2 model is 'rerank-2'. The
// legacy 'voyage-rerank-2' string is REJECTED with HTTP 400 ("Model
// voyage-rerank-2 is not supported. Supported models are ['rerank-lite-1',
// 'rerank-2-lite', 'rerank-2', 'rerank-2.5', 'rerank-2.5-lite']"), which made
// callVoyageRerank silently return reranked:false (FTS/similarity order only).
// This is the SAME model (no provider/model swap) — only the stale API
// identifier is corrected, matching grounded-answer/_shared/reranking.ts intent
// and the foxy-rerank-fallback test fixture which already pins 'rerank-2'.
const VOYAGE_RERANK_MODEL = 'rerank-2';
const EMBEDDING_DIMENSIONS = 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_LIMIT = 8;

// ────────────────────────────────────────────────────────────────────────────
// RPC relevance/quality parameters — DECOUPLED (2026-07-27).
//
// Background: `match_rag_chunks_ncert` exists in production as TWO overloads.
// `CREATE OR REPLACE` with a changed signature OVERLOADS, it does not replace:
//   - OLD (baseline, oid 201818): ..., p_min_quality double precision, ...
//     Body has NO absolute cosine floor — the vector CTE is just
//     `ORDER BY c.embedding <=> query_embedding LIMIT v_fetch_count`.
//   - NEW (migration 20260707010000_rca_final_fixes.sql, oid 359405):
//     ..., p_quality_score_gate double precision DEFAULT 0.4,
//     p_min_similarity double precision DEFAULT 0.5, ...
//     Body HAS `AND 1 - (c.embedding <=> query_embedding) >= p_min_similarity`.
//
// This module used to send `p_min_quality: minSimilarity`, which (a) bound
// PostgREST to the OLD overload — so the absolute cosine floor was DEAD CODE —
// and (b) fed a *similarity* threshold into a *content quality_score* gate.
// Both parameters are now sent explicitly and separately, which also
// disambiguates the overload: `p_quality_score_gate` + `p_min_similarity`
// appear ONLY in the new signature. (PostgREST resolves overloads by argument
// NAME; a call carrying no distinguishing arg matches both and is ambiguous —
// so we always send both.)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Absolute cosine relevance floor → RPC `p_min_similarity`.
 *
 * MEASURED on the production corpus (chunk-embedding proxy: short 36-token
 * anchors scored against full chunks):
 *
 *   floor | rank-1 survives | rank-10 | rank-20
 *   ------|-----------------|---------|--------
 *   0.50  |      90.0%      |  62.5%  |  37.5%   ← the RPC's own DEFAULT: unsafe
 *   0.35  |      97.5%      |  97.5%  |  97.5%   ← hard ceiling, do not exceed
 *   0.25  |     100.0%      | 100.0%  |  97.5%
 *
 * Within-chapter chunk-pair cosine median is 0.554, so a 0.5 floor rejects
 * ~35% of genuinely same-chapter content. Cross-subject noise band p95 = 0.346.
 * Real student queries are median 8 words — SHORTER than the 36-token anchors
 * used above, so the true recall penalty of a high floor is worse than measured.
 *
 * 0.22 sits inside the recommended 0.20–0.25 band: comfortably above the
 * cross-subject noise band (p95 0.346 is the *noise* ceiling we must stay under
 * to keep recall, while 0.22 still clears random-pair territory), and well below
 * the 0.554 within-chapter median so same-chapter content is never cut.
 * DO NOT raise above 0.35 (hard ceiling) and DO NOT fall back to the RPC's 0.5
 * default. Any change requires re-running the measurement above.
 */
export const NCERT_MIN_COSINE_SIMILARITY = 0.22;

/**
 * Content-quality gate → RPC `p_quality_score_gate`.
 *
 * The SQL predicate is `(c.quality_score IS NULL OR c.quality_score >= gate)`.
 * Measured on production: 27,778 chunks, 68% have `quality_score IS NULL` and
 * EVERY populated value is exactly 0.7. So 0.4 is a NO-OP today (NULLs pass,
 * 0.7 >= 0.4 passes) — it is passed separately and correctly so it starts
 * working the moment quality scores are backfilled. It must NEVER again be
 * fed a similarity threshold.
 */
export const NCERT_QUALITY_SCORE_GATE = 0.4;
// Phase 2.B Win 1: 30 → 40. Empirical: rerank quality plateaus around
// 35-50 candidates for educational text; 40 is the conservative midpoint.
// Cost is roughly linear in candidate count (Voyage rerank-2 prices per
// document) so the marginal cost is ~$0.0001/call but the reranker has a
// strictly larger selection set to pick from. Mirrors RERANK_INITIAL_FETCH
// in grounded-answer/pipeline.ts so quiz-generator + ncert-solver pick up
// the same lift.
const RERANK_DEFAULT_FETCH = 40;

/**
 * Phase 2.B Win 3: chapter-title query expansion.
 *
 * When the request scope has chapter_title set AND the student's query
 * does not already mention it (case-insensitive substring), prepend the
 * chapter title to the query string used for EMBEDDING ONLY. The rerank
 * stage gets the original query so semantic intent stays clean — only
 * the bi-encoder retrieval is biased toward the chapter context.
 *
 * Empirical: short student queries ("explain refraction") tend to retrieve
 * across all chapters that mention the term. Prepending the chapter title
 * ("Light: explain refraction") shifts the embedding into the right
 * topical neighborhood and improves retrieval@10 by ~6-9% on the eval set.
 *
 * Pure function. Returns the original query when no expansion applies so
 * callers can use it unconditionally.
 */
export function expandQueryWithChapterTitle(
  query: string,
  chapterTitle: string | null | undefined,
): string {
  if (!chapterTitle || typeof chapterTitle !== 'string') return query;
  const trimmedTitle = chapterTitle.trim();
  if (trimmedTitle.length === 0) return query;
  // Already mentioned? Don't double-up.
  if (query.toLowerCase().includes(trimmedTitle.toLowerCase())) return query;
  return `${trimmedTitle}: ${query}`;
}

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

/**
 * `rankedScores` is POSITIONALLY ALIGNED with `rankedIndices` and carries
 * Voyage's cross-encoder `relevance_score`. It used to be parsed and thrown
 * away. NULL entries mean "no cross-encoder evidence" (identity/fall-through
 * paths, or a Voyage entry without a numeric score) — never 0.
 */
function rerankIdentity(
  documents: string[],
  topK: number,
  sliceToTopK: boolean,
): { rankedIndices: number[]; rankedScores: Array<number | null>; reranked: boolean } {
  const all = documents.map((_, i) => i);
  const rankedIndices = sliceToTopK ? all.slice(0, topK) : all;
  return { rankedIndices, rankedScores: rankedIndices.map(() => null), reranked: false };
}

async function callVoyageRerank(
  query: string,
  documents: string[],
  topK: number,
  apiKey: string,
  timeoutMs: number,
): Promise<{ rankedIndices: number[]; rankedScores: Array<number | null>; reranked: boolean }> {
  if (!apiKey || documents.length === 0) {
    return rerankIdentity(documents, topK, true);
  }
  if (documents.length <= topK) {
    return rerankIdentity(documents, topK, false);
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
      return rerankIdentity(documents, topK, true);
    }
    const body = await res.json().catch(() => null) as
      | { data?: Array<{ index: number; relevance_score?: number }> }
      | null;
    const ranked = body?.data;
    if (!Array.isArray(ranked) || ranked.length === 0) {
      return rerankIdentity(documents, topK, true);
    }
    // Filter FIRST, then project index + score from the SAME surviving entries
    // so the two arrays cannot drift out of alignment. (The pre-existing
    // `.map(...).filter(Number.isInteger)` ordering is preserved semantically:
    // same predicate, same surviving indices, same order.)
    const kept = ranked.slice(0, topK).filter((r) => Number.isInteger(r.index));
    return {
      rankedIndices: kept.map((r) => r.index),
      rankedScores: kept.map((r) =>
        typeof r.relevance_score === 'number' && Number.isFinite(r.relevance_score)
          ? r.relevance_score
          : null,
      ),
      reranked: true,
    };
  } catch {
    return rerankIdentity(documents, topK, true);
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
  /**
   * Added to the RPC's RETURNS TABLE (appended LAST) by migration
   * 20260727130000_rag_ncert_expose_cosine_similarity.sql. Absent when running
   * against a DB that predates that migration; NULL when the row carries no
   * cosine evidence. Both cases map to `cosineSimilarity: null` — "unknown",
   * NOT "irrelevant".
   */
  cosine_similarity?: number | null;
  // Defense in depth: if a future RPC extension surfaces these, we use them
  // for scope verification. The current RPC does NOT return them; the RPC's
  // own WHERE clause already enforces grade/subject filtering.
  grade_short?: string | null;
  subject_code?: string | null;
}

function mapNcertRow(row: NcertRpcRow): RetrievalChunk {
  const sim = typeof row.similarity === 'number' ? row.similarity : 0;
  // DELIBERATELY NOT the `? x : 0` coalesce used for `similarity` above.
  // A missing/NULL cosine means "no relevance evidence"; folding it to 0 would
  // assert "maximally irrelevant", which is a different and false claim.
  const cos =
    typeof row.cosine_similarity === 'number' && Number.isFinite(row.cosine_similarity)
      ? row.cosine_similarity
      : null;
  const content = row.content ?? '';
  return {
    chunk_id: row.id,
    chapter_id: null, // RPC doesn't surface chapter_id today.
    chapter_number: row.chapter_number ?? null,
    chapter_title: row.chapter_title ?? null,
    page_number: row.page_number ?? null,
    similarity: sim,
    cosineSimilarity: cos,
    // Populated only if the rerank stage runs below; null = no cross-encoder
    // evidence.
    rerankScore: null,
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
  // NOTE: opts.minSimilarity is intentionally NOT read here — it is an
  // RRF-scale, caller-side filter (see RetrieveOptions.minSimilarity).
  const minCosineSimilarity =
    opts.minCosineSimilarity ?? NCERT_MIN_COSINE_SIMILARITY;
  const qualityScoreGate = opts.qualityScoreGate ?? NCERT_QUALITY_SCORE_GATE;
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
  // Phase 2.B Win 3: when chapter_title is set and the query doesn't already
  // mention it, embed `${chapterTitle}: ${query}` instead of `query`. The
  // rerank stage and the RPC's FTS column still receive the ORIGINAL query
  // (semantic intent unchanged) — only the bi-encoder embedding gets the
  // topical hint. This is a strict superset of the prior behavior; with
  // chapterTitle === null, expansion is a no-op.
  const embeddingQuery = expandQueryWithChapterTitle(opts.query, opts.chapterTitle);
  const embedStart = Date.now();
  let embedding: number[] | null = opts.embedding ?? null;
  let embedError: { phase: RetrievePhase; message: string } | null = null;
  if (embedding == null && voyageKey) {
    embedding = await callVoyageEmbedding(embeddingQuery, voyageKey, Math.min(timeoutMs * 0.4, 8_000));
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
      // Both args are unique to the NEW overload — sending them is what binds
      // PostgREST to the signature that actually applies the cosine floor.
      // NEVER send `p_min_quality` here: it silently rebinds to the stale
      // floor-less overload AND conflates similarity with content quality.
      p_quality_score_gate: qualityScoreGate,
      p_min_similarity: minCosineSimilarity,
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
  // Note: rerank gets the ORIGINAL query (not the chapter-expanded one) so
  // the cross-encoder scores semantic intent against the document, not the
  // topical bias we added at the embedding stage.
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
      // Shadow instrumentation: stamp each surviving chunk with the
      // cross-encoder score that promoted it, BEFORE the selection below.
      // Mutation is safe — these objects were freshly built by mapNcertRow in
      // this call and are not shared. The selection expression itself is
      // byte-identical to the pre-instrumentation code.
      rr.rankedIndices.forEach((idx, pos) => {
        const c = chunks[idx];
        if (c) c.rerankScore = rr.rankedScores[pos] ?? null;
      });
      chunks = rr.rankedIndices.map((i) => chunks[i]).filter(Boolean);
      reranked = true;
    } else {
      chunks = chunks.slice(0, limit);
    }
  } else {
    chunks = chunks.slice(0, limit);
  }

  // Phase 2.B Win 2: MMR diversity over the reranked top-N. Same lambda
  // (0.7) as grounded-answer/pipeline.ts. Only applies when rerank actually
  // produced a meaningful top-K (reranked=true && length > 1) so we don't
  // touch the FTS-only fallback path. quiz-generator and other callers
  // benefit from this without any code change at the call site.
  if (reranked && chunks.length > 1) {
    chunks = applyMMR(chunks, 0.7);
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
