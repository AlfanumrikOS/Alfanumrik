/**
 * /api/school-admin/ai-assistant — Principal AI Assistant v1
 *
 * A school-scoped, natural-language analytics assistant for school leadership
 * (principals). It answers ONLY from the principal's own school's aggregate
 * command-center signals (via the get_principal_ai_context RPC) and is gated to
 * the principal-only 'institution.use_principal_ai' capability.
 *
 * GET  → list the principal's recent sessions + the latest session's messages,
 *        scoped to the session-derived schoolId.
 * POST → { message, session_id? } → one chat turn:
 *          authorize → flag → daily cap → fetch context → build scope-locked
 *          prompt → callClaude (model provenance + circuit breaker) → persist
 *          with model/tokens/latency/abstain → return graceful envelope.
 *
 * SAFETY (P12): the prompt enforces data-only answers, single-school scope-lock,
 * an honest pacing decline, and an executive tone (see
 * src/lib/ai/principal-ai/prompt.ts). All upstream failures collapse to a clean
 * "temporarily unavailable" abstain — never a 500.
 *
 * PRIVACY (P13): logs carry trace ids / counts only — never message content,
 * the principal's identity at error level, or PII.
 *
 * ACCEPTED STAFF-NAME EGRESS (P13 scope decision — CEO-approved 2026-06-12):
 * The school-data context built for this assistant (via get_principal_ai_context)
 * intentionally INCLUDES school STAFF (teacher) names in the Teacher Engagement
 * aggregate, and that context is BOTH sent to the LLM provider AND persisted in
 * principal_ai_messages. This is an accepted egress: teacher/staff names are NOT
 * minor/student PII; a principal already has full visibility into their own staff;
 * and the data stays school-scoped via verified tenant isolation (school_id from
 * authorizeSchoolAdmin + the RPC's auth.uid() scope guard). STUDENT PII remains
 * FORBIDDEN here — the context exposes group-level aggregates only, never student
 * names/emails/phones/IDs (reaffirmed by the prompt scope-lock in
 * src/lib/ai/principal-ai/prompt.ts). This note is documentation only; no
 * behavior, prompt text, or context-builder logic changes from it.
 *
 * SCHOOL ID is ALWAYS the authorizeSchoolAdmin-resolved value — never read from
 * the client body / query.
 *
 * GRACEFUL DEGRADATION: the backing migration (20260616010000) is DRAFTED but
 * may be UNAPPLIED in this environment. Every table read/write and the context
 * RPC are wrapped so a "relation/function does not exist" error degrades to a
 * clean abstain (POST) or an empty list (GET) rather than a 500.
 *
 * Owner: ai-engineer. Reviewers: assessment (scope/age-appropriateness of the
 * rails), architect (auth boundary), testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/rbac';
import { isFeatureEnabled, PRINCIPAL_AI_FLAGS } from '@/lib/feature-flags';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { callClaude, isCircuitBreakerOpen } from '@/lib/ai/clients/claude';
import {
  buildContextSection,
  buildPrincipalAiSystemPrompt,
} from '@/lib/ai/principal-ai/prompt';
import type {
  PrincipalAiContext,
  PrincipalAiHistoryMessage,
  PrincipalAiSessionSummary,
  PrincipalAiTurn,
} from '@/lib/ai/principal-ai/types';
import { randomUUID } from 'node:crypto';

// ─── Constants ──────────────────────────────────────────────────────────────

const PERMISSION = 'institution.use_principal_ai';
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_TURNS = 8; // 4 prior exchanges passed to the model
const DAILY_CAP_PER_ADMIN = 50; // sensible v1 cap (server-side, P12)
const MAX_TOKENS = 900;
const TEMPERATURE = 0.2; // factual analytics — keep low (P12: never > 0.7 for factual)
const TIMEOUT_MS = 30_000;
const VALID_LANGS = ['en', 'hi'] as const;
type Lang = (typeof VALID_LANGS)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────

function newTraceId(): string {
  return randomUUID();
}

/**
 * Build a USER-CONTEXT Supabase client that carries the caller's session/JWT so
 * `auth.uid()` resolves inside SECURITY DEFINER school RPCs. This MUST be used
 * for `get_principal_ai_context` — that RPC's internal scope guard checks
 * `school_admins.auth_user_id = auth.uid()`, and the service-role client has NO
 * `auth.uid()`, so the guard would raise 42501 for every request (the route
 * would then ALWAYS abstain). Mirrors `resolveCommandCenterContext`'s
 * `buildUserContextClient` (src/lib/school-admin/command-center-context.ts):
 * cookies for web SWR, `Authorization: Bearer` passthrough for mobile.
 *
 * Throws if the public Supabase env is missing; the caller treats that as a
 * graceful context failure (abstain), never a 500.
 */
function buildUserContextClient(request: NextRequest): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const global =
    authHeader?.startsWith('Bearer ')
      ? { global: { headers: { Authorization: authHeader } } }
      : {};

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll() {
        // Read-only context fetch never mutates the session cookie.
      },
    },
    ...global,
  }) as unknown as SupabaseClient;
}

/** True when a Postgres/PostgREST error indicates the table/function isn't there. */
function isMissingObjectError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  // 42P01 = undefined_table, 42883 = undefined_function, PGRST202 = RPC not found.
  if (err.code === '42P01' || err.code === '42883' || err.code === 'PGRST202') return true;
  const m = (err.message || '').toLowerCase();
  return (
    m.includes('does not exist') ||
    m.includes('could not find the function') ||
    m.includes('schema cache')
  );
}

// ─── GET: recent sessions + latest session messages ─────────────────────────

export async function GET(request: NextRequest): Promise<Response> {
  // Flag OFF → clean 503 "feature not enabled" BEFORE auth. The principal-AI
  // permission code (`institution.use_principal_ai`) ships in a drafted-but-
  // unapplied migration, so it exists in no role; reaching authorizeSchoolAdmin
  // while the feature is off would surface a confusing nonexistent-permission
  // 403. Gating on the flag first keeps the route safe and unavailable until
  // Phase 3 enables it — only attempting the permission check when ON.
  if (!(await isFeatureEnabled(PRINCIPAL_AI_FLAGS.V1))) {
    return NextResponse.json(
      { success: false, error: 'feature_not_enabled' },
      { status: 503 },
    );
  }

  const auth = await authorizeSchoolAdmin(request, PERMISSION);
  if (!auth.authorized) return auth.errorResponse!;
  const schoolId = auth.schoolId!; // session-derived, never from client

  // Service-role reads, ALWAYS scoped to the session-derived schoolId.
  let sessions: PrincipalAiSessionSummary[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('principal_ai_sessions')
      .select('id, lang, message_count, last_message_at, created_at')
      .eq('school_id', schoolId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(20);
    if (error) {
      if (isMissingObjectError(error)) {
        // Migration unapplied — degrade to empty list, not a 500.
        return NextResponse.json({ success: true, sessions: [], messages: [], degraded: true });
      }
      logger.warn('principal_ai.get_sessions_failed', { traceId: newTraceId() });
    } else {
      sessions = (data ?? []) as PrincipalAiSessionSummary[];
    }
  } catch {
    return NextResponse.json({ success: true, sessions: [], messages: [], degraded: true });
  }

  // Latest session's messages (scoped via the session id we just confirmed
  // belongs to this school).
  let messages: PrincipalAiHistoryMessage[] = [];
  const latestSessionId = sessions[0]?.id ?? null;
  if (latestSessionId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('principal_ai_messages')
        .select('id, role, content, model, abstain_reason, created_at')
        .eq('session_id', latestSessionId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error && !isMissingObjectError(error)) {
        logger.warn('principal_ai.get_messages_failed', { traceId: newTraceId() });
      } else {
        messages = (data ?? []) as PrincipalAiHistoryMessage[];
      }
    } catch {
      /* non-fatal — return sessions without messages */
    }
  }

  return NextResponse.json({
    success: true,
    sessions,
    sessionId: latestSessionId,
    messages,
  });
}

// ─── POST: one chat turn ─────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  const traceId = newTraceId();

  // 1. Flag OFF → clean 503 "feature not enabled" BEFORE auth. The principal-AI
  //    permission code (`institution.use_principal_ai`) lives in a drafted-but-
  //    unapplied migration and is granted to no role, so reaching the permission
  //    check while the feature is off would surface a confusing nonexistent-
  //    permission 403. Gating on the flag first fails cleanly and keeps the
  //    route safe — the permission check is only attempted when the flag is ON
  //    (Phase 3 enablement).
  if (!(await isFeatureEnabled(PRINCIPAL_AI_FLAGS.V1))) {
    return NextResponse.json(
      { success: false, error: 'feature_not_enabled' },
      { status: 503 },
    );
  }

  // 2. Auth → session-derived schoolId + role. 403 if not permitted.
  const auth = await authorizeSchoolAdmin(request, PERMISSION);
  if (!auth.authorized) return auth.errorResponse!;
  const schoolId = auth.schoolId!; // NEVER from client
  const authUserId = auth.userId!;
  const role = auth.schoolAdminRole;

  // 3. Parse + validate body.
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_input', detail: 'body_must_be_json' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const providedSessionId = typeof body.session_id === 'string' ? body.session_id.trim() || null : null;
  const lang: Lang = typeof body.lang === 'string' && (VALID_LANGS as readonly string[]).includes(body.lang)
    ? (body.lang as Lang)
    : 'en';

  if (!message) {
    return NextResponse.json({ success: false, error: 'invalid_input', detail: 'message_required' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { success: false, error: 'invalid_input', detail: 'message_too_long' },
      { status: 400 },
    );
  }

  // 4. Daily cap per school-admin (server-side, P12). We count the principal's
  //    OWN user-role turns persisted today across this school.
  //
  //    FAIL-CLOSED (Finding #5): by the time control reaches here, the feature
  //    flag is ON (POST already 404'd otherwise) and the cap tables are created
  //    by THIS feature's migration — so they MUST exist. A genuine read ERROR on
  //    the cap counter at this point is therefore a real failure, not a
  //    pre-migration condition: we must NOT let the turn through unmetered (that
  //    would silently disable the P12 rate limit on any transient DB blip →
  //    unmetered LLM spend / abuse window). We return a safe deny (HTTP 503,
  //    honest that we could not verify quota) instead.
  //
  //    A normal empty/no-rows result ("0 used so far today") is NOT an error and
  //    still goes through — only a query error fails closed.
  const capState = await checkDailyCap(schoolId, authUserId);
  if (capState.errored) {
    logger.warn('principal_ai.cap_check_failed_closed', { traceId });
    return NextResponse.json(
      {
        success: false,
        error: 'temporarily_unavailable',
        message:
          'We could not verify your usage quota right now. Please try again in a moment.',
        quotaRemaining: null,
      },
      { status: 503 },
    );
  }
  if (capState.usedToday >= DAILY_CAP_PER_ADMIN) {
    return NextResponse.json(
      {
        success: false,
        error: 'daily_limit_reached',
        message:
          'You have reached today\'s Principal Assistant limit. Please try again tomorrow.',
        quotaRemaining: 0,
      },
      { status: 429 },
    );
  }

  // 5. Resolve / create the session (service-role; scoped to schoolId).
  let sessionId: string;
  try {
    sessionId = await resolveSession(schoolId, authUserId, role, lang, providedSessionId);
  } catch (err) {
    // Session table missing or insert failed → graceful abstain, never 500.
    logger.warn('principal_ai.session_resolve_failed', { traceId });
    return abstainResponse({
      sessionId: providedSessionId,
      traceId,
      lang,
      reason: 'unavailable',
    });
  }

  // 6. Persist the user message FIRST so a later upstream failure doesn't lose
  //    the prompt — and so the daily cap counts attempts honestly. We capture
  //    its id so we can REFUND (delete) it if the model call fails.
  const userRowId = await persistUserMessage(sessionId, message);

  // 7. Fetch the grounding context (session-derived schoolId ONLY). The context
  //    RPC is SECURITY DEFINER with an internal auth.uid() scope guard, so it is
  //    called through a USER-CONTEXT client (built from this request) rather than
  //    the service-role client — otherwise the guard raises 42501 and we always
  //    abstain. The schoolId remains the session-derived authorize value.
  const context = await fetchContext(request, schoolId, traceId);
  const contextSection = buildContextSection(context);

  // If the RPC errored / the school has no data at all → graceful abstain
  // (and refund the user row so it doesn't burn the daily cap).
  if (context === null || contextSection === null) {
    await refundUserMessage(userRowId);
    await persistAssistantAbstain(sessionId, lang, 'no_data', traceId);
    return abstainResponse({
      sessionId,
      traceId,
      lang,
      reason: context === null ? 'unavailable' : 'no_data',
    });
  }

  // 8. Circuit breaker short-circuit (P12): if Claude is already tripped, don't
  //    even attempt — refund + abstain.
  if (isCircuitBreakerOpen()) {
    await refundUserMessage(userRowId);
    await persistAssistantAbstain(sessionId, lang, 'circuit_open', traceId);
    return abstainResponse({ sessionId, traceId, lang, reason: 'unavailable' });
  }

  // 9. Build the scope-locked system prompt + native history.
  const systemPrompt = buildPrincipalAiSystemPrompt({ contextSection, lang });
  const history = await loadHistory(sessionId, userRowId);
  const messages: PrincipalAiTurn[] = [...history, { role: 'user', content: message }];

  // 10. Call Claude via the unified client (model fallback + circuit breaker +
  //     model provenance). NEVER throw on upstream failure → graceful abstain.
  let answer = '';
  let model = '';
  let tokensUsed = 0;
  let latencyMs = 0;
  try {
    const res = await callClaude({
      systemPrompt,
      messages,
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: TIMEOUT_MS,
    });
    answer = (res.content || '').trim();
    model = res.model;
    tokensUsed = res.tokensUsed;
    latencyMs = res.latencyMs;
  } catch (err) {
    // Upstream Claude failure (all models exhausted / circuit open / timeout).
    logger.warn('principal_ai.upstream_failed', { traceId });
    await refundUserMessage(userRowId); // refund-on-failure
    await persistAssistantAbstain(sessionId, lang, 'upstream_error', traceId);
    void logAudit(authUserId, {
      action: 'principal_ai.upstream_failed',
      resourceType: 'principal_ai_sessions',
      resourceId: sessionId,
      details: { traceId }, // keys-only (P13)
      status: 'failure',
    });
    return abstainResponse({ sessionId, traceId, lang, reason: 'unavailable' });
  }

  // Defensive: an empty model answer is treated as an abstain, not a blank
  // bubble (no unfiltered/empty LLM output to the principal — P12).
  if (!answer) {
    await refundUserMessage(userRowId);
    await persistAssistantAbstain(sessionId, lang, 'empty_answer', traceId);
    return abstainResponse({ sessionId, traceId, lang, reason: 'no_data' });
  }

  // 11. Persist the assistant turn with FULL provenance (REG-67: model id;
  //     plus tokens, latency, abstain_reason=null) and bump the session.
  await persistAssistantMessage({
    sessionId,
    content: answer,
    model,
    tokensUsed,
    latencyMs,
  });
  await bumpSession(sessionId);

  // 12. Audit — keys/counts only, NEVER message content or PII (P13).
  void logAudit(authUserId, {
    action: 'principal_ai.respond',
    resourceType: 'principal_ai_sessions',
    resourceId: sessionId,
    details: { traceId, model, tokensUsed, latencyMs }, // no schoolId/name/content
  });

  const quotaRemaining = Math.max(0, DAILY_CAP_PER_ADMIN - (capState.usedToday + 1));

  return NextResponse.json({
    success: true,
    sessionId,
    traceId,
    response: answer,
    model, // provenance surfaced on the wire (REG-67)
    tokensUsed,
    latencyMs,
    abstainReason: null,
    quotaRemaining,
  });
}

// ─── Internal: context RPC ───────────────────────────────────────────────────

/**
 * Fetch get_principal_ai_context(schoolId). Returns null on ANY failure
 * (RPC missing / errored / null) so the caller abstains gracefully. The
 * schoolId is ALWAYS the session-derived value passed in by POST.
 *
 * CREDENTIAL MODEL: this RPC is SECURITY DEFINER and enforces school scope
 * INTERNALLY via `school_admins.auth_user_id = auth.uid()`. It MUST therefore be
 * called through a USER-CONTEXT client (carrying the caller's JWT) so auth.uid()
 * resolves and the guard passes — the service-role client has no auth.uid() and
 * would trip a 42501 every time. The session-derived schoolId is still the only
 * school id passed; the in-RPC guard then confirms the caller administers it, so
 * no cross-school path is introduced. Every failure mode (env missing, RPC
 * missing pre-migration, 42501 scope rejection, throw) degrades to null → a
 * clean abstain upstream, never a 500.
 */
async function fetchContext(
  request: NextRequest,
  schoolId: string,
  traceId: string,
): Promise<PrincipalAiContext | null> {
  let userClient: SupabaseClient;
  try {
    userClient = buildUserContextClient(request);
  } catch {
    // Missing public Supabase env → cannot ground; abstain cleanly.
    logger.warn('principal_ai.context_client_build_failed', { traceId });
    return null;
  }

  try {
    const { data, error } = await userClient.rpc('get_principal_ai_context', {
      p_school_id: schoolId,
    });
    if (error) {
      // Missing function (migration unapplied) OR scope-guard rejection (42501)
      // → abstain. Both collapse to null (no 500).
      logger.warn('principal_ai.context_rpc_failed', {
        traceId,
        missing: isMissingObjectError(error),
      });
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    return data as PrincipalAiContext;
  } catch {
    logger.warn('principal_ai.context_rpc_threw', { traceId });
    return null;
  }
}

// ─── Internal: daily cap ─────────────────────────────────────────────────────

/**
 * Count the principal's own user-role turns persisted TODAY across this
 * school's sessions.
 *
 * FAIL-CLOSED (Finding #5): this is only ever reached AFTER the feature flag is
 * ON (POST 404's otherwise) and the cap tables are created by THIS feature's
 * migration — so they MUST exist here. Any genuine query ERROR (transient DB
 * fault, or even a "relation does not exist" that should be impossible at this
 * point) returns `errored: true`, and the caller denies the turn (503) rather
 * than letting it through unmetered. A normal empty/no-rows result is NOT an
 * error: `{ errored: false, usedToday: 0 }` (legitimate first use → allowed).
 */
async function checkDailyCap(
  schoolId: string,
  authUserId: string,
): Promise<{ errored: boolean; usedToday: number }> {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    // Sessions this principal opened today-or-earlier for this school.
    const { data: sessionRows, error: sErr } = await supabaseAdmin
      .from('principal_ai_sessions')
      .select('id')
      .eq('school_id', schoolId)
      .eq('auth_user_id', authUserId);
    if (sErr) {
      // Genuine read error (incl. missing-object, which must not happen post-
      // migration) → fail closed. Do NOT silently disable the P12 cap.
      return { errored: true, usedToday: 0 };
    }
    const ids = (sessionRows ?? []).map((r) => r.id as string);
    // No sessions yet = legitimate first use today (NOT an error). Allow.
    if (ids.length === 0) return { errored: false, usedToday: 0 };

    const { count, error: cErr } = await supabaseAdmin
      .from('principal_ai_messages')
      .select('id', { count: 'exact', head: true })
      .in('session_id', ids)
      .eq('role', 'user')
      .gte('created_at', startOfDay.toISOString());
    if (cErr) {
      return { errored: true, usedToday: 0 };
    }
    // count == null with no error is a normal "0 used so far" → allow.
    return { errored: false, usedToday: count ?? 0 };
  } catch {
    // Unexpected throw while verifying quota → cannot confirm we're under cap.
    return { errored: true, usedToday: 0 };
  }
}

// ─── Internal: session + persistence ─────────────────────────────────────────

async function resolveSession(
  schoolId: string,
  authUserId: string,
  role: string | null,
  lang: Lang,
  providedSessionId: string | null,
): Promise<string> {
  if (providedSessionId) {
    const { data: existing, error } = await supabaseAdmin
      .from('principal_ai_sessions')
      .select('id, school_id')
      .eq('id', providedSessionId)
      .maybeSingle();
    if (error && isMissingObjectError(error)) {
      throw new Error('principal_ai_sessions missing');
    }
    // Only reuse if the session truly belongs to THIS school (tenant isolation).
    if (existing && existing.school_id === schoolId) {
      return existing.id as string;
    }
    // Foreign / unknown session id → silently mint a fresh one for this school.
  }

  const { data: created, error: insErr } = await supabaseAdmin
    .from('principal_ai_sessions')
    .insert({
      school_id: schoolId,
      auth_user_id: authUserId,
      school_admin_role: role,
      lang,
    })
    .select('id')
    .single();
  if (insErr || !created) {
    throw new Error(`principal_ai session create failed: ${insErr?.message ?? 'unknown'}`);
  }
  return created.id as string;
}

/** Persist the user turn. Returns the row id (for refund) or null if it failed. */
async function persistUserMessage(sessionId: string, content: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('principal_ai_messages')
      .insert({ session_id: sessionId, role: 'user', content })
      .select('id')
      .single();
    if (error || !data) return null;
    return data.id as string;
  } catch {
    return null;
  }
}

/** Delete a just-persisted user row so a failed turn doesn't burn the cap. */
async function refundUserMessage(rowId: string | null): Promise<void> {
  if (!rowId) return;
  try {
    await supabaseAdmin.from('principal_ai_messages').delete().eq('id', rowId);
  } catch {
    /* best-effort */
  }
}

async function persistAssistantMessage(params: {
  sessionId: string;
  content: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}): Promise<void> {
  try {
    await supabaseAdmin.from('principal_ai_messages').insert({
      session_id: params.sessionId,
      role: 'assistant',
      content: params.content,
      model: params.model, // REG-67 provenance
      tokens_used: params.tokensUsed,
      latency_ms: params.latencyMs,
      abstain_reason: null,
    });
  } catch (err) {
    logger.warn('principal_ai.persist_assistant_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Persist an assistant abstain turn (auditable, distinct from a normal answer). */
async function persistAssistantAbstain(
  sessionId: string | null,
  lang: Lang,
  reason: string,
  traceId: string,
): Promise<void> {
  if (!sessionId) return;
  try {
    await supabaseAdmin.from('principal_ai_messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: abstainCopy(lang),
      model: null,
      abstain_reason: reason,
      degraded_mode: true,
    });
    await bumpSession(sessionId);
  } catch {
    // Table may be missing (migration unapplied) — non-fatal; the abstain is
    // still returned to the client.
    void traceId;
  }
}

async function bumpSession(sessionId: string): Promise<void> {
  try {
    // message_count is maintained best-effort; an exact recount is unnecessary
    // for v1 and avoids a read-modify-write race. We just refresh last_message_at.
    await supabaseAdmin
      .from('principal_ai_sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', sessionId);
  } catch {
    /* best-effort */
  }
}

/** Load recent prior turns for multi-turn coherence, excluding the just-inserted user row. */
async function loadHistory(sessionId: string, excludeRowId: string | null): Promise<PrincipalAiTurn[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('principal_ai_messages')
      .select('id, role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_TURNS * 2 + 1);
    if (error || !data) return [];
    const turns = (data as Array<{ id: string; role: 'user' | 'assistant'; content: string }>)
      .filter((r) => r.id !== excludeRowId && typeof r.content === 'string' && r.content.length > 0)
      .reverse()
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((r) => ({ role: r.role, content: r.content }));
    return turns;
  } catch {
    return [];
  }
}

// ─── Internal: abstain envelope ──────────────────────────────────────────────

function abstainCopy(lang: Lang): string {
  return lang === 'hi'
    ? 'Principal Assistant abhi available nahi hai. Kripya thodi der baad dobara try karein.'
    : 'The Principal Assistant is temporarily unavailable. Please try again in a moment.';
}

function abstainResponse(params: {
  sessionId: string | null;
  traceId: string;
  lang: Lang;
  reason: 'unavailable' | 'no_data';
}): Response {
  // Always HTTP 200 with success:true + an abstainReason — never a 500. The
  // frontend renders the assistant bubble from `response` + `abstainReason`.
  const copy =
    params.reason === 'no_data'
      ? params.lang === 'hi'
        ? 'Abhi aapke school ke liye koi data available nahi hai. Jab students quizzes lenge aur teachers remediation assign karenge, tab main madad kar paaunga.'
        : "I don't have any data for your school yet. Once students take quizzes and teachers assign remediation, I'll be able to help with school analytics."
      : abstainCopy(params.lang);
  return NextResponse.json({
    success: true,
    sessionId: params.sessionId,
    traceId: params.traceId,
    response: copy,
    model: null,
    tokensUsed: 0,
    latencyMs: 0,
    abstainReason: params.reason === 'no_data' ? 'no_data' : 'unavailable',
    quotaRemaining: null,
  });
}
