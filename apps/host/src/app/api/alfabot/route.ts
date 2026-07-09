/**
 * /api/alfabot — Landing-page chat bot (anonymous visitors at /welcome).
 *
 * This is PR 2 of the AlfaBot feature: the identity / rate-limit /
 * persistence / audit layer. The OpenAI gpt-4o-mini call lives behind the
 * `alfabot-answer` Supabase Edge Function (ai-engineer PR); this route
 * never calls OpenAI directly.
 *
 * Why no `authorizeRequest`:
 *   AlfaBot is intentionally ANONYMOUS — it sits on /welcome before a
 *   visitor signs up. The anon_id cookie (alf_anon_id) is the only stable
 *   identifier, and it is NOT a security identifier (see src/lib/anon-id.ts).
 *   All RBAC is replaced by:
 *     - the ff_alfabot_v1 feature flag (404 when off — don't confirm the
 *       endpoint exists),
 *     - 3 layered Upstash rate limiters (burst / day / ip-day),
 *     - a per-session message cap (30 messages/session),
 *     - the alfabot_denylist table for ops-banned anon_ids,
 *     - regex-based prompt-injection / URL / base64 filters (pre-LLM),
 *     - a daily USD budget cap (Upstash INCRBY) that degrades to FAQ-only mode.
 *
 * Audit policy (P13):
 *   - audit_logs.details MAY include: anon_id, session_id, audience, lang,
 *     tokensUsed, latencyMs, degradedMode, sourcesCount, model, abuseReason.
 *   - audit_logs.details MUST NEVER include: message text, assistant text,
 *     email, phone, name, IP, school_name. (The lead route follows the same
 *     contract.)
 *
 * Owner: backend
 * Reviewers: architect (anon auth boundary), ai-engineer (Edge Function
 * contract), testing (10 scenarios in __tests__/api/alfabot/route.test.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logAudit } from '@alfanumrik/lib/rbac';
import { ANON_ID_COOKIE, ANON_ID_MAX_AGE_SECONDS, generateAnonId } from '@alfanumrik/lib/anon-id';
import { ALFABOT_SSE_EVENTS } from '@alfanumrik/lib/alfabot/sse-events';
import { buildInternalCallerHeaders } from '@alfanumrik/lib/security/internal-caller-signing';
import type {
  AlfabotAudience,
  AlfabotErrorResponse,
  AlfabotLang,
  AlfabotRateLimitBucket,
  AlfabotRateLimitState,
  AlfabotRequest,
  AlfabotResponse,
} from '@alfanumrik/lib/alfabot/types';
import {
  addBudgetSpentUsd,
  applyLimit,
  getBudgetSpentUsd,
  type LimitResult,
} from './limits';
import { getDenylistCache, setDenylistCache } from './denylist-cache';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 1000;
const MAX_MESSAGES_PER_SESSION = 30;
const HISTORY_LIMIT = 6;
const EDGE_FUNCTION_TIMEOUT_MS = 25_000;
const DEFAULT_DAILY_USD_CAP = 20;
const MODEL_ID = 'gpt-4o-mini' as const;
const VALID_AUDIENCES = ['parent', 'student', 'teacher', 'school'] as const;
const VALID_LANGS = ['en', 'hi'] as const;

// Pre-LLM abuse regexes. P12: prevent prompt injection from anonymous
// visitors hijacking the system prompt or exfiltrating canonical pricing
// copy via base64 / URL coaxing.
const PROMPT_INJECTION_PATTERNS =
  /(ignore (all |previous )?instructions|system\s*:|jailbreak|DAN\b|developer mode)/i;
const URL_PATTERN = /(https?:\/\/|www\.)/i;
const BASE64_RUN_PATTERN = /[A-Za-z0-9+/]{200,}/;

// Canned abstain copy — P7 bilingual. Keyed by reason + lang.
const ABSTAIN_COPY: Record<string, Record<AlfabotLang, string>> = {
  prompt_injection: {
    en: "I can only help with questions about Alfanumrik (plans, signup, parent/teacher/school FAQs). Could you rephrase your question?",
    hi: "मैं केवल Alfanumrik से जुड़े सवालों में मदद कर सकता हूँ (plans, signup, parent/teacher/school FAQs)। क्या आप अपना सवाल फिर से पूछ सकते हैं?",
  },
  url_in_message: {
    en: "I can't open links. Please describe what you'd like to know about Alfanumrik in your own words.",
    hi: "मैं लिंक नहीं खोल सकता। कृपया अपने शब्दों में बताइए कि आप Alfanumrik के बारे में क्या जानना चाहते हैं।",
  },
  message_too_long: {
    en: "That message is too long. Please keep it under 1000 characters.",
    hi: "यह संदेश बहुत लंबा है। कृपया 1000 अक्षरों के अंदर रखें।",
  },
  upstream_failed: {
    en: "Something went wrong on my end. Please try again in a moment.",
    hi: "मेरी ओर से कुछ गड़बड़ हुई है। कृपया एक पल में फिर कोशिश करें।",
  },
  budget_exhausted: {
    en: "I'm a little busy today — I'll keep my answer short. For full details, please visit the pricing or contact page.",
    hi: "आज मैं थोड़ा व्यस्त हूँ — जवाब छोटा रखूँगा। पूरी जानकारी के लिए कृपया pricing या contact पेज देखें।",
  },
};

function toBucket(result: LimitResult): AlfabotRateLimitBucket {
  return {
    remaining: result.remaining,
    limit: result.limit,
    resetAt: result.resetMs ? new Date(result.resetMs).toISOString() : null,
  };
}
function dailyUsdCap(): number {
  const raw = process.env.ALFABOT_DAILY_USD_CAP;
  if (!raw) return DEFAULT_DAILY_USD_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_USD_CAP;
}

// ─── IP hashing (P13) ────────────────────────────────────────────────────────

function hashIp(rawIp: string): string {
  const salt = process.env.ALFABOT_IP_SALT || '';
  if (!salt && process.env.NODE_ENV === 'production') {
    logger.error('alfabot.ip_salt_missing_in_prod', {
      detail: 'ALFABOT_IP_SALT must be set in production',
    });
  }
  return createHash('sha256').update(rawIp + salt).digest('hex');
}

function getRawIp(request: NextRequest): string {
  return (
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

const DENYLIST_TTL_MS = 60_000;

async function isDenylisted(anonId: string): Promise<boolean> {
  const cached = getDenylistCache('chat', anonId);
  if (cached) return cached.denied;
  try {
    const { data, error } = await supabaseAdmin
      .from('alfabot_denylist')
      .select('anon_id')
      .eq('anon_id', anonId)
      .maybeSingle();
    if (error) {
      logger.warn('alfabot.denylist_lookup_failed', { error: error.message });
      // Fail-open: a DB hiccup must not lock anon visitors out.
      return false;
    }
    const denied = Boolean(data);
    setDenylistCache('chat', anonId, denied, DENYLIST_TTL_MS);
    return denied;
  } catch (err) {
    logger.warn('alfabot.denylist_lookup_threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function traceId(): string {
  // Re-use crypto.randomUUID — same source as anon-id.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function errorJson(
  payload: AlfabotErrorResponse,
  status: number,
  setCookieValue?: string,
): NextResponse {
  const res = NextResponse.json(payload, { status });
  if (setCookieValue) {
    res.cookies.set({
      name: ANON_ID_COOKIE,
      value: setCookieValue,
      maxAge: ANON_ID_MAX_AGE_SECONDS,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false,
    });
  }
  return res;
}

interface ValidatedBody {
  message: string;
  audience: AlfabotAudience;
  lang: AlfabotLang;
  sessionId: string | null;
}

function validateBody(body: unknown): ValidatedBody | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body_must_be_object' };
  const b = body as Record<string, unknown>;

  if (typeof b.message !== 'string') return { error: 'message_must_be_string' };
  const message = b.message.trim();
  if (message.length === 0) return { error: 'message_empty' };
  if (message.length > MAX_MESSAGE_LENGTH) return { error: 'message_too_long' };

  if (typeof b.audience !== 'string' || !VALID_AUDIENCES.includes(b.audience as AlfabotAudience)) {
    return { error: 'audience_invalid' };
  }
  if (typeof b.lang !== 'string' || !VALID_LANGS.includes(b.lang as AlfabotLang)) {
    return { error: 'lang_invalid' };
  }

  let sessionId: string | null = null;
  if (b.sessionId !== undefined && b.sessionId !== null) {
    if (typeof b.sessionId !== 'string') return { error: 'sessionId_must_be_string' };
    // UUID v4-ish — keep loose to allow future schema evolution.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.sessionId)) {
      return { error: 'sessionId_not_uuid' };
    }
    sessionId = b.sessionId;
  }

  return {
    message,
    audience: b.audience as AlfabotAudience,
    lang: b.lang as AlfabotLang,
    sessionId,
  };
}
interface AbuseCheckResult {
  blocked: boolean;
  reason?: 'prompt_injection' | 'url_in_message' | 'message_too_long';
}

function checkAbuse(message: string): AbuseCheckResult {
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { blocked: true, reason: 'message_too_long' };
  }
  if (PROMPT_INJECTION_PATTERNS.test(message)) {
    return { blocked: true, reason: 'prompt_injection' };
  }
  if (URL_PATTERN.test(message)) {
    return { blocked: true, reason: 'url_in_message' };
  }
  if (BASE64_RUN_PATTERN.test(message)) {
    return { blocked: true, reason: 'prompt_injection' };
  }
  return { blocked: false };
}

function abstainResponse(
  reason: 'prompt_injection' | 'url_in_message' | 'message_too_long' | 'upstream_failed' | 'budget_exhausted',
  lang: AlfabotLang,
  sessionId: string,
  rateLimitRemaining: AlfabotRateLimitState,
  degradedMode: boolean,
): AlfabotResponse {
  const copyMap = ABSTAIN_COPY[reason] || ABSTAIN_COPY.upstream_failed;
  return {
    sessionId,
    traceId: traceId(),
    rateLimitRemaining,
    degradedMode,
    model: MODEL_ID,
    response: copyMap[lang],
    abstainReason: reason,
  };
}

// ─── Session resolution ─────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  anon_id: string;
  audience: AlfabotAudience;
  lang: AlfabotLang;
  message_count: number;
}

/**
 * Load or create a session row. Returns:
 *   - { ok: true, session }                 — happy path
 *   - { ok: false, reason: 'session_max' }  — message_count >= 30
 *   - { ok: false, reason: 'foreign' }      — sessionId belongs to a different anon_id
 *
 * When `providedSessionId` is null OR doesn't belong to `anonId`, a brand-new
 * row is inserted.
 */
async function resolveSession(
  anonId: string,
  audience: AlfabotAudience,
  lang: AlfabotLang,
  providedSessionId: string | null,
  ipHash: string | null,
  userAgentHash: string | null,
): Promise<
  | { ok: true; session: SessionRow }
  | { ok: false; reason: 'session_max' | 'foreign' }
> {
  if (providedSessionId) {
    const { data: existing } = await supabaseAdmin
      .from('alfabot_sessions')
      .select('id, anon_id, audience, lang, message_count')
      .eq('id', providedSessionId)
      .maybeSingle();
    if (existing) {
      if (existing.anon_id !== anonId) {
        // Cross-anon session injection attempt — silently mint a new session
        // for this anon instead of leaking that the sessionId is real.
        // (We DO log it, just don't return foreign — that's a security signal.)
        logger.warn('alfabot.session_cross_anon_attempt', {
          providedSessionId,
          // No PII; anonId is a UUID bucket key only.
        });
        // fall through to insert below
      } else {
        if ((existing.message_count ?? 0) >= MAX_MESSAGES_PER_SESSION * 2) {
          // *2 because each turn writes 2 rows (user + assistant) into the
          // table-side message_count we maintain on alfabot_sessions.
          return { ok: false, reason: 'session_max' };
        }
        return {
          ok: true,
          session: {
            id: existing.id,
            anon_id: existing.anon_id,
            audience: existing.audience,
            lang: existing.lang,
            message_count: existing.message_count ?? 0,
          },
        };
      }
    }
  }

  const { data: created, error } = await supabaseAdmin
    .from('alfabot_sessions')
    .insert({
      anon_id: anonId,
      audience,
      lang,
      ip_hash: ipHash,
      user_agent_hash: userAgentHash,
    })
    .select('id, anon_id, audience, lang, message_count')
    .single();
  if (error || !created) {
    throw new Error(`alfabot.session_create_failed: ${error?.message || 'unknown'}`);
  }
  return {
    ok: true,
    session: {
      id: created.id,
      anon_id: created.anon_id,
      audience: created.audience,
      lang: created.lang,
      message_count: created.message_count ?? 0,
    },
  };
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function loadHistory(sessionId: string): Promise<HistoryMessage[]> {
  const { data, error } = await supabaseAdmin
    .from('alfabot_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error || !data) return [];
  // Reverse to chronological order.
  return (data as HistoryMessage[]).reverse();
}

// ─── Edge Function call ─────────────────────────────────────────────────────

interface EdgeFunctionRequest {
  message: string;
  audience: AlfabotAudience;
  lang: AlfabotLang;
  sessionId: string;
  history: HistoryMessage[];
  anonId: string;
  degradedMode: boolean;
}

interface EdgeFunctionJsonResponse {
  response: string;
  sources?: unknown[];
  tokensUsed?: number;
  latencyMs?: number;
  estimatedCostUsd?: number;
  abstainReason?: string;
  model?: string;
}

/**
 * Call the alfabot-answer Edge Function. Two transport modes:
 *   - JSON: blocking, returns the parsed response (or null on failure).
 *   - SSE:  streaming, returns the raw Response.
 *
 * Timeout: 25s. On any failure (network, 5xx, parse error), returns null
 * and lets the caller fall back to a canned abstain.
 */
async function callEdgeFunction(
  req: EdgeFunctionRequest,
  accept: 'application/json' | 'text/event-stream',
): Promise<{ ok: true; jsonBody?: EdgeFunctionJsonResponse; rawResponse?: Response } | { ok: false; reason: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, reason: 'config_missing' };
  }
  const bodyStr = JSON.stringify(req);
  const signingHeaders = buildInternalCallerHeaders('POST', '/functions/v1/alfabot-answer', bodyStr, 'alfabot-answer');
  if (!signingHeaders) {
    logger.warn('alfabot.internal_signing_not_configured', {
      detail: 'INTERNAL_CALLER_SIGNING_SECRET is not set — alfabot-answer will reject unsigned calls',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EDGE_FUNCTION_TIMEOUT_MS);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/alfabot-answer`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Accept: accept,
        ...(req.degradedMode ? { 'x-alfabot-degraded': '1' } : {}),
        ...(signingHeaders ?? {}),
      },
      body: bodyStr,
    });
    clearTimeout(timer);
    if (!res.ok) {
      try { await res.text(); } catch { /* drain */ }
      return { ok: false, reason: `http_${res.status}` };
    }
    if (accept === 'text/event-stream') {
      return { ok: true, rawResponse: res };
    }
    const body = (await res.json()) as EdgeFunctionJsonResponse;
    return { ok: true, jsonBody: body };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: isAbort ? 'timeout' : 'network_error' };
  }
}

// ─── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  // 1. Resolve anon_id (read cookie, mint if missing) — needed for the
  //    feature-flag check so per-anon rollout actually splits traffic.
  const cookieStore = await cookies();
  let anonId = cookieStore.get(ANON_ID_COOKIE)?.value || null;
  const anonMinted = !anonId;
  if (!anonId) anonId = generateAnonId();
  const setCookieValue = anonMinted ? anonId : undefined;

  // 2. Feature-flag check — 404 (NOT 403) when off, so we don't confirm
  //    the endpoint exists.
  const enabled = await isFeatureEnabled('ff_alfabot_v1', { userId: anonId });
  if (!enabled) {
    return errorJson({ error: 'not_found' }, 404, setCookieValue);
  }

  // 3. Parse body.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorJson({ error: 'invalid_input', detail: 'body_must_be_json' }, 400, setCookieValue);
  }
  const validated = validateBody(rawBody);
  if ('error' in validated) {
    return errorJson({ error: 'invalid_input', detail: validated.error }, 400, setCookieValue);
  }
  const { message, audience, lang, sessionId: providedSessionId } = validated;

  // 4. Denylist check (60s cache).
  if (await isDenylisted(anonId)) {
    return errorJson({ error: 'denied' }, 403, setCookieValue);
  }

  // 5. Pre-LLM abuse filters — log + polite abstain response if matched.
  //    Note: we still RUN the rate limit check below so abuse traffic is
  //    capped, but we DO NOT call the Edge Function.
  const abuse = checkAbuse(message);

  // 6. Rate limiting (3 layered limiters).
  const rawIp = getRawIp(request);
  const ipHash = rawIp === 'unknown' ? null : hashIp(rawIp);
  const burst = await applyLimit('burst', anonId);
  const daily = await applyLimit('day', anonId);
  const ipLimit = ipHash ? await applyLimit('ip', ipHash) : null;

  const rateLimitRemaining: AlfabotRateLimitState = {
    burst: toBucket(burst),
    daily: toBucket(daily),
    ...(ipLimit ? { ipDaily: toBucket(ipLimit) } : {}),
  };

  if (!burst.allowed || !daily.allowed || (ipLimit && !ipLimit.allowed)) {
    const which = !burst.allowed
      ? { scope: 'burst' as const, resetMs: burst.resetMs }
      : !daily.allowed
        ? { scope: 'day' as const, resetMs: daily.resetMs }
        : { scope: 'ip' as const, resetMs: ipLimit!.resetMs };
    // Mark the session row (if any) so ops can see which anon_ids hit limits.
    if (providedSessionId) {
      try {
        await supabaseAdmin
          .from('alfabot_sessions')
          .update({ rate_limit_hit: true })
          .eq('id', providedSessionId)
          .eq('anon_id', anonId);
      } catch {
        /* non-critical */
      }
    }
    return errorJson(
      {
        error: 'rate_limited',
        scope: which.scope,
        resetAt: which.resetMs ? new Date(which.resetMs).toISOString() : undefined,
      },
      429,
      setCookieValue,
    );
  }

  // 7. Resolve / create session.
  let sessionRow: SessionRow;
  const userAgentHash = (() => {
    const ua = request.headers.get('user-agent');
    if (!ua) return null;
    return createHash('sha256').update(ua).digest('hex').slice(0, 32);
  })();
  try {
    const resolved = await resolveSession(
      anonId,
      audience,
      lang,
      providedSessionId,
      ipHash,
      userAgentHash,
    );
    if (!resolved.ok) {
      if (resolved.reason === 'session_max') {
        return errorJson(
          { error: 'session_max', scope: 'session_max' },
          429,
          setCookieValue,
        );
      }
      return errorJson({ error: 'invalid_input', detail: 'session_foreign' }, 400, setCookieValue);
    }
    sessionRow = resolved.session;
  } catch (err) {
    logger.error('alfabot.session_resolution_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorJson({ error: 'upstream_failed' }, 500, setCookieValue);
  }
  const sessionId = sessionRow.id;

  // 8. Abuse pre-LLM short-circuit. AFTER session is resolved so we still
  //    have a valid sessionId in the response envelope. We persist nothing
  //    for the abuse case (no INSERT into alfabot_messages), but we DO log
  //    to audit_logs and return a canned abstain copy.
  if (abuse.blocked) {
    const requestTraceId = traceId();
    try {
      await logAudit(null, {
        action: 'alfabot.abuse_blocked',
        resourceType: 'alfabot_session',
        resourceId: sessionId,
        details: {
          anonId,
          audience,
          lang,
          reason: abuse.reason,
          traceId: requestTraceId,
          // NO message content (P13).
        },
      });
    } catch {
      /* non-critical */
    }
    const reasonForCopy: 'prompt_injection' | 'url_in_message' | 'message_too_long' =
      abuse.reason ?? 'prompt_injection';
    const payload = abstainResponse(
      reasonForCopy,
      lang,
      sessionId,
      rateLimitRemaining,
      false,
    );
    payload.traceId = requestTraceId;
    const res = NextResponse.json(payload, { status: 200 });
    if (setCookieValue) {
      res.cookies.set({
        name: ANON_ID_COOKIE,
        value: setCookieValue,
        maxAge: ANON_ID_MAX_AGE_SECONDS,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        httpOnly: false,
      });
    }
    return res;
  }

  // 9. Budget check — degrade to FAQ-only mode if today's spend ≥ cap.
  const spent = await getBudgetSpentUsd();
  const cap = dailyUsdCap();
  const degradedMode = spent >= cap;

  // 10. Load short history for the Edge Function prompt.
  const history = await loadHistory(sessionId);

  // 11. Persist the user message FIRST so we never lose the prompt if the
  //     Edge Function fails or times out.
  try {
    await supabaseAdmin.from('alfabot_messages').insert({
      session_id: sessionId,
      role: 'user',
      content: message,
      degraded_mode: degradedMode,
      // No model on user rows.
    });
  } catch (err) {
    logger.warn('alfabot.persist_user_message_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Continue — we'd rather answer than fail the turn.
  }

  // 12. Streaming or JSON? Determined by client's Accept header.
  const acceptsSse = (request.headers.get('accept') || '').includes('text/event-stream');
  const streamingEnabled = await isFeatureEnabled('ff_alfabot_streaming', { userId: anonId });
  const useStreaming = acceptsSse && streamingEnabled;

  const edgeReq: EdgeFunctionRequest = {
    message,
    audience,
    lang,
    sessionId,
    history,
    anonId,
    degradedMode,
  };

  if (useStreaming) {
    return handleStreamingTurn({
      anonId,
      sessionId,
      audience,
      lang,
      message,
      degradedMode,
      rateLimitRemaining,
      edgeReq,
      setCookieValue,
    });
  }

  // 13. Blocking (JSON) path.
  const upstream = await callEdgeFunction(edgeReq, 'application/json');
  if (!upstream.ok) {
    logger.error('alfabot.upstream_failed', { reason: upstream.reason });
    try {
      await logAudit(null, {
        action: 'alfabot.upstream_failed',
        resourceType: 'alfabot_session',
        resourceId: sessionId,
        details: {
          anonId,
          audience,
          lang,
          reason: upstream.reason,
          model: MODEL_ID,
        },
        status: 'failure',
      });
    } catch {
      /* non-critical */
    }
    const payload = abstainResponse(
      'upstream_failed',
      lang,
      sessionId,
      rateLimitRemaining,
      true,
    );
    const res = NextResponse.json(payload, { status: 200 });
    if (setCookieValue) {
      res.cookies.set({
        name: ANON_ID_COOKIE,
        value: setCookieValue,
        maxAge: ANON_ID_MAX_AGE_SECONDS,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        httpOnly: false,
      });
    }
    return res;
  }

  const upstreamBody = upstream.jsonBody!;
  const requestTraceId = traceId();
  const tokensUsed = upstreamBody.tokensUsed ?? 0;
  const latencyMs = upstreamBody.latencyMs ?? 0;
  const sourcesCount = Array.isArray(upstreamBody.sources) ? upstreamBody.sources.length : 0;
  const upstreamModel = upstreamBody.model || MODEL_ID;

  // 14. Persist assistant message (NO message content in audit, but content
  //     IS persisted to alfabot_messages — that's the chat history, not the
  //     audit log).
  try {
    await supabaseAdmin.from('alfabot_messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: upstreamBody.response,
      sources: upstreamBody.sources ?? null,
      tokens_used: tokensUsed,
      latency_ms: latencyMs,
      degraded_mode: degradedMode,
      model: upstreamModel,
    });
  } catch (err) {
    logger.warn('alfabot.persist_assistant_message_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 15. Update session counter + last_message_at.
  try {
    await supabaseAdmin
      .from('alfabot_sessions')
      .update({
        last_message_at: new Date().toISOString(),
        message_count: (sessionRow.message_count ?? 0) + 2,
      })
      .eq('id', sessionId);
  } catch {
    /* non-critical */
  }

  // 16. Account for cost in the daily USD budget.
  if (typeof upstreamBody.estimatedCostUsd === 'number' && upstreamBody.estimatedCostUsd > 0) {
    await addBudgetSpentUsd(upstreamBody.estimatedCostUsd);
  }

  // 17. Audit log — anon_id + metadata only, NEVER message content (P13).
  try {
    await logAudit(null, {
      action: 'alfabot.respond',
      resourceType: 'alfabot_session',
      resourceId: sessionId,
      details: {
        anonId,
        audience,
        lang,
        tokensUsed,
        latencyMs,
        degradedMode,
        sourcesCount,
        model: upstreamModel,
        traceId: requestTraceId,
        abstainReason: upstreamBody.abstainReason ?? null,
      },
    });
  } catch {
    /* non-critical */
  }

  const payload: AlfabotResponse = {
    sessionId,
    traceId: requestTraceId,
    rateLimitRemaining,
    degradedMode,
    model: upstreamModel as AlfabotResponse['model'],
    response: upstreamBody.response,
    sourcesUsed: sourcesCount,
    ...(upstreamBody.abstainReason
      ? { abstainReason: upstreamBody.abstainReason as AlfabotResponse['abstainReason'] }
      : {}),
  };

  const res = NextResponse.json(payload, { status: 200 });
  if (setCookieValue) {
    res.cookies.set({
      name: ANON_ID_COOKIE,
      value: setCookieValue,
      maxAge: ANON_ID_MAX_AGE_SECONDS,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: false,
    });
  }
  return res;
}

// ─── Streaming branch ───────────────────────────────────────────────────────

interface StreamingTurnArgs {
  anonId: string;
  sessionId: string;
  audience: AlfabotAudience;
  lang: AlfabotLang;
  message: string;
  degradedMode: boolean;
  rateLimitRemaining: AlfabotRateLimitState;
  edgeReq: EdgeFunctionRequest;
  setCookieValue: string | undefined;
}

async function handleStreamingTurn(args: StreamingTurnArgs): Promise<Response> {
  const upstream = await callEdgeFunction(args.edgeReq, 'text/event-stream');
  const requestTraceId = traceId();

  if (!upstream.ok || !upstream.rawResponse?.body) {
    logger.error('alfabot.streaming_upstream_failed', { reason: upstream.ok ? 'no_body' : upstream.reason });
    try {
      await logAudit(null, {
        action: 'alfabot.upstream_failed',
        resourceType: 'alfabot_session',
        resourceId: args.sessionId,
        details: {
          anonId: args.anonId,
          audience: args.audience,
          lang: args.lang,
          reason: upstream.ok ? 'no_body' : upstream.reason,
          model: MODEL_ID,
        },
        status: 'failure',
      });
    } catch { /* non-critical */ }
    // Synthesize a single-event SSE stream so the client renders our
    // canned abstain copy.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        const payload = abstainResponse(
          'upstream_failed',
          args.lang,
          args.sessionId,
          args.rateLimitRemaining,
          true,
        );
        payload.traceId = requestTraceId;
        controller.enqueue(enc.encode(`event: ${ALFABOT_SSE_EVENTS.META}\ndata: ${JSON.stringify(payload)}\n\n`));
        controller.enqueue(enc.encode(`event: ${ALFABOT_SSE_EVENTS.DONE}\ndata: ${JSON.stringify(payload)}\n\n`));
        controller.close();
      },
    });
    const res = new Response(stream, {
      status: 200,
      headers: streamingHeaders(),
    });
    if (args.setCookieValue) {
      res.headers.append(
        'set-cookie',
        `${ANON_ID_COOKIE}=${args.setCookieValue}; Path=/; Max-Age=${ANON_ID_MAX_AGE_SECONDS}; SameSite=Lax${
          process.env.NODE_ENV === 'production' ? '; Secure' : ''
        }`,
      );
    }
    return res;
  }

  // Successful upstream — pipe its SSE stream through, parsing each frame so
  // we can append our own `meta` frame before `done`.
  let accumulatedText = '';
  let parseBuffer = '';
  let upstreamTokensUsed = 0;
  let upstreamLatencyMs = 0;
  let upstreamCostUsd = 0;
  let upstreamSources: unknown[] = [];
  let upstreamModel = MODEL_ID as string;
  let upstreamAbstainReason: string | null = null;
  let doneSeen = false;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // SWALLOW upstream done — re-emit only token/citation/other so our
      // own done frame in flush() is the last one the client sees (carries
      // sessionId/traceId/rateLimitRemaining required by mergeMeta).
      parseBuffer += decoder.decode(chunk, { stream: true });
      let sepIdx: number;
      while ((sepIdx = parseBuffer.indexOf('\n\n')) !== -1) {
        const raw = parseBuffer.slice(0, sepIdx);
        parseBuffer = parseBuffer.slice(sepIdx + 2);
        if (!raw || raw.startsWith(':')) continue;
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
        if (eventName === ALFABOT_SSE_EVENTS.TOKEN) {
          if (typeof payload.delta === 'string') accumulatedText += payload.delta;
          // Forward token frames so client renders progressively.
          controller.enqueue(encoder.encode(raw + '\n\n'));
        } else if (eventName === ALFABOT_SSE_EVENTS.DONE) {
          doneSeen = true;
          if (typeof payload.tokensUsed === 'number') upstreamTokensUsed = payload.tokensUsed;
          if (typeof payload.latencyMs === 'number') upstreamLatencyMs = payload.latencyMs;
          if (typeof payload.estimatedCostUsd === 'number') upstreamCostUsd = payload.estimatedCostUsd;
          if (Array.isArray(payload.sources)) upstreamSources = payload.sources;
          if (typeof payload.model === 'string') upstreamModel = payload.model;
          if (typeof payload.abstainReason === 'string') upstreamAbstainReason = payload.abstainReason;
          if (typeof payload.response === 'string' && !accumulatedText) {
            accumulatedText = payload.response;
          }
        } else {
          // Other events (citation, error, future): forward as-is.
          controller.enqueue(encoder.encode(raw + '\n\n'));
        }
      }
    },
    async flush(controller) {
      // Append our `meta` frame so the widget has rate-limit context. We
      // emit AFTER all upstream frames so it's the last meta payload the
      // client sees.
      const finalEnvelope: AlfabotResponse = {
        sessionId: args.sessionId,
        traceId: requestTraceId,
        rateLimitRemaining: args.rateLimitRemaining,
        degradedMode: args.degradedMode,
        model: upstreamModel as AlfabotResponse['model'],
        response: accumulatedText,
        sourcesUsed: upstreamSources.length,
        ...(upstreamAbstainReason
          ? { abstainReason: upstreamAbstainReason as AlfabotResponse['abstainReason'] }
          : {}),
      };
      try {
        controller.enqueue(
          encoder.encode(`event: ${ALFABOT_SSE_EVENTS.META}
data: ${JSON.stringify(finalEnvelope)}

`),
        );
        controller.enqueue(
          encoder.encode(`event: ${ALFABOT_SSE_EVENTS.DONE}
data: ${JSON.stringify(finalEnvelope)}

`),
        );
      } catch { /* controller closed */ }

      // Persist assistant + bump session counter (best-effort).
      try {
        await supabaseAdmin.from('alfabot_messages').insert({
          session_id: args.sessionId,
          role: 'assistant',
          content: accumulatedText,
          sources: upstreamSources.length > 0 ? upstreamSources : null,
          tokens_used: upstreamTokensUsed,
          latency_ms: upstreamLatencyMs,
          degraded_mode: args.degradedMode,
          model: upstreamModel,
        });
        await supabaseAdmin
          .from('alfabot_sessions')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', args.sessionId);
      } catch (err) {
        logger.warn('alfabot.stream_persist_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (upstreamCostUsd > 0) {
        try { await addBudgetSpentUsd(upstreamCostUsd); } catch { /* */ }
      }

      try {
        await logAudit(null, {
          action: 'alfabot.respond',
          resourceType: 'alfabot_session',
          resourceId: args.sessionId,
          details: {
            anonId: args.anonId,
            audience: args.audience,
            lang: args.lang,
            tokensUsed: upstreamTokensUsed,
            latencyMs: upstreamLatencyMs,
            degradedMode: args.degradedMode,
            sourcesCount: upstreamSources.length,
            model: upstreamModel,
            traceId: requestTraceId,
            abstainReason: upstreamAbstainReason,
            streaming: true,
            done: doneSeen,
          },
        });
      } catch { /* non-critical */ }
    },
  });

  const responseStream = upstream.rawResponse.body.pipeThrough(transform);
  const res = new Response(responseStream, {
    status: 200,
    headers: streamingHeaders(),
  });
  if (args.setCookieValue) {
    res.headers.append(
      'set-cookie',
      `${ANON_ID_COOKIE}=${args.setCookieValue}; Path=/; Max-Age=${ANON_ID_MAX_AGE_SECONDS}; SameSite=Lax${
        process.env.NODE_ENV === 'production' ? '; Secure' : ''
      }`,
    );
  }
  return res;
}

function streamingHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}
