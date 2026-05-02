// src/lib/ai/grounded-client.ts
//
// Next.js client helper for the grounded-answer Edge Function service.
// All Next.js routes that need a grounded LLM answer go through this helper
// so Voyage/Claude calls, RAG retrieval, circuit-breaker, and prompt-template
// resolution stay centralized in `supabase/functions/grounded-answer/`.
//
// Contract lives in `supabase/functions/grounded-answer/types.ts` — the
// interfaces below are a *copy* of that contract because Deno-TS and Next-TS
// module graphs can't cleanly share one file. If the shape changes on the Deno
// side, update this file in the same PR and run the config-parity test.
//
// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: this is the ONLY Next.js file allowed to POST directly to
// `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/grounded-answer`. Every other caller
// must go through `callGroundedAnswer()` so auth, timeouts, and error shapes
// stay consistent.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types (mirror supabase/functions/grounded-answer/types.ts) ──────────────

// Re-export FoxyResponse from the canonical schema module so callers don't
// have a second source of truth. The structured-rendering UI imports this
// type via `@/lib/ai/grounded-client` for ergonomic colocation with the
// response shape; the runtime/validation lives in `@/lib/foxy/schema`.
export type { FoxyResponse } from '@/lib/foxy/schema';

import type { FoxyResponse as FoxyResponseShape } from '@/lib/foxy/schema';

export type Caller =
  | 'foxy'
  | 'ncert-solver'
  | 'quiz-generator'
  | 'concept-engine'
  | 'diagnostic';

export type Mode = 'strict' | 'soft';

export type AbstainReason =
  | 'chapter_not_ready'
  | 'no_chunks_retrieved'
  | 'low_similarity'
  | 'no_supporting_chunks'
  | 'scope_mismatch'
  | 'upstream_error'
  | 'circuit_open';

export interface GroundedRequest {
  caller: Caller;
  student_id: string | null;
  query: string;
  scope: {
    board: 'CBSE';
    grade: string;
    subject_code: string;
    chapter_number: number | null;
    chapter_title: string | null;
  };
  mode: Mode;
  generation: {
    model_preference: 'haiku' | 'sonnet' | 'auto';
    max_tokens: number;
    temperature: number;
    system_prompt_template: string;
    template_variables: Record<string, string>;
  };
  retrieval: {
    match_count: number;
    min_similarity_override?: number;
  };
  retrieve_only?: boolean;
  timeout_ms: number;
}

export interface Citation {
  index: number;
  chunk_id: string;
  chapter_number: number;
  chapter_title: string;
  page_number: number | null;
  similarity: number;
  excerpt: string;
  media_url: string | null;
}

export interface SuggestedAlternative {
  grade: string;
  subject_code: string;
  chapter_number: number;
  chapter_title: string;
  rag_status: 'ready';
}

export type GroundedResponse =
  | {
      grounded: true;
      answer: string;
      citations: Citation[];
      confidence: number;
      /**
       * True when the answer was actually produced from the retrieved NCERT
       * chunks. False when soft-mode fell back to general CBSE knowledge or
       * the retrieve_only branch returned without an answer.
       *
       * Optional on the wire because cached responses written before this
       * field shipped (and any future legacy paths) may not include it. UI
       * code that needs a strict signal should treat `undefined` as the
       * conservative `false` (don't claim grounding we can't prove).
       *
       * Audit Phase 0 Fix 0.5 — this is what `was_grounded` should be
       * derived from in PostHog, not the abstain-status check.
       */
      groundedFromChunks?: boolean;
      /**
       * Foxy structured-response payload. Defined when caller='foxy' and the
       * Edge Function's parse+validate step succeeded (or fell back to
       * wrapAsParagraph). Other callers leave this undefined; they consume
       * the legacy `answer` markdown string instead.
       *
       * Optional on the wire because:
       *   - Non-Foxy callers never get it.
       *   - Older deployments of the Edge Function (pre-structured-output)
       *     never populated it; cached responses may still lack it.
       * UI renderers that understand the structured contract should prefer
       * this field over `answer` and fall back to `answer` when undefined.
       */
      structured?: FoxyResponseShape;
      trace_id: string;
      meta: { claude_model: string; tokens_used: number; latency_ms: number };
    }
  | {
      grounded: false;
      abstain_reason: AbstainReason;
      suggested_alternatives: SuggestedAlternative[];
      trace_id: string;
      meta: { latency_ms: number };
    };

// ─── Helper ──────────────────────────────────────────────────────────────────

interface CallOptions {
  /**
   * Maximum wall-clock time for the HTTP hop to the Edge Function. The service
   * internally enforces its own Voyage/Claude timeouts via `request.timeout_ms`.
   * This is ONLY the transport-level timeout. Default: 2000ms.
   *
   * Pick a value slightly larger than `request.timeout_ms` to leave room for
   * the service to return its own abstain payload before we give up.
   */
  hopTimeoutMs?: number;
}

const DEFAULT_HOP_TIMEOUT_MS = 2000;

/**
 * Build an abstain payload in the same shape the service would return on
 * error, so every caller can use one control flow for both service-side and
 * client-side failures.
 */
function buildHopError(
  traceId: string,
  latencyMs: number,
): GroundedResponse {
  return {
    grounded: false,
    abstain_reason: 'upstream_error',
    suggested_alternatives: [],
    trace_id: traceId,
    meta: { latency_ms: latencyMs },
  };
}

/**
 * POST a grounded-answer request to the Edge Function and return the parsed
 * response. Never throws — all network / timeout / HTTP-500 paths collapse into
 * an `{ grounded: false, abstain_reason: 'upstream_error' }` shape so callers
 * only have to handle the service contract.
 */
export async function callGroundedAnswer(
  request: GroundedRequest,
  options: CallOptions = {},
): Promise<GroundedResponse> {
  const hopTimeoutMs = options.hopTimeoutMs ?? DEFAULT_HOP_TIMEOUT_MS;
  const startedAt = Date.now();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    // Config missing — treat as upstream_error so caller refunds quota and
    // the student sees a clean "try again" path instead of a 500.
    return buildHopError('config-missing', Date.now() - startedAt);
  }

  const url = `${supabaseUrl}/functions/v1/grounded-answer`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), hopTimeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    clearTimeout(timer);

    if (res.status >= 500) {
      // Service returned a 5xx — upstream outage. Caller refunds quota.
      return buildHopError('service-500', Date.now() - startedAt);
    }

    if (!res.ok) {
      // 4xx from service (validation / caller misuse). Surface as upstream
      // error with trace for ops to diagnose; still don't throw.
      return buildHopError(`service-${res.status}`, Date.now() - startedAt);
    }

    const body = (await res.json()) as GroundedResponse;
    return body;
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (isAbort) {
      return buildHopError('hop-timeout', Date.now() - startedAt);
    }
    return buildHopError('network-error', Date.now() - startedAt);
  }
}

// ─── Streaming variant (Phase 1.1) ───────────────────────────────────────────
//
// The streaming variant returns a fetch Response whose body is the raw SSE
// stream from the Edge Function. Callers (currently only /api/foxy) pipe the
// body through to the browser AND tap a parser to track stream completion
// (so they can deduct quota on `done` and refund on `error`).
//
// We expose the raw Response (rather than parsing here) because Next.js Edge
// runtime's preferred pattern is to TransformStream the body to the client
// without buffering. The route layer attaches a TransformStream that
// double-pipes to:
//   (a) the client (verbatim re-emit, low-latency)
//   (b) a parser closure (to learn when `done`/`error` fires)

export interface StreamingCallOptions extends CallOptions { /* same */ }

/**
 * POST a streaming grounded-answer request and return the raw SSE Response.
 * Caller is responsible for piping the body to the browser and parsing the
 * stream for completion. Returns null on hop failure (caller should fall
 * back to non-streaming or surface an error).
 */
export async function callGroundedAnswerStream(
  request: GroundedRequest,
  options: StreamingCallOptions = {},
): Promise<{ ok: true; response: Response } | { ok: false; reason: string }> {
  // The hop timeout for streaming is intentionally LOOSE — Claude streams may
  // legitimately run for 30-60s. We rely on the Edge Function's per-call
  // timeout (request.timeout_ms) to bound the upstream call. This timeout is
  // only for the initial connection / first byte.
  const hopTimeoutMs = options.hopTimeoutMs ?? 5000;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return { ok: false, reason: 'config-missing' };
  }

  const url = `${supabaseUrl}/functions/v1/grounded-answer?stream=1`;

  // We do NOT abort the fetch on hopTimeoutMs — for streams the connection
  // legitimately stays open for the full duration. Instead, use a separate
  // AbortController bound only to the body-read phase if needed (caller
  // can cancel via response.body?.cancel()).
  const controller = new AbortController();
  const firstByteTimer = setTimeout(() => controller.abort(), hopTimeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
    });
    clearTimeout(firstByteTimer);

    if (!res.ok) {
      // Edge function rejected the streaming request before opening the body.
      // Drain any error body and return.
      try { await res.text(); } catch { /* ignore */ }
      return { ok: false, reason: `service-${res.status}` };
    }

    return { ok: true, response: res };
  } catch (err) {
    clearTimeout(firstByteTimer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: isAbort ? 'hop-timeout' : 'network-error' };
  }
}