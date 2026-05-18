// supabase/functions/_shared/mol/grader-cron.ts
//
// C4.2b-i (2026-05-19): the daily-cron step that drives the shadow grader.
//
// What this module owns:
//   1. Query the unaged shadow rows from mol_shadow_pairs_v1.
//   2. Apply stratified per-task-type sampling (GRADER_SAMPLING_RATES).
//   3. Enforce the daily INR cost cap — if the day's shadow spend exceeds
//      GRADER_DAILY_COST_CAP_INR (₹10,000), FLIP the shadow flag's
//      kill_switch and exit early WITHOUT calling Sonnet.
//   4. For each sampled pair, call `gradeShadowPair` and write
//      shadow_grader_score / shadow_grader_payload / shadow_graded_at
//      onto the shadow row in mol_request_logs.
//
// What this module does NOT own:
//   * The Anthropic Sonnet call itself — that's grader.ts.
//   * The HTTP layer / cron secret check — that's daily-cron/index.ts.
//   * Adding response_text to mol_request_logs. THE GRADER NEEDS THE
//     ACTUAL TEXT TO COMPARE, BUT THE SCHEMA DOES NOT STORE IT YET.
//     C4.2b-i ships this cron in "scaffold mode": for every sampled
//     pair we produce a structured `skipped: text_not_available`
//     outcome that the cron's return value reports. C4.2b-ii or C5
//     decides whether (a) to add a `response_text` column to
//     mol_request_logs (P13 implications — student questions and
//     answers are PII-adjacent), (b) to stream text into an ephemeral
//     Redis store keyed by request_id, or (c) to defer entirely.
//
//     This deliberate "scaffold without text" design lets us ship the
//     sampling logic, cost guardrail, and kill-switch behavior NOW so
//     they can be validated in canary BEFORE the text-storage decision
//     is made.

import type { gradeShadowPair as GradeShadowPairFn } from './grader.ts';
import {
  GRADER_DAILY_COST_CAP_INR,
  GRADER_SAMPLING_RATES,
  graderSampleBucket,
} from './grader.ts';

/**
 * Supabase client type alias. We don't import the real type here because
 * the cron step is invoked with a service-role client created in the
 * Edge Function's `Deno.serve` handler; this lets the unit tests pass a
 * structural mock without dragging in the heavy supabase-js types.
 */
interface SupabaseLike {
  from: (table: string) => SupabaseQueryBuilder;
}

interface SupabaseQueryBuilder {
  // deno-lint-ignore no-explicit-any
  select: (cols: string, opts?: Record<string, unknown>) => any;
  // deno-lint-ignore no-explicit-any
  update: (patch: Record<string, unknown>) => any;
  // deno-lint-ignore no-explicit-any
  insert?: (rows: unknown[]) => any;
}

/**
 * One sampled pair from mol_shadow_pairs_v1. The grader cron resolves
 * the text from somewhere (today: nowhere — see the C4.2b-i scaffold
 * note above) and then calls gradeShadowPair. The shape mirrors the
 * view's row layout but only carries the fields the cron uses.
 */
export interface ShadowPairRow {
  request_id: string;
  task_type: string;
  baseline_request_id: string;
  shadow_request_id: string;
}

export interface GraderCronResult {
  graded: number;
  skipped_no_text: number;
  skipped_unsampled: number;
  cost_cap_triggered: boolean;
  killed: boolean;
  daily_shadow_cost_inr: number;
}

/**
 * The grader cron step entry point. Driver-side knobs that callers
 * (the unit test, the daily-cron index.ts) can inject:
 *   - `now`     : injected clock for deterministic tests
 *   - `grader`  : the Anthropic Sonnet caller (real: gradeShadowPair)
 *   - `samplingRates`: override per-task-type rate (test seam only)
 */
export async function gradeMolShadowPairs(
  supabase: SupabaseLike,
  options: {
    now?: () => Date;
    grader?: typeof GradeShadowPairFn;
    samplingRates?: Record<string, number>;
    costCapInr?: number;
  } = {},
): Promise<GraderCronResult> {
  const nowFn = options.now ?? (() => new Date());
  const samplingRates = options.samplingRates ?? GRADER_SAMPLING_RATES;
  const costCapInr = options.costCapInr ?? GRADER_DAILY_COST_CAP_INR;

  const result: GraderCronResult = {
    graded: 0,
    skipped_no_text: 0,
    skipped_unsampled: 0,
    cost_cap_triggered: false,
    killed: false,
    daily_shadow_cost_inr: 0,
  };

  // ── Step 1: enforce daily cost cap BEFORE any Sonnet calls ──
  // Read sum(inr_cost) for shadow rows created today. If > cap, flip the
  // kill switch on the shadow flag's metadata envelope and exit early.
  const today = nowFn();
  const todayStartIso = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0),
  ).toISOString();

  try {
    // deno-lint-ignore no-explicit-any
    const { data: costRows, error: costErr } = await (supabase.from('mol_request_logs') as any)
      .select('inr_cost')
      .eq('shadow_role', 'shadow')
      .gte('created_at', todayStartIso);
    if (costErr) {
      console.warn(`[grader-cron] cost rollup error: ${costErr.message ?? String(costErr)}`);
    } else if (Array.isArray(costRows)) {
      const sum = (costRows as Array<{ inr_cost: number | null }>).reduce(
        (acc, r) => acc + (typeof r.inr_cost === 'number' ? r.inr_cost : 0),
        0,
      );
      result.daily_shadow_cost_inr = Math.round(sum * 10000) / 10000;
      if (sum > costCapInr) {
        result.cost_cap_triggered = true;
        result.killed = await flipKillSwitch(supabase, today);
        // EXIT EARLY: do not call Sonnet, do not grade. The flip propagates
        // to mol-shadow.ts via the 5-minute flag cache.
        return result;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] cost-cap check threw, continuing without cap: ${msg}`);
  }

  // ── Step 2: pull ungraded shadow rows from the last 48 hours ──
  // We use mol_request_logs directly (not the v1 pairs view) because the
  // grader UPDATEs the shadow row by request_id, and the view doesn't
  // surface the shadow row's own request_id distinctly from the baseline's.
  const cutoffIso = new Date(nowFn().getTime() - 48 * 3600 * 1000).toISOString();
  let candidates: Array<{
    request_id: string;
    task_type: string;
    shadow_of_request_id: string | null;
  }> = [];
  try {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase.from('mol_request_logs') as any)
      .select('request_id,task_type,shadow_of_request_id', { head: false })
      .eq('shadow_role', 'shadow')
      .is('shadow_grader_score', null)
      .gte('created_at', cutoffIso);
    if (error) {
      console.warn(`[grader-cron] ungraded fetch error: ${error.message ?? String(error)}`);
      return result;
    }
    if (Array.isArray(data)) {
      candidates = data as typeof candidates;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] ungraded fetch threw: ${msg}`);
    return result;
  }

  if (candidates.length === 0) return result;

  // ── Step 3: stratified sampling by task_type ──
  const sampled: typeof candidates = [];
  for (const c of candidates) {
    const rate = samplingRates[c.task_type] ?? 0;
    if (rate <= 0) {
      result.skipped_unsampled += 1;
      continue;
    }
    if (graderSampleBucket(c.request_id) < rate) {
      sampled.push(c);
    } else {
      result.skipped_unsampled += 1;
    }
  }

  // ── Step 4: batch + grade ──
  // C4.2b-i SCAFFOLD MODE: we do not have access to baseline_text /
  // shadow_text yet (mol_request_logs does not store response text;
  // adding a column has P13 implications that need their own design
  // review). Every sampled pair is recorded as "skipped — text not
  // available" until C4.2b-ii decides on text storage.
  //
  // The driver shape below is the SAME shape the post-text-capture cron
  // will use: batches of 20, per-pair grader call, UPDATE the shadow row
  // with the score + payload. Today the grader argument is unused (the
  // text lookup yields null → we increment skipped_no_text). When text
  // capture lands, replace `resolveTexts` to return real strings and the
  // grader path will start running unchanged.
  const BATCH = 20;
  for (let i = 0; i < sampled.length; i += BATCH) {
    const batch = sampled.slice(i, i + BATCH);
    for (const pair of batch) {
      const texts = await resolveTexts(supabase, pair);
      if (!texts) {
        result.skipped_no_text += 1;
        continue;
      }
      // Reached only when C4.2b-ii lands text capture. Today: unreachable.
      // The grader argument is required so the production cron's contract
      // is fully unit-tested — see __tests__/grader-cron.test.ts.
      const grader = options.grader;
      if (!grader) {
        result.skipped_no_text += 1;
        continue;
      }
      const out = await grader({
        question: texts.question,
        baseline_text: texts.baseline_text,
        shadow_text: texts.shadow_text,
      });
      if (!out) {
        result.skipped_no_text += 1;
        continue;
      }
      try {
        // deno-lint-ignore no-explicit-any
        const { error: uErr } = await (supabase.from('mol_request_logs') as any)
          .update({
            shadow_grader_score: out.shadow.overall,
            shadow_grader_payload: out,
            shadow_graded_at: new Date().toISOString(),
          })
          .eq('request_id', pair.request_id)
          .eq('shadow_role', 'shadow');
        if (uErr) {
          console.warn(`[grader-cron] update failed for ${pair.request_id}: ${uErr.message ?? String(uErr)}`);
          continue;
        }
        result.graded += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[grader-cron] update threw for ${pair.request_id}: ${msg}`);
      }
    }
  }

  return result;
}

/**
 * Resolve baseline + shadow response texts for one pair. C4.2b-i scaffold
 * mode returns null because mol_request_logs does NOT store response
 * text. Replace the body with a real lookup once C4.2b-ii decides where
 * the text lives (column / Redis / ephemeral table).
 *
 * The signature is fixed so the cron driver does not change when text
 * capture lands.
 */
async function resolveTexts(
  // deno-lint-ignore no-unused-vars
  supabase: SupabaseLike,
  // deno-lint-ignore no-unused-vars
  pair: { request_id: string; task_type: string; shadow_of_request_id: string | null },
): Promise<{ question: string; baseline_text: string; shadow_text: string } | null> {
  // TODO(c4.2b-ii): plumb response text capture. Until then every pair
  // takes the skipped_no_text branch. Tracker: C4.2b-ii grader.ts text
  // capture decision.
  return null;
}

/**
 * Flip ff_grounded_answer_mol_shadow_v1.metadata.kill_switch to true.
 * Best-effort: returns true on success, false on any failure (so the
 * cron's response can surface the state to ops). The 5-minute flag
 * cache in mol-shadow.ts will pick the new value up on the next call.
 */
async function flipKillSwitch(supabase: SupabaseLike, now: Date): Promise<boolean> {
  try {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase.from('feature_flags') as any)
      .select('metadata')
      .eq('flag_name', 'ff_grounded_answer_mol_shadow_v1')
      .maybeSingle();
    if (error) {
      console.warn(`[grader-cron] flag read for kill-switch failed: ${error.message ?? String(error)}`);
      return false;
    }
    const existing = (data?.metadata ?? {}) as Record<string, unknown>;
    const next = { ...existing, kill_switch: true };
    // deno-lint-ignore no-explicit-any
    const { error: uErr } = await (supabase.from('feature_flags') as any)
      .update({ metadata: next, updated_at: now.toISOString() })
      .eq('flag_name', 'ff_grounded_answer_mol_shadow_v1');
    if (uErr) {
      console.warn(`[grader-cron] kill-switch flip failed: ${uErr.message ?? String(uErr)}`);
      return false;
    }
    console.warn('[grader-cron] kill_switch FLIPPED — daily shadow cost exceeded cap');
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] kill-switch threw: ${msg}`);
    return false;
  }
}
