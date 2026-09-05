// supabase/functions/grounded-answer/cache-semantic.ts
//
// Semantic (embedding-cosine) answer cache tier for Foxy ONLY (Phase 2E,
// cost optimization). Backed by `foxy_response_cache` (pre-existing table,
// extended with a `question_embedding vector(1024)` column and a `payload
// jsonb` column holding the exact { tuple, response } envelope the L3
// durable cache uses -- see cache-durable.ts).
//
// Position in the pipeline (pipeline.ts): checked AFTER the Step 5 embedding
// is computed (reuses that SAME embedding -- no extra Voyage call) and
// strictly BEFORE retrieveChunks (the REG-50 position, same as L1/L2/L3: a
// hit performs zero retrieval calls and writes zero new trace rows). Unlike
// L1/L2/L3, this tier sits AFTER the Step 3 kill-switch / Step 4b circuit-
// breaker checks, since it needs the query embedded first -- a kill-switch
// or open-breaker abstain therefore does not get a semantic-cache-hit
// fast-path the way it does for the exact-match tiers. That is an accepted
// trade-off (this tier exists for cost, not outage resilience), not an
// oversight.
//
// Contract (mirrors L3's cache-durable.ts):
//   - NEVER throws on the request path -- any DB/RPC error degrades to a
//     miss (read) or a silent no-op (write).
//   - Only grounded:true responses are stored.
//   - The stored payload is { tuple, response }, re-validated on every read
//     via tuplesMatchIgnoringQuery (NOT tuplesMatch -- a hit is BY DESIGN a
//     differently-worded query than the one the entry was written under; see
//     that function's doc in cache-redis.ts for why gen_ctx_hash equality is
//     still required and sufficient without query_normalized equality).
//   - Scoped to caller === 'foxy' AND cache_scope === 'shared' (no history,
//     no per-student personalization) -- the same fail-closed gate the
//     existing L1/L2/L3 tiers already require, deliberately NOT relaxed for
//     this tier. foxy_response_cache has no student_id column by original
//     design, which is why it is the correct extension point for this.
//
// Flag: ff_foxy_semantic_cache_v1 (_semantic-cache-flag.ts), default OFF,
// gates BOTH read and write -- there is no separate "warm before serving"
// ramp here (unlike L3's ncert-solver store/serve split); this is a smaller,
// newer feature and can gain that split later if a staged ramp is needed.

import type { Caller, GroundedResponse } from './types.ts';
import { tuplesMatchIgnoringQuery, type CacheTuple } from './cache-redis.ts';
import { cachedResponseMatchesModelOrder, type ModelOrder } from './gen-ctx.ts';

const TABLE = 'foxy_response_cache';
const DEFAULT_MIN_SIMILARITY = 0.95;
// Entries are re-embeddable at any time by re-running the write path, so a
// bounded TTL (rather than "forever") keeps stale answers from surviving a
// curriculum correction indefinitely even if a content_version bump is
// somehow missed. 30 days -- long enough to actually amortize the LLM call
// this tier exists to avoid, short enough that a missed invalidation is not
// a permanent wrong-answer risk.
const CACHE_ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SemanticPayload {
  tuple: CacheTuple;
  response: GroundedResponse;
}

/** The grounded:true branch of GroundedResponse -- see the `grounded !== true` guard below. */
type GroundedTrueResponse = Extract<GroundedResponse, { grounded: true }>;

export interface SemanticCacheKey {
  grade: string;
  subject_code: string;
  chapter_number: number | null;
}

/**
 * Look up a semantic-cache hit. Returns null on: no row above the
 * similarity floor, any DB/RPC error, a malformed payload, a defense-in-
 * depth tuple mismatch (ignoring query text), a model_order mismatch, or a
 * non-grounded stored response. NEVER throws.
 */
export async function getSemanticCacheHit(
  // deno-lint-ignore no-explicit-any
  sb: any,
  embedding: number[],
  key: SemanticCacheKey,
  expectedTuple: CacheTuple,
  expectedModelOrder: ModelOrder,
  minSimilarity: number = DEFAULT_MIN_SIMILARITY,
): Promise<{ response: GroundedTrueResponse; rowId: string } | null> {
  try {
    const { data, error } = await sb.rpc('match_foxy_response_cache', {
      query_embedding: embedding,
      p_grade: key.grade,
      p_subject_code: key.subject_code,
      p_chapter_number: key.chapter_number,
      p_min_similarity: minSimilarity,
      p_match_count: 1,
    });
    if (error || !Array.isArray(data) || data.length === 0) return null;

    const row = data[0] as { id: string; payload: SemanticPayload | null; similarity: number };
    const payload = row.payload;
    if (!payload || !payload.tuple || !payload.response) return null;
    if (!tuplesMatchIgnoringQuery(payload.tuple, expectedTuple)) {
      console.warn('cache_semantic_tuple_mismatch', {
        caller: expectedTuple.caller,
        grade: expectedTuple.grade,
        subject: expectedTuple.subject_code,
      });
      return null;
    }
    if (payload.response.grounded !== true) return null;
    if (!cachedResponseMatchesModelOrder(payload.response, expectedModelOrder)) {
      console.warn('cache_semantic_model_order_mismatch', {
        caller: expectedTuple.caller,
        grade: expectedTuple.grade,
        subject: expectedTuple.subject_code,
      });
      return null;
    }
    return { response: payload.response, rowId: row.id };
  } catch (err) {
    console.warn(`cache_semantic read failed — ${String(err)}`);
    return null;
  }
}

/**
 * Fire-and-forget bookkeeping on a hit. Never throws; failures are silent
 * no-ops (this is observability, not correctness -- a missed hit_count
 * increment never affects what any student sees).
 */
// deno-lint-ignore no-explicit-any
export async function recordSemanticCacheHit(sb: any, rowId: string): Promise<void> {
  try {
    const { error } = await sb.rpc('increment_foxy_response_cache_hit', { p_row_id: rowId });
    if (error) {
      console.warn(`cache_semantic hit-bookkeeping failed — ${String(error.message ?? error)}`);
    }
  } catch (err) {
    console.warn(`cache_semantic hit-bookkeeping failed — ${String(err)}`);
  }
}

/**
 * Write-back a grounded response for future semantic reuse. Only
 * grounded:true is ever stored, and only for caller === 'foxy' (enforced by
 * the call site in pipeline.ts, not re-checked here -- mirrors
 * putDurableSolution's contract of trusting its caller). Never throws;
 * failures are silent no-ops.
 */
export async function putSemanticCacheEntry(
  // deno-lint-ignore no-explicit-any
  sb: any,
  embedding: number[],
  key: SemanticCacheKey,
  caller: Caller,
  topic: string | null,
  response: GroundedResponse,
  tuple: CacheTuple,
): Promise<void> {
  if (!response.grounded) return;
  try {
    const payload: SemanticPayload = { tuple, response };
    const now = Date.now();
    const { error } = await sb.from(TABLE).insert({
      cache_key: tuple.gen_ctx_hash,
      grade: key.grade,
      subject: key.subject_code,
      chapter_number: key.chapter_number,
      topic,
      question_embedding: embedding,
      payload,
      // Denormalized human-readable view (existing column, predates this
      // feature) -- the legacy `answer` markdown string, which is always
      // populated for Foxy responses via denormalizeFoxyResponse upstream.
      response_text: response.answer,
      model_used: response.meta.claude_model,
      language: null,
      hit_count: 0,
      quality_score: null,
      is_active: true,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + CACHE_ENTRY_TTL_MS).toISOString(),
      last_hit_at: null,
    });
    if (error) {
      console.warn(`cache_semantic write failed — ${String(error.message ?? error)}`);
    }
  } catch (err) {
    console.warn(`cache_semantic write failed — ${String(err)}`);
  }
}
