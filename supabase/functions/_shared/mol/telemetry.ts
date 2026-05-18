// supabase/functions/_shared/mol/telemetry.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ProviderResponse, TokenUsage } from './types.ts'

// USD per 1M tokens. Source: model_pricing table (seeded). Local fallback kept
// in sync with that migration. If you change either, change both.
const PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'openai/gpt-4o':      { input: 2.50, output: 10.00 },
  'anthropic/claude-haiku-4-5-20251001':  { input: 1.00, output: 5.00 },
  'anthropic/claude-sonnet-4-6-20251022': { input: 3.00, output: 15.00 },
}

function usdToInrRate(): number {
  return Number(Deno.env.get('USD_TO_INR') ?? '83')
}

export function calcCost(provider: string, model: string, t: TokenUsage): number {
  const key = `${provider}/${model}`
  const p = PRICING[key]
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
