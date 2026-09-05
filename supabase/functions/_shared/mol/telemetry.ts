// supabase/functions/_shared/mol/telemetry.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ProviderResponse, TokenUsage } from './types.ts'
import { redactPIIInText } from '../redact-pii.ts'
// 2026-09-02 (§5 data-integrity fix): recordMolRequest was a pure
// console.warn-and-drop on insert failure — invisible to anyone not tailing
// this specific Edge Function's stdout at the exact moment. logOpsEvent
// writes into the SAME ops_events table this repo's own alert pipeline
// (evaluate_alert_rules / alert-deliverer) already watches, so a failure
// here becomes an alertable event instead of a log line nobody reads.
import { logOpsEvent } from '../ops-events.ts'

// USD per 1M tokens. Source: model_pricing table (seeded). Local fallback kept
// in sync with that migration. If you change either, change both.
const PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'openai/gpt-4o':      { input: 2.50, output: 10.00 },
  'openai/o3-mini':     { input: 1.10, output: 4.40 },
  'openai/o1':          { input: 15.00, output: 60.00 },
  'anthropic/claude-haiku-4-5-20251001':  { input: 1.00, output: 5.00 },
  // Key aligned to the id pinned by config-model-name-identity.test.ts /
  // registry.ts (ANTHROPIC_SONNET_ID) / quality-eval.ts (JUDGE_MODEL).
  // 2026-08-31: repinned to claude-sonnet-4-5-20250929 after the previous id
  // was RETIRED (HTTP 404 not_found_error); replacement confirmed live.
  // Values unchanged (same 3.00 / 15.00 per-1M Sonnet-tier pricing).
  'anthropic/claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
  'anthropic/claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'anthropic/claude-3-opus-20240229':    { input: 15.00, output: 75.00 },
}

/**
 * Anthropic prompt-caching price multipliers, relative to the model's base
 * input rate. Cache reads are 10% of input; cache writes are 125% (you pay a
 * premium once to populate the entry, then read cheaply for the TTL).
 * Provider-agnostic by construction: OpenAI responses never set the cache
 * counters, so these multiply zero there.
 */
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

function usdToInrRate(): number {
  return Number(Deno.env.get('USD_TO_INR') ?? '83')
}

export function calcCost(provider: string, model: string, t: TokenUsage): number {
  const exactKey = `${provider}/${model}`
  let p = PRICING[exactKey]
  if (!p) {
    // OpenAI/Anthropic return date-pinned model strings (e.g. gpt-4o-2024-08-06).
    // Strip the trailing -YYYY-MM-DD and retry with the base alias so we don't
    // need to update PRICING every time a new dated version drops.
    const baseModel = model.replace(/-\d{4}-\d{2}-\d{2}$/, '')
    p = PRICING[`${provider}/${baseModel}`]
  }
  if (!p) return 0
  // Anthropic prompt-caching multipliers (published rates, relative to the
  // model's base input price): a cache READ bills at 0.1x, a cache WRITE at
  // 1.25x. Both default to 0 so OpenAI and every pre-caching caller compute
  // exactly as before.
  //
  // Omitting these is what made cached Anthropic calls look almost free: the
  // bulk of the prompt moved out of `input_tokens` into the cache counters and
  // then priced at zero. A cache read is cheap, not free, and a cache write
  // costs MORE than an uncached token — so leaving writes out biases the
  // estimate in the most misleading direction available.
  const cacheRead = t.cache_read ?? 0
  const cacheWrite = t.cache_write ?? 0
  return (t.prompt / 1_000_000) * p.input
    + (cacheRead / 1_000_000) * p.input * CACHE_READ_MULTIPLIER
    + (cacheWrite / 1_000_000) * p.input * CACHE_WRITE_MULTIPLIER
    + (t.completion / 1_000_000) * p.output
}

export function toInr(usd: number): number {
  return Math.round(usd * usdToInrRate() * 10000) / 10000
}

export interface LogPayload {
  request_id: string
  student_id: string | null
  task_type: string
  surface: string | null
  provider: string
  model: string
  passes: number
  fallback_count: number
  failure_chain: string | null
  latency_ms: number
  tokens: TokenUsage
  usd_cost: number
  inr_cost: number
  grade: string | null
  language: string | null
  exam_goal: string | null
  // ── C4 foundation (2026-05-19): shadow-routing pair correlation ──
  // All three fields OPTIONAL — pre-C4 callers (foxy-tutor, ncert-solver,
  // direct MOL clients, and the C3 mol-telemetry-adapter) pass none of them
  // and write NULLs into the new columns, preserving the legacy contract.
  //
  // The grader-cron fields (shadow_grader_score / shadow_grader_payload /
  // shadow_graded_at) are intentionally NOT on LogPayload — those are
  // written by the async grader in a separate UPDATE statement in C4.2,
  // never by the request-time recorder.

  /**
   * When this log row is a shadow leg, the baseline leg's request_id.
   * Maps directly to mol_request_logs.shadow_of_request_id.
   * NULL/undefined for baseline rows and non-shadow callers.
   */
  shadow_of_request_id?: string | null

  /**
   * 'baseline'       = this row served the user.
   * 'shadow'         = this row was discarded, kept only for offline comparison.
   * 'failed_attempt' = one non-final rung of claude.ts's modelOrder fallback
   *                    loop that errored before the caller moved to the next
   *                    model (2026-09-01 cost-visibility fix) — never a
   *                    served answer, usd_cost/tokens are 0. Deliberately
   *                    excluded from mol_shadow_pairs_v1 and any
   *                    shadow_role='baseline' cost query, which is exactly
   *                    the "don't skew the per-model averages" concern that
   *                    used to justify not writing these rows at all.
   * NULL/undefined for legacy / non-shadow rows.
   *
   * The shadow_role CHECK constraint in 20260519000001_mol_shadow_routing.sql
   * (widened to 3 values by 20260901170000_mol_request_logs_failed_attempt_
   * shadow_role.sql) enforces the same enum at the DB level.
   */
  shadow_role?: 'baseline' | 'shadow' | 'failed_attempt' | null

  /**
   * grounded_ai_traces.id when this MOL call originated from grounded-answer.
   * NULL/undefined for direct MOL callers (foxy-tutor, ncert-solver, etc).
   * Cross-service correlation key — joins mol_request_logs to the trace row
   * that spawned this LLM call.
   */
  trace_id?: string | null

  /**
   * Cost optimization (2026-09-05): why this call was routed to a
   * higher-tier model instead of the default tier for its caller/mode
   * (e.g. 'essay_length_request' when a Foxy learn/explain turn explicitly
   * requested model_preference: 'sonnet'). NULL/undefined when no
   * escalation occurred -- the overwhelming majority of rows. Maps directly
   * to mol_request_logs.escalation_reason (migration
   * 20260905120000_foxy_cost_optimization_logging_columns.sql).
   */
  escalation_reason?: string | null
}

// deno-lint-ignore no-explicit-any
let _client: any = null
function client() {
  if (_client) return _client
  _client = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
  return _client
}

/** Fire-and-forget. Never throw; observability must never break user requests. */
export function recordMolRequest(p: LogPayload): void {
  try {
    // C4 foundation: shadow_of_request_id / shadow_role / trace_id are all
    // OPTIONAL on LogPayload. We coerce undefined → null at this boundary so
    // the insert always writes an explicit value into the new NULLABLE
    // columns. Legacy callers (no shadow fields) become explicit NULLs,
    // matching the pre-C4 row shape.
    void client().from('mol_request_logs').insert({
      request_id: p.request_id,
      student_id: p.student_id,
      task_type: p.task_type,
      surface: p.surface,
      provider: p.provider,
      model: p.model,
      passes: p.passes,
      fallback_count: p.fallback_count,
      failure_chain: p.failure_chain,
      latency_ms: p.latency_ms,
      prompt_tokens: p.tokens.prompt,
      completion_tokens: p.tokens.completion,
      // Added 2026-09-01 (migration 20260901150000). Default 0 rather than
      // null so `sum(cache_read_tokens)` never silently drops rows, and so a
      // provider that reports no caching is distinguishable from one that was
      // never asked. See TokenUsage's header for why these were missing.
      cache_read_tokens: p.tokens.cache_read ?? 0,
      cache_write_tokens: p.tokens.cache_write ?? 0,
      usd_cost: p.usd_cost,
      inr_cost: p.inr_cost,
      grade: p.grade,
      language: p.language,
      exam_goal: p.exam_goal,
      shadow_of_request_id: p.shadow_of_request_id ?? null,
      shadow_role: p.shadow_role ?? null,
      trace_id: p.trace_id ?? null,
      escalation_reason: p.escalation_reason ?? null,
    }).then(
      () => {},
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[mol] telemetry write failed:', msg)
        // severity:'error' is AWAITED inside logOpsEvent (guaranteed delivery
        // per its own contract), but that await happens INSIDE this detached
        // .then() branch — it adds no latency to the student-facing request,
        // which already returned before this callback runs. Never throws
        // (logOpsEvent's own contract), so this cannot introduce a new
        // unhandled-rejection path.
        void logOpsEvent({
          category: 'ai',
          source: 'mol_request_logs',
          severity: 'error',
          message: `mol_request_logs insert failed: ${msg}`,
          subjectType: 'mol_request_logs_row',
          subjectId: p.request_id,
          requestId: p.request_id,
          context: {
            surface: p.surface,
            task_type: p.task_type,
            provider: p.provider,
            model: p.model,
            student_id: p.student_id,
            usd_cost: p.usd_cost,
            prompt_tokens: p.tokens.prompt,
            completion_tokens: p.tokens.completion,
            cache_read_tokens: p.tokens.cache_read ?? 0,
            cache_write_tokens: p.tokens.cache_write ?? 0,
            error: msg,
          },
        })
      },
    )
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err)
    console.warn('[mol] telemetry call threw synchronously:', msg)
    void logOpsEvent({
      category: 'ai',
      source: 'mol_request_logs',
      severity: 'error',
      message: `mol_request_logs insert threw synchronously: ${msg}`,
      subjectType: 'mol_request_logs_row',
      subjectId: p.request_id,
      requestId: p.request_id,
      context: { surface: p.surface, task_type: p.task_type, error: msg },
    })
  }
}

/** Combine pass-1 and pass-2 token usage into a single MolResult tokens block. */
export function sumTokens(responses: ProviderResponse[]): TokenUsage {
  return responses.reduce(
    (acc, r) => ({
      prompt: acc.prompt + r.tokens.prompt,
      completion: acc.completion + r.tokens.completion,
      // `?? 0` on BOTH sides: a mixed hybrid pass can pair an Anthropic
      // response carrying cache counters with an OpenAI one that never does.
      cache_read: (acc.cache_read ?? 0) + (r.tokens.cache_read ?? 0),
      cache_write: (acc.cache_write ?? 0) + (r.tokens.cache_write ?? 0),
    }),
    { prompt: 0, completion: 0, cache_read: 0, cache_write: 0 } as TokenUsage,
  )
}

// ─── C4.2b-ii text capture for Sonnet grader (2026-05-20) ────────────────────
//
// recordShadowText writes one row into mol_shadow_text_buffer carrying the
// full baseline + shadow texts the grader will compare offline. The row has
// a 7-day TTL (DB default) and gets DELETED by the grader cron after a
// successful grade, so storage is bounded.
//
// PII redaction at WRITE time: every user-derived text field passes through
// redactPIIInText (email / Indian phone / Razorpay-ID). The aggregated set
// of redactor labels is persisted in `redaction_applied[]` so auditors can
// quantify exposure if questions arise.
//
// Gating: the CALLER (mol-shadow.ts) checks ff_mol_shadow_text_capture_v1
// BEFORE invoking this helper. This module assumes the flag has already
// passed; it does the redaction + insert unconditionally. Keeping the flag
// check at the call site means the helper stays focused on the I/O
// contract and is trivially unit-testable.
//
// Fire-and-forget: matches recordMolRequest above. Telemetry MUST NOT
// extend request latency or surface errors to the user-facing path.

/** Payload accepted by recordShadowText. All text fields are pre-PII-redaction. */
export interface ShadowTextPayload {
  /** The baseline (Anthropic) call's request_id — matches mol_request_logs.request_id of the baseline row. */
  baseline_request_id: string
  /**
   * The shadow (OpenAI) call's request_id — matches mol_request_logs.request_id
   * of the shadow row. This is the JOIN key the grader cron uses to look the
   * row up via shadow_request_id.
   */
  shadow_request_id: string
  /** The student's question / user message as composed by the baseline. */
  question_text: string
  /** The full system prompt sent to Anthropic by the baseline. */
  baseline_system_prompt: string
  /**
   * The system prompt sent to OpenAI by the shadow. NULL when prompt-parity
   * (C4.2a fix) means the shadow reused the baseline prompt verbatim.
   */
  shadow_system_prompt: string | null
  /** The full text Anthropic returned to the user. */
  baseline_response_text: string
  /** The full text OpenAI returned to the (discarded) shadow path. */
  shadow_response_text: string
}

/**
 * Dedupe + sort a list of redactor labels so `redaction_applied[]` has a
 * stable, deterministic shape across rows. The grader-cron / audit tooling
 * filters on these labels via `?@>` array containment, so order doesn't
 * matter — but a stable order keeps row dumps grep-friendly.
 */
function dedupeAndSortRedactors(labels: string[]): string[] {
  return Array.from(new Set(labels)).sort();
}

/**
 * Fire-and-forget write to mol_shadow_text_buffer. Never throws. The DB
 * has a 7-day TTL on the row; the grader cron DELETEs the row on
 * successful grading. PII redaction (email/phone/razorpay-id) fires at
 * write time across all five text fields; the aggregated `applied[]`
 * labels are persisted on the row so auditors can quantify exposure.
 *
 * On any error (network, RLS denial, RPC failure) we log a single warn
 * line and swallow. The grader cron sees the missing row as
 * `skipped_no_text` — the same scaffold-mode signal it already handles —
 * so failure here degrades gracefully.
 */
export function recordShadowText(p: ShadowTextPayload): void {
  try {
    // Redact every user-derived field. baseline_system_prompt and the
    // composed question can carry student-supplied content (the user's
    // question is embedded in the system prompt for soft mode); the
    // response texts can echo or summarize PII the student volunteered.
    // The shadow_system_prompt is normally NULL (prompt-parity); when
    // non-null it deserves the same redaction.
    const q = redactPIIInText(p.question_text);
    const baseSys = redactPIIInText(p.baseline_system_prompt);
    const baseResp = redactPIIInText(p.baseline_response_text);
    const shadowResp = redactPIIInText(p.shadow_response_text);
    const shadowSys = p.shadow_system_prompt !== null
      ? redactPIIInText(p.shadow_system_prompt)
      : null;

    const applied = dedupeAndSortRedactors([
      ...q.applied,
      ...baseSys.applied,
      ...baseResp.applied,
      ...shadowResp.applied,
      ...(shadowSys ? shadowSys.applied : []),
    ]);

    void client().from('mol_shadow_text_buffer').insert({
      baseline_request_id: p.baseline_request_id,
      shadow_request_id: p.shadow_request_id,
      question_text: q.text,
      baseline_system_prompt: baseSys.text,
      shadow_system_prompt: shadowSys ? shadowSys.text : null,
      baseline_response_text: baseResp.text,
      shadow_response_text: shadowResp.text,
      redaction_applied: applied,
    }).then(
      () => {},
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[mol] shadow text buffer write failed:', msg);
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[mol] recordShadowText threw synchronously:', msg);
  }
}
