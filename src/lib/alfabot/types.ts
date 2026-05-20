/**
 * AlfaBot shared TypeScript contract.
 *
 * Used by:
 *   - src/app/api/alfabot/route.ts            (POST chat handler)
 *   - src/app/api/alfabot/lead/route.ts       (POST lead capture handler)
 *   - src/lib/alfabot/client.ts               (browser-side fetch helper)
 *   - src/components/alfabot/*                (PR 3 widget — frontend agent)
 *
 * IMPORTANT: these types describe the WIRE contract between the AlfaBot
 * widget and the Next.js routes. The OpenAI gpt-4o-mini call lives behind
 * the `alfabot-answer` Supabase Edge Function (ai-engineer PR); this file
 * does NOT mirror that internal contract.
 *
 * Owner: backend
 * Reviewers: frontend (widget consumes these), ai-engineer (Edge Function
 * envelope must match the streaming-frame `meta` shape below).
 */

// ─── Discriminators ──────────────────────────────────────────────────────────

export type AlfabotAudience = 'parent' | 'student' | 'teacher' | 'school';
export type AlfabotLang = 'en' | 'hi';

export type AlfabotModel = 'gpt-4o-mini';

// ─── Rate-limit envelope (mirrored in the SSE `meta` frame) ──────────────────

/**
 * Per-bucket rate-limit remaining + reset metadata. Shipped on every
 * successful chat response (both JSON and the final SSE `meta` frame) so the
 * widget can render "X messages left today" and degrade gracefully near
 * exhaustion.
 *
 * `remaining` is an absolute count (not percentage). `resetAt` is an ISO
 * timestamp; null when the limiter doesn't expose one (in-memory fallback).
 */
export interface AlfabotRateLimitBucket {
  remaining: number;
  /** Total quota for this bucket (e.g. 6 for burst, 30 for daily). */
  limit: number;
  /** ISO-8601 when the bucket refills. Null = unknown (in-memory fallback). */
  resetAt: string | null;
}

export interface AlfabotRateLimitState {
  /** 6-message-per-60s sliding burst limiter. */
  burst: AlfabotRateLimitBucket;
  /** 30-message-per-24h fixed-window per-anon limiter. */
  daily: AlfabotRateLimitBucket;
  /**
   * 60-message-per-24h fixed-window per-IP-hash limiter. Optional on the
   * wire — only present in the response if the request carried an IP.
   */
  ipDaily?: AlfabotRateLimitBucket;
}

// ─── Chat request ────────────────────────────────────────────────────────────

export interface AlfabotRequest {
  /** Visitor message. ≤1000 chars, trimmed, non-empty. */
  message: string;
  audience: AlfabotAudience;
  lang: AlfabotLang;
  /**
   * Existing session id (UUID). When omitted, the route mints a new
   * `alfabot_sessions` row keyed by the anon_id cookie + audience + lang.
   */
  sessionId?: string;
}

// ─── Chat response ───────────────────────────────────────────────────────────

/**
 * Response metadata. Shipped on both the blocking JSON path and as the
 * final SSE `meta` frame on the streaming path.
 */
export interface AlfabotMeta {
  sessionId: string;
  /** Per-request trace id for ops triage. */
  traceId: string;
  rateLimitRemaining: AlfabotRateLimitState;
  /**
   * True when this turn ran in FAQ-only / KB-only mode because the daily
   * USD budget was at/over cap. The widget can show a subtle "answers
   * may be shorter today" hint.
   */
  degradedMode: boolean;
  model: AlfabotModel;
  /** Count of KB chunks the Edge Function pulled (0 when KB-empty / refusal). */
  sourcesUsed?: number;
}

/**
 * Successful chat response. `response` is the assistant text (always
 * populated for backward compat). `abstainReason` is set when the model
 * politely refused (off-scope, prompt-injection, denylist hit, upstream
 * down). On abstain `response` carries the canned refusal copy.
 */
export interface AlfabotResponse extends AlfabotMeta {
  response: string;
  abstainReason?:
    | 'prompt_injection'
    | 'url_in_message'
    | 'message_too_long'
    | 'denylisted'
    | 'upstream_failed'
    | 'budget_exhausted'
    | 'kb_no_match';
}

// ─── Lead capture ────────────────────────────────────────────────────────────

export interface AlfabotLeadRequest {
  /** Must reference a session that belongs to the same anon_id. */
  sessionId: string;
  /** RFC-5322-lite validated server-side. */
  email: string;
  /** Optional international phone (any format the visitor typed). */
  phone?: string;
  name?: string;
  role_or_designation?: string;
  /** REQUIRED when the session's audience is 'school'. */
  school_name?: string;
  /** Strict literal — false rejects the request. */
  consent: true;
  /** Verbatim DPDPA consent copy the visitor saw on screen. */
  consentText: string;
}

export interface AlfabotLeadResponse {
  ok: true;
  leadId: string;
}

// ─── Error envelope ──────────────────────────────────────────────────────────

export interface AlfabotErrorResponse {
  error:
    | 'invalid_input'
    | 'rate_limited'
    | 'denied'
    | 'session_max'
    | 'upstream_failed'
    | 'not_found';
  detail?: string;
  /** ISO timestamp when the bucket refills (only on rate_limited / session_max). */
  resetAt?: string;
  /** Which limiter blocked (only on rate_limited / session_max). */
  scope?: 'burst' | 'day' | 'ip' | 'session_max' | 'lead';
}
