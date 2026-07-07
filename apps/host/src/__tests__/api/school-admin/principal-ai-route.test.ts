import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * ROUTE-LEVEL security pins for the Principal AI Assistant POST handler
 *   src/app/api/school-admin/ai-assistant/route.ts
 *
 * The code landed in 569e3d37 and was audited as correct but UNTESTED at the
 * route layer. This file locks the verified security properties so a refactor
 * cannot silently break them.
 *
 * Pinned contracts (see per-test comments):
 *   1. TENANT ISOLATION — the get_principal_ai_context RPC is called with the
 *      authorizeSchoolAdmin-resolved schoolId, NEVER a body-supplied school_id.
 *   2. AUTH DENIAL — a denial short-circuits: no RPC, no Claude call.
 *   3. FLAG OFF → 503 { success:false, error:'feature_not_enabled' } before auth
 *      or any work (portal RBAC remediation Phase 0+1, 2026-06-16: the flag-OFF
 *      contract moved from 404 {error:'not_found'} to 503
 *      {success:false, error:'feature_not_enabled'} so an OFF feature reads as a
 *      temporarily-unavailable capability — not a missing route — and is
 *      distinguishable from a genuine not-found).
 *   4. FOREIGN session_id — a session whose school_id != caller's schoolId is
 *      NOT reused; a fresh school-scoped session is minted instead.
 *   5. DAILY CAP exceeded → 429, no LLM call.
 *   6. UPSTREAM failure / circuit-breaker open → graceful abstain (HTTP 200),
 *      never a 500.
 *   7. MODEL PROVENANCE (REG-67) — the persisted assistant row AND the response
 *      envelope both carry the model id from callClaude.
 *
 * Mocking style mirrors src/__tests__/api/super-admin/reconciliation-actions.test.ts
 * and src/__tests__/api/school-admin-billing-staff-rbac.test.ts — dynamic import
 * of the route + module-seam vi.mock. Deterministic, no network.
 *
 * SEAM NOTE: the route uses TWO Supabase clients.
 *   - supabaseAdmin (service role, @alfanumrik/lib/supabase-admin) for sessions/messages.
 *   - a USER-CONTEXT client built via createServerClient (@supabase/ssr) ONLY for
 *     the get_principal_ai_context RPC (so auth.uid() resolves inside the
 *     SECURITY DEFINER guard). We mock both to observe what school id flows where.
 */

// ─── Feature flag seam ─────────────────────────────────────────────────
const isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  PRINCIPAL_AI_FLAGS: { V1: 'ff_principal_ai_v1' },
}));

// ─── Auth seam ─────────────────────────────────────────────────────────
const authorizeSchoolAdmin = vi.fn();
vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => authorizeSchoolAdmin(...a),
}));

// ─── Claude client seam ────────────────────────────────────────────────
const callClaude = vi.fn();
const isCircuitBreakerOpen = vi.fn();
vi.mock('@alfanumrik/lib/ai/clients/claude', () => ({
  callClaude: (...a: unknown[]) => callClaude(...a),
  isCircuitBreakerOpen: (...a: unknown[]) => isCircuitBreakerOpen(...a),
}));

// ─── Prompt builder seam — keep deterministic, never null so the happy path
//     proceeds. buildContextSection(null|empty) returning null is the route's
//     "no data" abstain branch; we drive that explicitly by returning null when
//     the RPC yields null (handled by the route, not here). ─────────────────
vi.mock('@alfanumrik/lib/ai/principal-ai/prompt', () => ({
  buildContextSection: (ctx: unknown) => (ctx ? 'CONTEXT_SECTION' : null),
  buildPrincipalAiSystemPrompt: () => 'SYSTEM_PROMPT',
}));

// ─── Audit + logger (quiet, keys-only) ─────────────────────────────────
const logAudit = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/rbac', () => ({
  logAudit: (...a: unknown[]) => logAudit(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── USER-CONTEXT client seam (@supabase/ssr createServerClient) ────────
// Captures the get_principal_ai_context RPC name + args so we can prove the
// school id passed is server-derived, never the body's.
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
let contextRpcResult: { data: unknown; error: unknown } = { data: { has_data: true }, error: null };

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(contextRpcResult);
    },
  }),
}));

// ─── SERVICE-ROLE client seam (@alfanumrik/lib/supabase-admin) ────────────────────
// Records session SELECT/INSERT so we can assert tenant-scoping + that a
// foreign session id is not reused. Chainable; per-table canned results.

interface Canned { data: unknown; error: unknown; count?: number }

const sessionSelectResult = { value: { data: null, error: null } as Canned };
const insertedSessionRows: Array<Record<string, unknown>> = [];
const insertedMessageRows: Array<Record<string, unknown>> = [];
const capUserCount = { value: 0 };
// FAIL-CLOSED (Finding #5) cap-counter error injection.
//   capSessionsError → drives the principal_ai_sessions cap select to resolve
//     { data: null, error } (the FIRST query checkDailyCap reads).
//   capSessionsData → overrides the resolved session-id list (default: one
//     existing session, so checkDailyCap proceeds to the messages count). An
//     empty array models a legitimate first-use-today (no sessions yet).
const capSessionsError = { value: null as Canned['error'] };
const capSessionsData = { value: [{ id: 'existing-sess' }] as unknown };

function makeMessagesChain(): Record<string, unknown> {
  // For checkDailyCap head-count and for loadHistory selects.
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = vi.fn((_cols?: unknown, opts?: { count?: string; head?: boolean }) => {
    // head:true count select resolves to the cap count via .then below.
    void opts;
    return chain;
  });
  chain.eq = vi.fn(ret);
  chain.in = vi.fn(ret);
  chain.gte = vi.fn(ret);
  chain.order = vi.fn(ret);
  chain.limit = vi.fn(ret);
  chain.delete = vi.fn(ret);
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    insertedMessageRows.push(payload);
    // insert(...).select('id').single() → return a fresh row id
    return {
      select: () => ({
        single: () =>
          Promise.resolve({ data: { id: `msg-${insertedMessageRows.length}` }, error: null }),
      }),
    };
  });
  // Terminal awaits (cap count head select, loadHistory select).
  (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: capUserCount.value }).then(resolve);
  return chain;
}

function makeSessionsChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = vi.fn(ret);
  chain.eq = vi.fn(ret);
  chain.order = vi.fn(ret);
  chain.limit = vi.fn(ret);
  chain.update = vi.fn(ret);
  chain.maybeSingle = vi.fn(() => Promise.resolve(sessionSelectResult.value));
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    insertedSessionRows.push(payload);
    return {
      select: () => ({
        single: () =>
          Promise.resolve({ data: { id: `sess-${insertedSessionRows.length}` }, error: null }),
      }),
    };
  });
  // For checkDailyCap's `.select('id').eq('school_id',..).eq('auth_user_id',..)`
  // (no maybeSingle) → resolves to a list of session ids, OR a genuine read
  // error (capSessionsError) so the fail-closed branch can be exercised.
  (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
    Promise.resolve(
      capSessionsError.value
        ? { data: null, error: capSessionsError.value }
        : { data: capSessionsData.value, error: null },
    ).then(resolve);
  return chain;
}

const supabaseAdmin = {
  from: vi.fn((table: string) => {
    if (table === 'principal_ai_sessions') return makeSessionsChain();
    return makeMessagesChain(); // principal_ai_messages
  }),
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin,
  getSupabaseAdmin: () => supabaseAdmin,
}));

// ─── Fixtures ──────────────────────────────────────────────────────────
const CALLER_SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTACKER_SCHOOL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_UID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  schoolId: CALLER_SCHOOL,
  schoolAdminRole: 'principal',
};

const AUTH_DENIED = () => ({
  authorized: false as const,
  errorResponse: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/school-admin/ai-assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  insertedSessionRows.length = 0;
  insertedMessageRows.length = 0;
  sessionSelectResult.value = { data: null, error: null };
  contextRpcResult = { data: { has_data: true }, error: null };
  capUserCount.value = 0;
  capSessionsError.value = null;
  capSessionsData.value = [{ id: 'existing-sess' }];

  // Defaults: flag ON, auth OK, breaker closed, Claude answers with provenance.
  isFeatureEnabled.mockResolvedValue(true);
  authorizeSchoolAdmin.mockResolvedValue(AUTH_OK);
  isCircuitBreakerOpen.mockReturnValue(false);
  callClaude.mockResolvedValue({
    content: 'Your school MAU rose 8% this week.',
    model: 'claude-haiku-4-5',
    tokensUsed: 321,
    latencyMs: 540,
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 1. TENANT ISOLATION (most important)
// ═══════════════════════════════════════════════════════════════════════
describe('Principal AI POST — tenant isolation', () => {
  it('calls get_principal_ai_context with the authorize-resolved schoolId, NOT the body school_id', async () => {
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    // Adversarial body: attacker tries to pivot to another school's data.
    const res = await POST(
      postReq({ message: 'show me revenue', school_id: ATTACKER_SCHOOL }),
    );

    expect(res.status).toBe(200);

    // The context RPC was called exactly once, with the SERVER schoolId.
    const ctxCall = rpcCalls.find((c) => c.fn === 'get_principal_ai_context');
    expect(ctxCall).toBeDefined();
    expect(ctxCall!.args).toEqual({ p_school_id: CALLER_SCHOOL });
    // The attacker-supplied school id never reaches the RPC.
    expect(JSON.stringify(rpcCalls)).not.toContain(ATTACKER_SCHOOL);
  });

  it('scopes any freshly-minted session to the authorize-resolved schoolId, never the body value', async () => {
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    await POST(postReq({ message: 'hi', school_id: ATTACKER_SCHOOL }));

    // A session was created and it is bound to the caller's school, not the body.
    expect(insertedSessionRows.length).toBeGreaterThanOrEqual(1);
    expect(insertedSessionRows[0]).toEqual(
      expect.objectContaining({ school_id: CALLER_SCHOOL, auth_user_id: ADMIN_UID }),
    );
    expect(insertedSessionRows[0].school_id).not.toBe(ATTACKER_SCHOOL);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. AUTH DENIAL short-circuits before any RPC / LLM call
// ═══════════════════════════════════════════════════════════════════════
describe('Principal AI POST — auth denial', () => {
  it('returns the authorizeSchoolAdmin denial and NEVER calls the context RPC or Claude', async () => {
    authorizeSchoolAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'anything' }));

    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
    expect(callClaude).not.toHaveBeenCalled();
    // No session/message writes on a denial.
    expect(insertedSessionRows).toHaveLength(0);
    expect(insertedMessageRows).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. FLAG OFF → 503 { success:false, error:'feature_not_enabled' } before
//    auth / work (portal RBAC remediation Phase 0+1, 2026-06-16)
// ═══════════════════════════════════════════════════════════════════════
describe('Principal AI POST — flag gate', () => {
  it('returns 503 feature_not_enabled and never authorizes or calls the RPC/Claude when the flag is OFF', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'hi' }));

    // Flag-OFF contract: 503 temporarily-unavailable capability (was 404
    // not_found before the portal RBAC remediation Phase 0+1). The route gates
    // on the flag BEFORE authz, so authorize is never reached, and no grounding
    // RPC / Claude call is made.
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('feature_not_enabled');
    expect(authorizeSchoolAdmin).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
    expect(callClaude).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. FOREIGN session_id is not reused
// ═══════════════════════════════════════════════════════════════════════
describe('Principal AI POST — foreign session_id', () => {
  it('does NOT reuse a session whose school_id != caller schoolId; mints a fresh school-scoped session', async () => {
    // resolveSession reads the provided session; it belongs to ANOTHER school.
    sessionSelectResult.value = {
      data: { id: 'foreign-sess', school_id: ATTACKER_SCHOOL },
      error: null,
    };
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(
      postReq({ message: 'leak please', session_id: 'foreign-sess' }),
    );

    expect(res.status).toBe(200);
    // A NEW session was minted (the foreign one was not adopted).
    expect(insertedSessionRows.length).toBeGreaterThanOrEqual(1);
    expect(insertedSessionRows[0].school_id).toBe(CALLER_SCHOOL);
    // No assistant/user message was ever written against the foreign session id.
    const wroteToForeign = insertedMessageRows.some(
      (m) => m.session_id === 'foreign-sess',
    );
    expect(wroteToForeign).toBe(false);
  });

  it('reuses a session that DOES belong to the caller schoolId (no new session minted)', async () => {
    sessionSelectResult.value = {
      data: { id: 'own-sess', school_id: CALLER_SCHOOL },
      error: null,
    };
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'hi', session_id: 'own-sess' }));

    expect(res.status).toBe(200);
    // The own session was adopted → no fresh session insert.
    expect(insertedSessionRows).toHaveLength(0);
    const body = await res.json();
    expect(body.sessionId).toBe('own-sess');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. DAILY CAP exceeded → 429, no LLM call
// ═══════════════════════════════════════════════════════════════════════
describe('Principal AI POST — daily cap', () => {
  it('returns 429 and never calls Claude or the context RPC when the cap is reached', async () => {
    capUserCount.value = 50; // DAILY_CAP_PER_ADMIN
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'one more' }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('daily_limit_reached');
    expect(callClaude).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5b. DAILY CAP fail-closed (Finding #5 / P12) — a cap-counter READ ERROR
//     while the flag is ON + authorize succeeds → HTTP 503, Claude NEVER
//     called (no unmetered model spend). A legitimate empty result (no
//     sessions yet) is NOT an error → request proceeds normally.
// ═══════════════════════════════════════════════════════════════════════
describe('Principal AI POST — daily cap fail-closed (Finding #5, P12)', () => {
  it('FAIL-CLOSED: a cap-counter read error → 503 temporarily_unavailable and never calls Claude or the context RPC', async () => {
    // Flag ON + auth OK (set in beforeEach). The principal_ai_sessions cap
    // select (the first query checkDailyCap reads) errors out — a genuine
    // counter-read failure that must NOT let the turn through unmetered.
    capSessionsError.value = { code: '57014', message: 'canceling statement due to statement timeout' };

    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'how is engagement?' }));

    // Safe deny — HTTP 503, honest "could not verify quota".
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('temporarily_unavailable');

    // No model spend, no grounding RPC, no message writes.
    expect(callClaude).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
    expect(insertedSessionRows).toHaveLength(0);
    expect(insertedMessageRows).toHaveLength(0);
  });

  it('POSITIVE: a legitimate empty cap result (no sessions today, no error) is NOT fail-closed — request proceeds to the authorized path', async () => {
    // First use today: the cap sessions select returns an EMPTY list with NO
    // error. checkDailyCap treats this as "0 used so far" (usedToday 0), which
    // is under the cap → the turn proceeds normally (not 503, not 429).
    capSessionsData.value = [];

    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'how is engagement?' }));

    // NOT the fail-closed 503, NOT the cap 429 — it reached the happy path.
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(503);
    expect(res.status).not.toBe(429);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.error).toBeUndefined();

    // It reached the authorized flow: context RPC + Claude were invoked.
    const ctxCall = rpcCalls.find((c) => c.fn === 'get_principal_ai_context');
    expect(ctxCall).toBeDefined();
    expect(ctxCall!.args).toEqual({ p_school_id: CALLER_SCHOOL });
    expect(callClaude).toHaveBeenCalledTimes(1);
    expect(body.model).toBe('claude-haiku-4-5');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. UPSTREAM failure / circuit open → graceful abstain (NOT 500)
// ═══════════════════════════════════════════════════════════════════════
describe('Principal AI POST — graceful degradation', () => {
  it('Claude throwing → HTTP 200 abstain envelope (never 500)', async () => {
    callClaude.mockRejectedValue(new Error('all models exhausted'));
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'analyze' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.abstainReason).toBe('unavailable');
    expect(body.model).toBeNull();
  });

  it('circuit breaker open → HTTP 200 abstain, Claude never invoked', async () => {
    isCircuitBreakerOpen.mockReturnValue(true);
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'analyze' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.abstainReason).toBe('unavailable');
    expect(callClaude).not.toHaveBeenCalled();
  });

  it('null context (RPC failure) → HTTP 200 abstain, Claude never invoked', async () => {
    contextRpcResult = { data: null, error: { code: '42883', message: 'function does not exist' } };
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'analyze' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.abstainReason).toBe('unavailable');
    expect(callClaude).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. MODEL PROVENANCE (REG-67) on persisted row + response envelope
// ═══════════════════════════════════════════════════════════════════════
describe('Principal AI POST — model provenance (REG-67)', () => {
  it('stamps the Claude model id on the persisted assistant row AND the response', async () => {
    const { POST } = await import('@/app/api/school-admin/ai-assistant/route');

    const res = await POST(postReq({ message: 'how is engagement?' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    // On the wire.
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.tokensUsed).toBe(321);
    expect(body.abstainReason).toBeNull();

    // Persisted assistant row carries the provenance + tokens/latency.
    const assistantRow = insertedMessageRows.find((m) => m.role === 'assistant');
    expect(assistantRow).toBeDefined();
    expect(assistantRow).toEqual(
      expect.objectContaining({
        role: 'assistant',
        model: 'claude-haiku-4-5',
        tokens_used: 321,
        latency_ms: 540,
        abstain_reason: null,
      }),
    );
  });
});
