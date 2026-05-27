// supabase/functions/_shared/mol/index.ts

import type {
  GenerateRequest,
  MolResult,
  ProviderResponse,
  TaskType,
} from './types.ts'
import { MolError } from './types.ts'
import { classify } from './classifier.ts'
import { selectProviderChain, getMaxTokens, getSimplifyMaxTokens } from './router.ts'
import { buildSystemPrompt, buildSimplifyPrompt } from './prompt-builder.ts'
import { postProcess } from './post-processor.ts'
import {
  calcCost,
  toInr,
  recordMolRequest,
  sumTokens,
} from './telemetry.ts'
import { isFlagEnabled } from './feature-flag.ts'
import { getRoutingWeights } from './feedback.ts'
import { AnthropicProvider } from './providers/anthropic.ts'
import { OpenAIProvider } from './providers/openai.ts'
import type { ModelProvider, ProviderCallOptions } from './providers/base.ts'
import { canRequest, recordSuccess, recordFailure, isRetryable } from './providers/shared.ts'

export * from './types.ts'

const providers: Record<'openai' | 'anthropic', ModelProvider> = {
  openai:    new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
}

function newRequestId(): string {
  return crypto.randomUUID()
}

interface PassExecution {
  response: ProviderResponse
  fallback_count: number
  failure_chain: string[]
}

/**
 * Execute one Pass: try the chain top-down, retry retryable errors, fall through to next provider on failure.
 */
async function executePass(
  chain: Array<{ provider: 'openai' | 'anthropic'; model: string }>,
  opts: ProviderCallOptions,
): Promise<PassExecution> {
  let fallback = 0
  const failures: string[] = []

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i]
    const provider = providers[target.provider]
    if (!provider.isConfigured()) {
      failures.push(`${target.provider}:not_configured`)
      fallback += 1
      continue
    }
    if (!canRequest(target.provider)) {
      failures.push(`${target.provider}:breaker_open`)
      fallback += 1
      continue
    }

    let attemptError: { code: string; status?: number } | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await provider.call(target.model, opts)
        recordSuccess(target.provider)
        return { response: r, fallback_count: fallback, failure_chain: failures }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Extract status from "Provider 503: ..." form
        const m = msg.match(/(\d{3})/)
        const status = m ? parseInt(m[1], 10) : undefined
        attemptError = { code: msg, status }
        failures.push(`${target.provider}:${status ?? 'err'}`)
        if (status && !isRetryable(status)) break
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
          continue
        }
      }
    }

    recordFailure(target.provider)
    fallback += 1
    void attemptError // keep last-known error in `failures`
  }

  throw new MolError('NO_PROVIDER_AVAILABLE', 'All providers in chain failed', { failures })
}

export async function generateResponse(req: GenerateRequest): Promise<MolResult> {
  const start = Date.now()
  const request_id = req.config?.request_id || newRequestId()

  // Validate
  if (!req.input || !req.student_context?.student_id) {
    throw new MolError('INVALID_INPUT', 'student_context.student_id and input are required')
  }
  if (!req.input.question && !req.input.instruction && !req.input.image_url && !req.input.topic) {
    throw new MolError('INVALID_INPUT', 'input must contain question, instruction, image_url, or topic')
  }

  // Classify
  const task_type: TaskType = classify(req)

  // Read flags + weights in parallel
  const [hybridOn, openaiDefault, weights] = await Promise.all([
    isFlagEnabled('ff_mol_hybrid_mode_v1', { student_id: req.student_context.student_id }),
    isFlagEnabled('ff_mol_openai_default', { student_id: req.student_context.student_id }),
    getRoutingWeights(),
  ])

  const user_text = req.input.question || req.input.instruction || req.input.topic || ''

  const selected = selectProviderChain(task_type, {
    hybrid_enabled: hybridOn,
    openai_default: openaiDefault,
    weights,
    student_context: req.student_context,
    query: user_text,
  })

  // Per-request preferred_provider override (admin only)
  if (req.config?.preferred_provider) {
    selected.passes = selected.passes.map((p) => ({
      ...p,
      chain: [
        ...p.chain.filter((c) => c.provider === req.config!.preferred_provider),
        ...p.chain.filter((c) => c.provider !== req.config!.preferred_provider),
      ],
    }))
  }

  // Build prompt.
  //
  // C4.2a wire-up: when req.config.system_prompt_override is set, use it
  // verbatim and bypass the prompt-builder. This is the prompt-parity
  // fix — shadow legs from grounded-answer must send the EXACT prompt
  // baseline sent to Claude so the offline grader compares responses to
  // the same question. The override path is exercised ONLY by mol-shadow.ts;
  // direct MOL callers (foxy-tutor, ncert-solver, quiz-generator) leave it
  // undefined and the prompt-builder runs normally.
  const system_prompt = req.config?.system_prompt_override
    ?? buildSystemPrompt(task_type, req.student_context, req.rag_context ?? null)

  const user_messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (req.input.chat_history) user_messages.push(...req.input.chat_history.slice(-10))
  user_messages.push({ role: 'user', content: user_text })

  const max_tokens = req.config?.max_tokens_override ?? getMaxTokens(task_type)

  // Execute pass(es)
  const responses: ProviderResponse[] = []
  let totalFallback = 0
  const allFailures: string[] = []

  // Pass 1
  const pass1 = await executePass(selected.passes[0].chain, {
    system_prompt,
    user_messages,
    max_tokens,
    image_url: req.input.image_url,
    timeout_ms: 20_000,
  })
  responses.push(pass1.response)
  totalFallback += pass1.fallback_count
  allFailures.push(...pass1.failure_chain)

  // Pass 2 (simplify) for hybrid
  if (selected.mode === 'hybrid' && selected.passes[1]) {
    const simplify_prompt = buildSimplifyPrompt(req.student_context, pass1.response.text)
    const pass2 = await executePass(selected.passes[1].chain, {
      system_prompt: simplify_prompt,
      user_messages: [{ role: 'user', content: 'Rewrite the answer above.' }],
      max_tokens: getSimplifyMaxTokens(),
      timeout_ms: 15_000,
    })
    responses.push(pass2.response)
    totalFallback += pass2.fallback_count
    allFailures.push(...pass2.failure_chain)
  }

  // Combine
  const finalText = postProcess(responses[responses.length - 1].text, task_type)
  const tokens = sumTokens(responses)

  // Cost (sum across passes, each priced by its own model)
  let usd = 0
  for (const r of responses) usd += calcCost(r.provider, r.model, r.tokens)
  const inr = toInr(usd)

  const latency_ms = Date.now() - start

  // Telemetry (fire-and-forget).
  //
  // C4.2a wire-up: when the caller (mol-shadow.ts) passes shadow_role /
  // shadow_of_request_id through req.config, propagate them onto the
  // LogPayload here. This is the de-dup fix — the orchestrator's auto-log
  // row is the ONLY row written per shadow call; the helper no longer
  // appends a second row. Pre-C4 callers leave the fields undefined and
  // the LogPayload's `??` defaults write NULLs (legacy contract).
  recordMolRequest({
    request_id,
    student_id: req.student_context.student_id,
    task_type,
    surface: req.config?.surface ?? null,
    provider: responses.length > 1 ? 'hybrid' : responses[0].provider,
    model: responses.map((r) => r.model).join(' + '),
    passes: responses.length,
    fallback_count: totalFallback,
    failure_chain: allFailures.length ? allFailures.join(',') : null,
    latency_ms,
    tokens,
    usd_cost: usd,
    inr_cost: inr,
    grade: req.student_context.grade,
    language: req.student_context.language,
    exam_goal: req.student_context.exam_goal ?? null,
    shadow_role: req.config?.shadow_role ?? null,
    shadow_of_request_id: req.config?.shadow_of_request_id ?? null,
    trace_id: req.config?.trace_id ?? null,
  })

  return {
    text: finalText,
    provider: responses.length > 1 ? 'hybrid' : responses[0].provider,
    model: responses.map((r) => r.model).join(' + '),
    task_type,
    latency_ms,
    tokens,
    usd_cost: Math.round(usd * 1_000_000) / 1_000_000,
    inr_cost: inr,
    fallback_count: totalFallback,
    passes: responses.length,
    request_id,
  }
}
