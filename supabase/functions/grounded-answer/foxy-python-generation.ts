// supabase/functions/grounded-answer/foxy-python-generation.ts
//
// Phase 2.2 (2026-07-15) — "MOL only on Python" serving seam for Foxy.
//
// This module is the SURGICAL model-generation seam. It routes ONLY the
// Claude/model-call step of the Foxy grounded-answer pipeline to the Python
// MOL service (`POST {PYTHON_AI_BASE_URL}/v1/generate`). Everything else —
// RAG retrieval, grounding-check, structured JSON validation
// (parseFoxyStructured), citations, abstain — stays in the TS pipeline
// UNCHANGED. This mirrors the repo's own unification design:
//   docs/superpowers/specs/2026-06-13-mol-python-unification-design.md
//   "Deno Edge Functions do auth + RAG retrieval, call the Python MOL
//    endpoint, stream back."
//
// DARK BY DEFAULT (three independent kill layers, any one ⇒ never route):
//   1. PYTHON_AI_BASE_URL empty  → architect kill (URL not wired in).
//   2. ff_python_foxy_tutor_v1 disabled / kill_switch → ops kill.
//   3. request bucket >= rollout_pct → not in the ramp cohort.
// All three are enforced by `shouldProxyToPython` from
// `../_shared/python-ai-proxy.ts` — we reuse it verbatim so the flag-envelope
// + kill-switch + hash-bucket semantics are byte-identical to every other
// per-function Python cutover.
//
// FAIL-SAFE: `generateFoxyViaPython` NEVER throws and returns `null` on ANY
// disable/error/timeout/non-2xx/empty-body condition. The pipeline treats
// `null` as "fall back to callClaude" so a Python outage can never fail a
// student turn — the TS Claude path is the safety net, exactly as today.
//
// The returned shape is a `ClaudeResponse` (ok:true) so the pipeline's
// downstream steps (insufficientContext gate, grounding-check, structured
// parse, continuation) consume it with zero branching — the model source is
// transparent past this seam. P12 is preserved end-to-end: the Python text is
// still run through parseFoxyStructured → wrapAsParagraph fallback, so a shape
// drift can never render raw JSON to a student.

import type { ClaudeResponse, ClaudeStopReason } from './claude.ts';
import { shouldProxyToPython } from '../_shared/python-ai-proxy.ts';

/** Flag that gates Foxy-on-Python. Seeded default-OFF in migration
 * 20260606000000_phase5_phase6_python_flags.sql. */
const FOXY_PYTHON_FLAG = 'ff_python_foxy_tutor_v1';

/** MOL generic entry point on the Python service. */
const GENERATE_ENDPOINT = '/v1/generate';

/**
 * Sentinel the strict-mode prompt can emit to signal "reference material does
 * not cover the question". Kept byte-identical to claude.ts so the pipeline's
 * insufficientContext → abstain gate fires the SAME way whether the model text
 * came from Claude (TS) or the Python MOL.
 */
const INSUFFICIENT_CONTEXT_SENTINEL = '{{INSUFFICIENT_CONTEXT}}';

/**
 * Cap the Python model call so a hung upstream cannot consume the whole turn
 * budget before we fall back to callClaude. Deliberately tighter than the full
 * `timeout_ms` so the fallback Claude call still has runway. On abort we return
 * null and the TS path runs.
 */
const PYTHON_GEN_TIMEOUT_CAP_MS = 25_000;

/**
 * A nil-UUID stand-in for anonymous / logged-out turns where the pipeline has
 * no student_id. Non-PII (P13) and non-empty (the Python StudentContext
 * validator rejects empty student_id). The Python /v1/generate student-scope
 * gate will reject this, which simply routes us to the TS fallback — never a
 * failed turn.
 */
const ANON_STUDENT_SENTINEL = '00000000-0000-0000-0000-000000000000';

export interface FoxyPythonGenerationArgs {
  /**
   * Per-request id used ONLY for the rollout hash-bucket. Mint a fresh id per
   * call (e.g. crypto.randomUUID) — we want a uniform random fraction of
   * TRAFFIC on Python, matching the python-ai-proxy bucketing contract.
   */
  requestId: string;
  /**
   * The FULLY-COMPOSED TS system prompt — persona + safety rails + retrieved
   * reference material + the FOXY_STRUCTURED_OUTPUT_PROMPT addendum. Sent as
   * `config.system_prompt_override` so the Python MOL uses the EXACT prompt
   * Claude would have seen (maximum output parity; RAG stays authoritative in
   * TS). The Python prompt-builder is bypassed on this path.
   */
  systemPrompt: string;
  /** Current student turn (the query). */
  userMessage: string;
  /** Prior conversation turns (native shape), forwarded as chat_history. */
  conversationTurns?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * The already-retrieved, sanitized NCERT reference material (the same
   * `reference_material_section` baked into `systemPrompt`). Passed through on
   * `rag_context` for contract completeness + telemetry. With
   * system_prompt_override set the Python builder ignores it, so retrieval
   * still happens EXACTLY ONCE, in TS (REG-50 single-retrieval preserved —
   * the Python MOL has no retrieval stage).
   */
  ragContext: string;
  studentId: string | null;
  grade: string;
  subjectCode: string;
  /** Anthropic model routing hint from the TS request. */
  modelPreference: 'haiku' | 'sonnet' | 'auto';
  /** Effective (Foxy-boosted) token budget the TS path would have used. */
  maxTokens: number;
  /** Effective (groundedness-capped) temperature the TS path would have used. */
  temperature: number;
  /** Full turn budget in ms; the Python call is capped tighter than this. */
  timeoutMs: number;
}

/**
 * Route the Foxy model-generation step to the Python MOL when enabled.
 *
 * Returns a `ClaudeResponse` (ok:true) on success, or `null` to signal the
 * caller MUST fall back to `callClaude`. NEVER throws.
 *
 * `null` is returned for ALL of:
 *   - routing disabled (empty base URL / flag off / kill switch / out of bucket)
 *   - network error / timeout / non-2xx from Python
 *   - a 2xx body missing usable `text`
 */
export async function generateFoxyViaPython(
  args: FoxyPythonGenerationArgs,
): Promise<ClaudeResponse | null> {
  let decision;
  try {
    decision = await shouldProxyToPython({
      flag_name: FOXY_PYTHON_FLAG,
      endpoint_path: GENERATE_ENDPOINT,
      request_id: args.requestId,
    });
  } catch {
    // shouldProxyToPython is documented never-throws, but belt-and-suspenders:
    // any failure means "do not route" → TS fallback.
    return null;
  }

  if (!decision.should_proxy || !decision.target_url) {
    // Dark-by-default happy path: no network, no added latency, no warn spam.
    return null;
  }

  const body = buildGenerateBody(args);

  const controller = new AbortController();
  const timeoutMs = Math.min(
    args.timeoutMs > 0 ? args.timeoutMs : PYTHON_GEN_TIMEOUT_CAP_MS,
    PYTHON_GEN_TIMEOUT_CAP_MS,
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Service-to-service auth. The Python /v1/generate endpoint currently
  // enforces `require_active_student` (student JWT + grade-scope match); the
  // grounded-answer pipeline holds no student JWT, so ops must provision a
  // service auth lane (or plumb the student token) before this can succeed on
  // Python — an architect/ops prerequisite gating the ramp. Until then Python
  // returns 401/403 → null → TS fallback (no student impact). We forward an
  // optional service token when provided so the wired-up path Just Works.
  const serviceToken = (Deno.env.get('PYTHON_AI_SERVICE_TOKEN') ?? '').trim();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-request-id': args.requestId,
  };
  if (serviceToken) headers['authorization'] = `Bearer ${serviceToken}`;

  let res: Response;
  try {
    res = await fetch(decision.target_url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn(`foxy-python: generate timeout after ${timeoutMs}ms — falling back to callClaude`);
    } else {
      console.warn(`foxy-python: generate fetch failed — falling back to callClaude (${String(err).slice(0, 120)})`);
    }
    return null;
  }
  clearTimeout(timer);

  if (!res.ok) {
    // Drain (bounded) so the connection is released; do not surface the body.
    await res.text().catch(() => '');
    console.warn(`foxy-python: generate returned HTTP ${res.status} — falling back to callClaude`);
    return null;
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    console.warn('foxy-python: generate returned non-JSON body — falling back to callClaude');
    return null;
  }

  return mapMolResultToClaudeResponse(payload);
}

/** Compose the Python `/v1/generate` GenerateRequest envelope. */
function buildGenerateBody(args: FoxyPythonGenerationArgs) {
  const chatHistory = (args.conversationTurns ?? []).map((t) => ({
    role: t.role,
    content: t.content,
  }));

  return {
    // 'explanation' is the stable Foxy conversational default. task_type only
    // steers Python router chain + default max_tokens; we override max_tokens
    // and pin the provider below, and the system prompt is supplied verbatim.
    task_type: 'explanation' as const,
    // Belt-and-suspenders structured signal. With system_prompt_override set
    // the Python builder is bypassed so this is a no-op in production, but it
    // documents intent and drives the Python FoxyResponse mode when a caller
    // lets Python build the prompt (parity harness path).
    structured: 'foxy' as const,
    input: {
      question: args.userMessage,
      ...(chatHistory.length > 0 ? { chat_history: chatHistory } : {}),
    },
    student_context: {
      student_id: args.studentId ?? ANON_STUDENT_SENTINEL,
      grade: args.grade,
      subject: args.subjectCode,
    },
    rag_context: args.ragContext || null,
    config: {
      // Foxy's persona / JSON contract / pedagogy tree are Claude-calibrated
      // (see claude.ts resolveModelOrder RCA note) → prefer Anthropic.
      // NOTE: haiku↔sonnet granularity is not expressible via preferred_provider
      // (the Python router owns model choice per task_type); tracked follow-up.
      preferred_provider: 'anthropic' as const,
      max_tokens_override: args.maxTokens,
      temperature_override: args.temperature,
      request_id: args.requestId,
      surface: 'foxy' as const,
      // THE parity mechanism: hand Python the exact composed TS prompt.
      system_prompt_override: args.systemPrompt,
    },
    // NB: modelPreference (haiku|sonnet|auto) is intentionally NOT sent — the
    // Python GenerateRequest/GenerateConfig use extra="forbid", and the Python
    // router owns model selection per task_type. We express the Foxy/Claude
    // calibration via preferred_provider='anthropic' above. Finer haiku↔sonnet
    // mapping is a tracked follow-up (would need a Python config field).
  };
}

/**
 * Map a Python MolResult's RAW provider `finish_reason` → the normalized
 * `ClaudeStopReason` the Foxy pipeline branches on.
 *
 * MolResult.finish_reason carries the winning provider's native stop vocabulary
 * (Anthropic `stop_reason`: end_turn|max_tokens|stop_sequence|tool_use; OpenAI
 * `finish_reason`: stop|length|content_filter|tool_calls). Only the truncation
 * signal matters here: the (flag-gated, default-OFF) bounded-continuation path
 * in pipeline.ts fires iff `stopReason === 'max_tokens'`. So we collapse to that
 * single distinction — mirroring claude.ts's two normalizers:
 *   - Anthropic `max_tokens` OR OpenAI `length` → 'max_tokens'
 *   - everything else, incl. absent/unknown       → 'end_turn'
 *
 * `end_turn` is the SAFE default: it never spuriously triggers a continuation,
 * and the wrapAsParagraph / truncation-rescue net in parseFoxyStructured still
 * covers any payload that was actually cut short but reported a non-truncation
 * reason. This preserves the seam's fail-safe posture while giving a
 * genuinely-truncated Python answer the SAME continuation the Claude path gets.
 */
function mapMolFinishReason(raw: unknown): ClaudeStopReason {
  return raw === 'max_tokens' || raw === 'length' ? 'max_tokens' : 'end_turn';
}

/**
 * Map a Python MolResult body → the TS `ClaudeResponse` (ok:true) shape.
 * Returns null when the body lacks usable text (treated as a soft failure →
 * TS fallback).
 */
// deno-lint-ignore no-explicit-any
function mapMolResultToClaudeResponse(payload: any): ClaudeResponse | null {
  const text = typeof payload?.text === 'string' ? payload.text : '';
  if (!text) return null;

  const provider = payload?.provider === 'openai' ? 'openai' : 'anthropic';
  const model = typeof payload?.model === 'string' && payload.model ? payload.model : 'python-mol';
  const inputTokens = typeof payload?.tokens?.prompt === 'number' ? payload.tokens.prompt : 0;
  const outputTokens = typeof payload?.tokens?.completion === 'number' ? payload.tokens.completion : 0;
  const fallbackCount = typeof payload?.fallback_count === 'number' ? payload.fallback_count : 0;
  const failureChain = Array.isArray(payload?.failure_chain) && payload.failure_chain.length > 0
    ? payload.failure_chain.map((x: unknown) => String(x))
    : undefined;

  return {
    ok: true,
    content: text,
    model,
    provider,
    inputTokens,
    outputTokens,
    // Preserve the abstain gate: strict-mode Foxy can legitimately return the
    // sentinel, and the pipeline turns that into a no_supporting_chunks abstain
    // — identical to the Claude path.
    insufficientContext: text.trim() === INSUFFICIENT_CONTEXT_SENTINEL,
    // Map the Python MolResult's RAW provider finish_reason onto the normalized
    // stop-reason union so a truncated Python answer triggers the flag-gated
    // bounded max_tokens-continuation exactly as a truncated Claude answer does.
    // Absent/unknown → 'end_turn' (safe default; never spuriously continues).
    stopReason: mapMolFinishReason(payload?.finish_reason),
    fallback_count: fallbackCount,
    failure_chain: failureChain,
  };
}
