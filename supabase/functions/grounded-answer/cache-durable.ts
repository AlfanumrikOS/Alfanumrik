// supabase/functions/grounded-answer/cache-durable.ts
//
// Durable L3 solution store for caller='ncert-solver' ONLY (response-cache
// v2, design item 6). Backed by the `ncert_solver_solutions` table
// (created by a parallel architect migration):
//   grade text, subject_code text, question_hash text, gen_ctx_hash text,
//   content_version int, response jsonb,
//   UNIQUE(grade, subject_code, question_hash, gen_ctx_hash)
//
// Position in the pipeline: checked AFTER an L2 miss, strictly BEFORE
// retrieveChunks — the REG-50 position. Cache short-circuits stay
// sequential (L1 → L2 → L3 → pipeline); they are NEVER raced in parallel
// with retrieval, and an L3 hit performs zero retrieval calls and writes
// zero new trace rows (the stored trace_id is the source of truth).
//
// Contract (mirrors L2):
//   - NEVER throws on the request path — any DB error degrades to a miss
//     (read) or a silent no-op (write).
//   - Only grounded:true responses are stored ("grounded success only,
//     never abstains").
//   - The stored jsonb payload is { tuple, response } — the SAME
//     defense-in-depth tuple shape L2 stores (cache-redis.ts CacheTuple,
//     including the full gen_ctx_hash), re-validated on every read.
//     A mismatch is a miss, never served.
//   - NO student identifiers anywhere in the payload: the tuple carries
//     scope + query identity only, and GroundedResponse carries
//     answer/citations/confidence/trace_id/meta — ncert-solver's grounded
//     requests are built with student_id: null and personalization-free
//     template variables (see ncert-solver/index.ts), which is why the
//     solver declares cache_scope: 'shared' unconditionally.
//
// Flags (checked at the pipeline call sites, 60s memo, fail-closed):
//   - READ/SERVE requires BOTH ff_ncert_solver_solution_store_v1 AND the
//     caller's serving flag (isL2CacheServingEnabledForCaller — for
//     ncert-solver that is ff_response_cache_serve_ncert_v1).
//   - WRITE-BACK requires only ff_ncert_solver_solution_store_v1, so the
//     store can warm before serving flips ON (architect ramp contract),
//     and serving can be killed without discarding the store.

import type { GroundedResponse } from './types.ts';
import { tuplesMatch, type CacheTuple } from './cache-redis.ts';

const TABLE = 'ncert_solver_solutions';

export interface DurableSolutionKey {
  grade: string;
  subject_code: string;
  /** sha256 of the NORMALIZED query — cache-redis.ts hashNormalizedQuery. */
  question_hash: string;
  /** Full 64-hex-char gen_ctx hash — gen-ctx.ts hashGenCtx. */
  gen_ctx_hash: string;
}

interface DurablePayload {
  tuple: CacheTuple;
  response: GroundedResponse;
}

/**
 * Look up a durable solution. Returns null on: no row, any DB error, a
 * malformed payload, a defense-in-depth tuple mismatch, or a non-grounded
 * stored response. NEVER throws.
 */
export async function getDurableSolution(
  // deno-lint-ignore no-explicit-any
  sb: any,
  key: DurableSolutionKey,
  expectedTuple: CacheTuple,
): Promise<GroundedResponse | null> {
  try {
    const { data, error } = await sb
      .from(TABLE)
      .select('response')
      .eq('grade', key.grade)
      .eq('subject_code', key.subject_code)
      .eq('question_hash', key.question_hash)
      .eq('gen_ctx_hash', key.gen_ctx_hash)
      .maybeSingle();
    if (error || !data) return null;
    const payload = data.response as DurablePayload | null;
    if (!payload || !payload.tuple || !payload.response) return null;
    if (!tuplesMatch(payload.tuple, expectedTuple)) {
      console.warn('cache_l3_tuple_mismatch', {
        caller: expectedTuple.caller,
        grade: expectedTuple.grade,
        subject: expectedTuple.subject_code,
      });
      return null;
    }
    if (payload.response.grounded !== true) return null;
    return payload.response;
  } catch (err) {
    console.warn(`cache_l3 read failed — ${String(err)}`);
    return null;
  }
}

/**
 * Write-back a grounded solution (upsert on the unique key so re-solves
 * after a same-version recompute are idempotent). Only grounded:true is
 * ever stored. Never throws; failures are silent no-ops.
 *
 * Column contract (migration 20260716090100 COMMENT): the ON CONFLICT
 * upsert sets response/content_version/model/tokens_used/created_at, so
 * a superseding solve refreshes ALL of them in place — including
 * created_at (explicitly sent because the column DEFAULT only applies on
 * INSERT, never on the DO UPDATE arm).
 */
export async function putDurableSolution(
  // deno-lint-ignore no-explicit-any
  sb: any,
  key: DurableSolutionKey,
  response: GroundedResponse,
  tuple: CacheTuple,
  contentVersion: number,
): Promise<void> {
  if (!response.grounded) return;
  try {
    const payload: DurablePayload = { tuple, response };
    const { error } = await sb
      .from(TABLE)
      .upsert(
        {
          grade: key.grade,
          subject_code: key.subject_code,
          question_hash: key.question_hash,
          gen_ctx_hash: key.gen_ctx_hash,
          content_version: contentVersion,
          response: payload,
          model: response.meta?.claude_model ?? null,
          tokens_used:
            typeof response.meta?.tokens_used === 'number' && response.meta.tokens_used >= 0
              ? response.meta.tokens_used
              : null,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'grade,subject_code,question_hash,gen_ctx_hash' },
      );
    if (error) {
      console.warn(`cache_l3 write failed — ${String(error.message ?? error)}`);
    }
  } catch (err) {
    console.warn(`cache_l3 write failed — ${String(err)}`);
  }
}
