// supabase/functions/_shared/mol/telemetry.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ProviderResponse, TokenUsage } from './types.ts'
import { redactPIIInText } from '../redact-pii.ts'

// USD per 1M tokens. Source: model_pricing table (seeded). Local fallback kept
// in sync with that migration. If you change either, change both.
const PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'openai/gpt-4o':      { input: 2.50, output: 10.00 },
  'openai/o3-mini':     { input: 1.10, output: 4.40 },
  'openai/o1':          { input: 15.00, output: 60.00 },
  'anthropic/claude-haiku-4-5-20251001':  { input: 1.00, output: 5.00 },
  'anthropic/claude-sonnet-4-6-20251022': { input: 3.00, output: 15.00 },
  'anthropic/claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'anthropic/claude-3-opus-20240229':    { input: 15.00, output: 75.00 },
}

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
  return (t.prompt / 1_000_000) * p.input + (t.completion / 1_000_000) * p.output
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
   * 'baseline' = this row served the user.
   * 'shadow'   = this row was discarded, kept only for offline comparison.
   * NULL/undefined for legacy / non-shadow rows.
   *
   * The shadow_role CHECK constraint in 20260519000001_mol_shadow_routing.sql
   * enforces the same two-value enum at the DB level.
   */
  shadow_role?: 'baseline' | 'shadow' | null

  /**
   * grounded_ai_traces.id when this MOL call originated from grounded-answer.
   * NULL/undefined for direct MOL callers (foxy-tutor, ncert-solver, etc).
   * Cross-service correlation key — joins mol_request_logs to the trace row
   * that spawned this LLM call.
   */
  trace_id?: string | null
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
      usd_cost: p.usd_cost,
      inr_cost: p.inr_cost,
      grade: p.grade,
      language: p.language,
      exam_goal: p.exam_goal,
      shadow_of_request_id: p.shadow_of_request_id ?? null,
      shadow_role: p.shadow_role ?? null,
      trace_id: p.trace_id ?? null,
    }).then(
      () => {},
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[mol] telemetry write failed:', msg)
      },
    )
  } catch (err) {
    console.warn('[mol] telemetry call threw synchronously:', (err as Error)?.message ?? err)
  }
}

/** Combine pass-1 and pass-2 token usage into a single MolResult tokens block. */
export function sumTokens(responses: ProviderResponse[]): TokenUsage {
  return responses.reduce(
    (acc, r) => ({ prompt: acc.prompt + r.tokens.prompt, completion: acc.completion + r.tokens.completion }),
    { prompt: 0, completion: 0 } as TokenUsage,
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
