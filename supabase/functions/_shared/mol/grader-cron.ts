// supabase/functions/_shared/mol/grader-cron.ts
//
// C4.2b-i (2026-05-19): the daily-cron step that drives the shadow grader.
// C4.2b-i review fixes (2026-05-19):
//   * A1: forwards `grade` + `coach_mode` from the pair row to the grader.
//   * B5: parallelizes the per-pair grader calls (Promise.allSettled,
//         concurrency = BATCH_CONCURRENCY) so the cron stays under the
//         150s Edge-function timeout once C4.2b-ii lands real text capture.
//   * B6: enforces a separate GRADER_DAILY_CAP_INR on Sonnet spend. The
//         cron tracks grader cost in-process during the run; if exceeded
//         mid-batch the remaining batches abort cleanly without flipping
//         the shadow kill switch (grader cost is operational overhead, not
//         a signal that shadow is bad). Each grader call also writes its
//         own telemetry row tagged task_type='shadow_grader' and
//         surface='cron' so the existing mol_request_health_24h view picks
//         it up automatically.
//   * B1: when the shadow cost cap flips kill_switch=true, the cron inserts
//         one audit_logs row tagged actor_type='cron' so the
//         super-admin SIEM/forensics surface sees the event.
//
// What this module owns:
//   1. Query the unaged shadow rows from mol_request_logs.
//   2. Apply stratified per-task-type sampling (GRADER_SAMPLING_RATES).
//   3. Enforce the daily INR cost cap on SHADOW spend — if the day's shadow
//      cost exceeds GRADER_DAILY_COST_CAP_INR (₹10,000), FLIP the shadow
//      flag's kill_switch and exit early WITHOUT calling Sonnet.
//   4. Enforce a separate cap on GRADER (Sonnet) spend
//      (GRADER_DAILY_CAP_INR, ₹5,000): aborts remaining batches but does
//      NOT flip kill_switch.
//   5. For each sampled pair, call `gradeShadowPair` (in parallel batches
//      of BATCH_CONCURRENCY) and write
//      shadow_grader_score / shadow_grader_payload / shadow_graded_at
//      onto the shadow row in mol_request_logs.
//
// What this module does NOT own:
//   * The Anthropic Sonnet call itself — that's grader.ts.
//   * The HTTP layer / cron secret check — that's daily-cron/index.ts.
//   * Storage of response text. C4.2b-ii (2026-05-20) added a dedicated
//     bounded table `mol_shadow_text_buffer` with 7-day TTL and PII
//     redaction at write time. `resolveTexts` below now SELECTs from
//     that table; `cleanupGradedText` DELETEs the row after a successful
//     grade. When the buffer row is missing (text-capture flag was off
//     at fire time, worker recycled before drain, sweeper GC'd a stale
//     row), the grader degrades gracefully to `skipped_no_text` —
//     identical shape to the original scaffold-mode outcome.

import type { gradeShadowPair as GradeShadowPairFn, GraderResult } from './grader.ts';
import {
  GRADER_DAILY_CAP_INR,
  GRADER_DAILY_COST_CAP_INR,
  GRADER_SAMPLING_RATES,
  graderSampleBucket,
} from './grader.ts';

/**
 * Max concurrent Sonnet calls per batch. 5 keeps us well clear of
 * Anthropic's per-key concurrency limits (~50 by default) while reducing
 * total wall time by ~5× compared to serial. Raise carefully — Sonnet
 * has lower throughput per key than Haiku.
 */
const BATCH_CONCURRENCY = 5 as const;

/**
 * Estimated INR cost per grader call (Sonnet 4.6 @ ~600 input + 300 output
 * tokens, USD→INR ≈ 85). We use a heuristic estimate at SCHEDULE time so
 * the cap kicks in BEFORE we exhaust the budget — actual cost lands on
 * the mol_request_logs telemetry row, but the in-process counter has to
 * decide whether to start the NEXT batch without waiting for those rows.
 * Tuned conservatively (slightly high) so we under-spend rather than over.
 *
 * Sonnet pricing (2026-05-19): $3/M input + $15/M output. At ~600/300
 * tokens that's $0.0063 ≈ ₹0.54. We round up to ₹1 to absorb retries.
 */
const ESTIMATED_GRADER_INR_PER_CALL = 1.0 as const;

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
  insert?: (rows: unknown[] | Record<string, unknown>) => any;
  // deno-lint-ignore no-explicit-any
  delete?: () => any;
}

/**
 * One sampled pair from mol_request_logs. The grader cron resolves
 * the text from somewhere (today: nowhere — see the C4.2b-i scaffold
 * note above) and then calls gradeShadowPair.
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
  grader_cap_triggered: boolean;
  estimated_grader_cost_inr: number;
}

/**
 * The grader cron step entry point. Driver-side knobs that callers
 * (the unit test, the daily-cron index.ts) can inject:
 *   - `now`              : injected clock for deterministic tests
 *   - `grader`           : the Anthropic Sonnet caller (real: gradeShadowPair)
 *   - `samplingRates`    : override per-task-type rate (test seam only)
 *   - `costCapInr`       : override shadow cap (test seam)
 *   - `graderCapInr`     : override grader Sonnet cap (test seam)
 *   - `batchConcurrency` : override Promise batch size (test seam)
 *   - `estimatedGraderInrPerCall`: override per-call estimate (test seam)
 */
export async function gradeMolShadowPairs(
  supabase: SupabaseLike,
  options: {
    now?: () => Date;
    grader?: typeof GradeShadowPairFn;
    samplingRates?: Record<string, number>;
    costCapInr?: number;
    graderCapInr?: number;
    batchConcurrency?: number;
    estimatedGraderInrPerCall?: number;
  } = {},
): Promise<GraderCronResult> {
  const nowFn = options.now ?? (() => new Date());
  const samplingRates = options.samplingRates ?? GRADER_SAMPLING_RATES;
  const costCapInr = options.costCapInr ?? GRADER_DAILY_COST_CAP_INR;
  const graderCapInr = options.graderCapInr ?? GRADER_DAILY_CAP_INR;
  const concurrency = options.batchConcurrency ?? BATCH_CONCURRENCY;
  const estimatedGraderInrPerCall =
    options.estimatedGraderInrPerCall ?? ESTIMATED_GRADER_INR_PER_CALL;

  const result: GraderCronResult = {
    graded: 0,
    skipped_no_text: 0,
    skipped_unsampled: 0,
    cost_cap_triggered: false,
    killed: false,
    daily_shadow_cost_inr: 0,
    grader_cap_triggered: false,
    estimated_grader_cost_inr: 0,
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
        // B1 review fix: emit an audit_logs row so the super-admin SIEM
        // catches the kill-switch flip. Best-effort: do not let an audit
        // failure mask the kill-switch outcome.
        if (result.killed) {
          await emitKillSwitchAudit(supabase, {
            daily_shadow_cost_inr: result.daily_shadow_cost_inr,
            cap_inr: costCapInr,
            run_at: today.toISOString(),
          });
        }
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
  //
  // A1 review fix: include `grade` so the grader can score age-appropriateness
  // coherently. `coach_mode` is NOT yet a column on mol_request_logs (P13-
  // bound design call deferred to a follow-up); for now we pass null.
  const cutoffIso = new Date(nowFn().getTime() - 48 * 3600 * 1000).toISOString();
  let candidates: Array<{
    request_id: string;
    task_type: string;
    shadow_of_request_id: string | null;
    grade: string | null;
  }> = [];
  try {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase.from('mol_request_logs') as any)
      .select('request_id,task_type,shadow_of_request_id,grade', { head: false })
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
  // B5 review fix: each batch fans out via Promise.allSettled so the
  // Sonnet calls run in parallel. Per-pair errors are caught inside the
  // batch worker so one bad pair never blocks the rest. Once text capture
  // lands, replace `resolveTexts` to return real strings and the grader
  // path will start running unchanged.
  for (let i = 0; i < sampled.length; i += concurrency) {
    // B6 review fix: abort remaining batches when the in-process grader
    // cost estimate exceeds the daily cap. We check BEFORE scheduling the
    // next batch so a partially-completed batch is allowed to finish.
    if (result.estimated_grader_cost_inr >= graderCapInr) {
      result.grader_cap_triggered = true;
      console.warn(
        `[grader-cron] grader Sonnet cap reached: estimated=${result.estimated_grader_cost_inr} cap=${graderCapInr} — aborting remaining batches`,
      );
      // Remaining unscheduled pairs are counted as skipped_no_text so the
      // ops dashboard does not lose them.
      result.skipped_no_text += sampled.length - i;
      break;
    }

    const batch = sampled.slice(i, i + concurrency);

    // Schedule the whole batch in parallel.
    const settled = await Promise.allSettled(
      batch.map((pair) => gradeOnePair(supabase, pair, options.grader, today)),
    );

    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        // The per-pair worker swallows its own errors and returns a tagged
        // outcome; a rejected status means a programming error escaped
        // (rare). Treat as skipped so the run still counts as accounted.
        result.skipped_no_text += 1;
        const reason = outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
        console.warn(`[grader-cron] unexpected worker rejection: ${reason}`);
        // Even rejected workers may have spent Sonnet quota — charge the
        // estimate so the cap stays accurate.
        result.estimated_grader_cost_inr =
          Math.round((result.estimated_grader_cost_inr + estimatedGraderInrPerCall) * 10000) / 10000;
        continue;
      }
      const r = outcome.value;
      if (r.kind === 'graded') {
        result.graded += 1;
      } else if (r.kind === 'skipped_no_text') {
        result.skipped_no_text += 1;
      }
      if (r.charged) {
        result.estimated_grader_cost_inr =
          Math.round((result.estimated_grader_cost_inr + estimatedGraderInrPerCall) * 10000) / 10000;
      }
    }
  }

  return result;
}

interface PairOutcome {
  kind: 'graded' | 'skipped_no_text';
  /** True when a Sonnet call was actually issued (counts toward the grader cap). */
  charged: boolean;
}

/**
 * Per-pair worker. Resolves text, calls the grader, writes the result.
 * Always returns a tagged outcome so the batch driver can attribute
 * skips correctly.
 *
 * The grader is invoked with grade + coach_mode (A1 review fix). Coach mode
 * is NOT yet stored on mol_request_logs (P13-bound design call deferred),
 * so we pass null today and the grader prompt downgrades scaffold_fidelity
 * scoring accordingly. TODO(C4.2b-iii): plumb coach_mode via a new column
 * on mol_request_logs or via mol_shadow_pairs_v1.
 */
async function gradeOnePair(
  supabase: SupabaseLike,
  pair: {
    request_id: string;
    task_type: string;
    shadow_of_request_id: string | null;
    grade: string | null;
  },
  grader: typeof GradeShadowPairFn | undefined,
  now: Date,
): Promise<PairOutcome> {
  const texts = await resolveTexts(supabase, pair);
  if (!texts) {
    // Either the buffer row is missing (text capture off when the shadow
    // ran, or worker recycled mid-stream before drain, or sweeper already
    // GC'd a stale row) OR resolveTexts errored. Either way the grader
    // has nothing to compare against; degrade gracefully.
    return { kind: 'skipped_no_text', charged: false };
  }
  // Defensive: the grader argument is required at the production call site
  // (daily-cron passes gradeShadowPair). Tests can omit it to exercise the
  // skipped path without booting a real Anthropic key.
  if (!grader) {
    return { kind: 'skipped_no_text', charged: false };
  }
  const startMs = now.getTime();
  let out: GraderResult | null;
  try {
    out = await grader({
      question: texts.question,
      baseline_text: texts.baseline_text,
      shadow_text: texts.shadow_text,
      grade: pair.grade ?? '',
      // TODO(C4.2b-iii: coach_mode column on mol_request_logs).
      coach_mode: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] grader threw for ${pair.request_id}: ${msg}`);
    // We dispatched the Sonnet call — even on throw, charge the estimate.
    return { kind: 'skipped_no_text', charged: true };
  }
  // Whether or not the grader returned a usable score, we issued the
  // Sonnet request → charge the estimate against the daily cap.
  if (!out) {
    await writeGraderTelemetry(supabase, pair, null, now.getTime() - startMs);
    return { kind: 'skipped_no_text', charged: true };
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
      await writeGraderTelemetry(supabase, pair, out, now.getTime() - startMs);
      return { kind: 'skipped_no_text', charged: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] update threw for ${pair.request_id}: ${msg}`);
    await writeGraderTelemetry(supabase, pair, out, now.getTime() - startMs);
    return { kind: 'skipped_no_text', charged: true };
  }
  // B6 telemetry: persist the grader call so mol_request_health_24h
  // surfaces it. Best-effort — telemetry failure does not roll back the
  // grading row.
  await writeGraderTelemetry(supabase, pair, out, now.getTime() - startMs);
  // C4.2b-ii: belt-and-braces cleanup. The pg_cron sweeper (every 6h)
  // will also catch unswept rows, but cleaning up here sheds storage as
  // fast as the grader catches up. Best-effort: never blocks the score
  // we just wrote.
  await cleanupGradedText(supabase, pair.request_id);
  return { kind: 'graded', charged: true };
}

/**
 * Resolve baseline + shadow response texts for one pair from
 * mol_shadow_text_buffer (C4.2b-ii). Returns null when:
 *   * the row is missing (text capture was off when the shadow ran, OR
 *     the worker recycled before the streaming path drained its stash, OR
 *     the 7-day TTL sweeper already deleted the row),
 *   * the SELECT itself errors (network, RLS denial in non-service-role
 *     environments — service role bypasses RLS so this is rare).
 *
 * On null the caller takes the `skipped_no_text` branch — identical
 * shape to the C4.2b-i scaffold-mode outcome.
 *
 * Service-role read (the cron runs with the service-role JWT) bypasses
 * mol_shadow_text_buffer's admin-only RLS policy. The select returns
 * the four fields the grader needs:
 *   - question_text          → texts.question
 *   - baseline_response_text → texts.baseline_text
 *   - shadow_response_text   → texts.shadow_text
 *   - baseline_system_prompt → texts.baseline_system_prompt
 *
 * The grader's question/baseline/shadow shape predates this migration so
 * we name the return fields the same way for minimal blast radius. The
 * baseline_system_prompt is an additive field that future grader rubrics
 * can read for scaffold_fidelity scoring; today it's unused.
 */
async function resolveTexts(
  supabase: SupabaseLike,
  pair: {
    request_id: string;
    task_type: string;
    shadow_of_request_id: string | null;
    grade: string | null;
  },
): Promise<{
  question: string;
  baseline_text: string;
  shadow_text: string;
  baseline_system_prompt: string;
} | null> {
  try {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supabase.from('mol_shadow_text_buffer') as any)
      .select(
        'question_text,baseline_system_prompt,baseline_response_text,shadow_response_text',
      )
      .eq('shadow_request_id', pair.request_id)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn(
        `[grader-cron] resolveTexts read error for ${pair.request_id}: ${error.message ?? String(error)}`,
      );
      return null;
    }
    if (!data) return null;
    const row = data as {
      question_text: string;
      baseline_system_prompt: string;
      baseline_response_text: string;
      shadow_response_text: string;
    };
    return {
      question: row.question_text,
      baseline_text: row.baseline_response_text,
      shadow_text: row.shadow_response_text,
      baseline_system_prompt: row.baseline_system_prompt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] resolveTexts threw for ${pair.request_id}: ${msg}`);
    return null;
  }
}

/**
 * Belt-and-braces cleanup: after a successful grade lands the score on
 * mol_request_logs, DELETE the corresponding text buffer row. The
 * pg_cron sweeper (every 6h, 7-day TTL) will catch anything we miss, but
 * grader-side delete sheds storage as fast as the grader catches up.
 *
 * Best-effort: cleanup failure MUST NOT roll back the grader write. We
 * already have the score persisted; the worst case is the row lives for
 * up to 7 days until the sweeper picks it up.
 */
async function cleanupGradedText(
  supabase: SupabaseLike,
  shadow_request_id: string,
): Promise<void> {
  try {
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase.from('mol_shadow_text_buffer') as any)
      .delete()
      .eq('shadow_request_id', shadow_request_id);
    if (error) {
      console.warn(
        `[grader-cron] cleanupGradedText error for ${shadow_request_id}: ${error.message ?? String(error)}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] cleanupGradedText threw for ${shadow_request_id}: ${msg}`);
  }
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

/**
 * Emit one audit_logs row after a successful kill_switch flip (B1 review
 * fix). Uses actor_type='cron' which matches the canonical check
 * constraint added in 20260528000006_audit_logs_admin_actor_type.sql.
 * Best-effort: telemetry failure must not mask the kill-switch outcome.
 */
async function emitKillSwitchAudit(
  supabase: SupabaseLike,
  payload: { daily_shadow_cost_inr: number; cap_inr: number; run_at: string },
): Promise<void> {
  try {
    // The shape mirrors audit_logs columns added in the Phase G.4 migration:
    //   actor_type='cron', resource_type='mol_shadow_grader',
    //   action='mol_shadow_kill_switch_flipped', details=<jsonb>.
    // We pass auth_user_id=null because the action originated from a
    // scheduled job, not a user session.
    // deno-lint-ignore no-explicit-any
    const builder = (supabase.from('audit_logs') as any);
    if (typeof builder.insert !== 'function') {
      console.warn('[grader-cron] audit_logs insert unsupported on this client');
      return;
    }
    const { error } = await builder.insert({
      auth_user_id: null,
      actor_type: 'cron',
      action: 'mol_shadow_kill_switch_flipped',
      resource_type: 'mol_shadow_grader',
      resource_id: 'ff_grounded_answer_mol_shadow_v1',
      details: {
        daily_shadow_cost_inr: payload.daily_shadow_cost_inr,
        cap_inr: payload.cap_inr,
        run_at: payload.run_at,
        actor: 'system:mol-grader-cron',
      },
      status: 'success',
    });
    if (error) {
      console.warn(`[grader-cron] audit_logs insert failed: ${error.message ?? String(error)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] audit_logs threw: ${msg}`);
  }
}

/**
 * Optional B6 telemetry: write one row per grader call into
 * mol_request_logs tagged `task_type='shadow_grader'` and `surface='cron'`.
 * Lets `mol_request_health_24h` and downstream dashboards surface Sonnet
 * grader spend alongside baseline/shadow rows without a separate schema.
 *
 * Best-effort: telemetry failure must not roll back the grading row.
 * Uses the ESTIMATED INR cost (not the actual API charge — Sonnet usage
 * tokens are inside the grader payload). Real cost reconciliation is a
 * follow-up.
 */
async function writeGraderTelemetry(
  supabase: SupabaseLike,
  pair: { request_id: string; task_type: string },
  result: GraderResult | null,
  latency_ms: number,
): Promise<void> {
  try {
    // deno-lint-ignore no-explicit-any
    const builder = (supabase.from('mol_request_logs') as any);
    if (typeof builder.insert !== 'function') {
      // Mocks that do not implement insert simply silently skip telemetry;
      // production supabase-js always provides .insert.
      return;
    }
    const failed = result === null;
    await builder.insert({
      request_id: `grader-${pair.request_id}`,
      task_type: 'shadow_grader',
      surface: 'cron',
      provider: 'anthropic',
      model: result?.model ?? 'claude-sonnet-4-6-20251022',
      passes: 1,
      fallback_count: 0,
      failure_chain: failed ? 'grader:no_result' : null,
      latency_ms: Math.max(0, Math.round(latency_ms)),
      prompt_tokens: result?.prompt_tokens ?? 0,
      completion_tokens: result?.completion_tokens ?? 0,
      usd_cost: 0,
      inr_cost: ESTIMATED_GRADER_INR_PER_CALL,
      // shadow_role intentionally NULL — the grader telemetry rows are
      // their own class; not baseline, not shadow.
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[grader-cron] grader telemetry failed: ${msg}`);
  }
}
