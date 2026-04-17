// supabase/functions/_shared/grounded-client.ts
//
// Deno client helper for the grounded-answer Edge Function service.
// Edge Functions that need a grounded LLM answer go through this helper so
// Voyage/Claude calls, RAG retrieval, circuit-breaker, and prompt-template
// resolution stay centralized in supabase/functions/grounded-answer/.
//
// Contract lives in supabase/functions/grounded-answer/types.ts — the
// interfaces below are a *copy* of that contract because each Edge Function
// has its own module graph and can't cleanly share one file. If the shape
// changes on the service side, update this file in the same PR.
//
// Mirror of src/lib/ai/grounded-client.ts (same helper in the Next.js tree).
// The Node version posts to the public `/functions/v1/grounded-answer` URL;
// this Deno version posts to the same URL so both callers go through the
// same service code path. Keep the two clients in sync.

// ─── Types (mirror supabase/functions/grounded-answer/types.ts) ──────────────

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
   * Pick a value slightly larger than `request.timeout_ms` so the service can
   * return its own abstain payload before we give up.
   */
  hopTimeoutMs?: number;
}

const DEFAULT_HOP_TIMEOUT_MS = 2000;

/**
 * Build an abstain payload in the same shape the service returns on error,
 * so every caller uses one control flow for service-side and client-side
 * failures.
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
 * response. Never throws — all network / timeout / HTTP-500 paths collapse
 * into `{ grounded: false, abstain_reason: 'upstream_error' }` so callers
 * only handle the service contract.
 */
export async function callGroundedAnswer(
  request: GroundedRequest,
  options: CallOptions = {},
): Promise<GroundedResponse> {
  const hopTimeoutMs = options.hopTimeoutMs ?? DEFAULT_HOP_TIMEOUT_MS;
  const startedAt = Date.now();

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceKey) {
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
      return buildHopError('service-500', Date.now() - startedAt);
    }

    if (!res.ok) {
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

/**
 * Check whether a feature flag is enabled by reading `feature_flags` via the
 * service role. Returns `false` on any error so we fail safe (flag off → use
 * legacy path). Edge Functions don't have access to src/lib/feature-flags.ts
 * so this lightweight check suffices for kill-switch gating.
 *
 * Does not implement environment / role / institution scoping — every caller
 * in the Phase 3 rollout uses the global boolean, gated at the super-admin
 * control plane.
 */
export async function isFeatureFlagEnabled(flagName: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return false;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/feature_flags?select=is_enabled&flag_name=eq.${encodeURIComponent(flagName)}`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return false;
    return rows[0]?.is_enabled === true;
  } catch {
    return false;
  }
}