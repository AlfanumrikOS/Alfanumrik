/**
 * /api/internal/admin/feature-flags — protected-flag guardrail coverage.
 *
 * AUTH-MODEL UPDATE (P2-1 PR-3, 2026-08-03)
 *   This route previously mutated `feature_flags` behind the WEAKER
 *   `x-admin-secret` shared-secret gate (`requireAdminSecret`). It was swapped
 *   to the session/RBAC gate `authorizeRequest(request, 'system.config')`. The
 *   guardrail this file exists to verify is UNCHANGED — the route still REFUSES
 *   to create/enable a protected flag from this path — so the auth PRECONDITION
 *   is the only thing rewritten here: we authenticate as an authorized
 *   super_admin (mocked `authorizeRequest`) so every test reaches the guardrail
 *   logic, then assert the guardrail behavior exactly as before.
 *
 * WHY THE GUARDRAIL EXISTS (unchanged)
 *   - POST (INSERT) is NOT covered by the DB-layer `trg_protect_feature_flags`
 *     trigger (BEFORE UPDATE only), so it could create a brand-new row under a
 *     protected/reserved name pre-enabled — the "delete-recreate"-class bypass
 *     the super-admin console POST handler already defends against.
 *   - PATCH on an EXISTING protected row making it MORE enabled would be blocked
 *     by the DB trigger, but this route had no typed-confirmation / burst-guard
 *     parity and would surface a raw Postgres trigger error instead of a clean
 *     403.
 *   The route now REFUSES to touch a protected flag from this path at all — POST
 *   refuses creation under a protected/reserved name (403 FLAG_PROTECTED) and
 *   PATCH refuses is_enabled / rollout_percentage changes on an existing
 *   protected flag (403 FLAG_PROTECTED). Everything else (unprotected flags, or
 *   protected-flag description/target_* edits) is unaffected.
 *
 * SEAM CHOICE
 *   - `authorizeRequest` (`@alfanumrik/lib/rbac`) is MOCKED — `permit()` (the
 *     beforeEach default) resolves an authorized super_admin so tests reach the
 *     guardrail; `deny()` resolves the 401 the route propagates before any DB
 *     work (see the auth-precedence block).
 *   - `getProtection` (the protected-flags registry) is NOT mocked — real
 *     registry data is used so this suite breaks if the registry silently drops
 *     a flag.
 *   - Only the service-role DB seam (`getSupabaseAdmin`), `logAdminAction`, and
 *     `invalidateFlagCache` are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── RBAC gate. Mocked so tests can authenticate as an authorized super_admin
//    (permit — the default) or an unauthenticated caller (deny). ──
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

// ── logAdminAction is fire-and-forget; stub it. It is the only symbol this
//    route imports from admin-auth. ──
const logAdminAction = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/admin-auth', () => ({
  logAdminAction: (...args: unknown[]) => logAdminAction(...args),
}));

const invalidateFlagCache = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  invalidateFlagCache: (...args: unknown[]) => invalidateFlagCache(...args),
}));

// ── Service-role data seam. Chainable mock: `.select()/.insert()/.update()/.eq()`
//    all return the same chain object; `.single()`/`.maybeSingle()` resolve the
//    configured lookup/insert result, and awaiting the chain directly (the bare
//    `update().eq()` call with no terminal method) resolves the configured
//    update result via `.then`. ──
interface ChainConfig {
  /** flag_name returned by the PATCH pre-update lookup (`select('flag_name').eq('id', id).maybeSingle()`). null = no matching row. */
  existingFlagName?: string | null;
  /** Result of the POST `insert().select().single()` call. */
  insertResult?: { data: unknown; error: unknown };
  /** Result of the bare PATCH `update().eq()` await. */
  updateResult?: { data: unknown; error: unknown };
}

function makeChain(cfg: ChainConfig = {}) {
  const insertPayloads: unknown[] = [];
  const updatePayloads: unknown[] = [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn((payload: unknown) => {
    insertPayloads.push(payload);
    return chain;
  });
  chain.update = vi.fn((payload: unknown) => {
    updatePayloads.push(payload);
    return chain;
  });
  chain.single = vi.fn(() =>
    Promise.resolve(cfg.insertResult ?? { data: { id: 'new-flag-id' }, error: null }),
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({
      data: cfg.existingFlagName !== undefined && cfg.existingFlagName !== null
        ? { flag_name: cfg.existingFlagName }
        : null,
      error: null,
    }),
  );
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve(cfg.updateResult ?? { data: null, error: null });
  return { chain, insertPayloads, updatePayloads };
}

const getSupabaseAdminMock = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: (...args: unknown[]) => getSupabaseAdminMock(...args),
}));

const FLAG_ID = '11111111-1111-4111-8111-111111111111';

function req(body: unknown, opts: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  const { method = 'POST', headers = {} } = opts;
  return new NextRequest('http://localhost/api/internal/admin/feature-flags', {
    method,
    // Bearer header for realism only — authorizeRequest is mocked, so allow/deny
    // is driven by permit()/deny(), not by real token verification.
    headers: { 'content-type': 'application/json', Authorization: 'Bearer t', ...headers },
    body: JSON.stringify(body),
  });
}

/** Authorized super_admin (holds system.config) → reaches the guardrail. */
function permit() {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'admin-1',
    studentId: null,
    roles: ['super_admin'],
    permissions: [],
    errorResponse: null,
  });
}

/** No valid session → authorizeRequest returns its 401 before any handler work. */
function deny() {
  const errorResponse = new Response(
    JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  permit(); // default: authenticated authorized super_admin, so tests reach the guardrail
});

// Representative protected names, one per relevant tier (same as the
// super-admin console suite for cross-reference).
const CONSTITUTION_FLAG = 'ff_school_pulse_v1'; // constitution_pinned
const SPECIAL_FLAG = 'ff_atomic_subscription_activation'; // special_do_not_touch
const UNPROTECTED_FLAG = 'ff_demo_v1';

// ─── Auth precondition — the RBAC gate runs BEFORE the guardrail ──────────
// Proves the auth swap didn't just move the guardrail behind a no-op gate: an
// unauthenticated caller is rejected before getSupabaseAdmin() is ever obtained,
// so the guardrail (and every DB touch) is unreachable without a session.

describe('/api/internal/admin/feature-flags — authorization gate precedes the guardrail', () => {
  it('POST without a valid session → 401, service-role client never obtained', async () => {
    deny();
    const { POST } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await POST(req({ name: CONSTITUTION_FLAG, is_enabled: true }) as never) as Response;

    expect(res.status).toBe(401);
    expect(getSupabaseAdminMock).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
    expect(invalidateFlagCache).not.toHaveBeenCalled();
  });

  it('PATCH without a valid session → 401, service-role client never obtained', async () => {
    deny();
    const { PATCH } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await PATCH(req({ id: FLAG_ID, is_enabled: true }, { method: 'PATCH' }) as never) as Response;

    expect(res.status).toBe(401);
    expect(getSupabaseAdminMock).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

// ─── POST — creating under a protected/reserved name ──────────────────────

describe('POST /api/internal/admin/feature-flags — protected-name guardrail', () => {
  it('refuses to create a row under a protected name → 403 FLAG_PROTECTED, DB never touched', async () => {
    const { chain, insertPayloads } = makeChain();
    getSupabaseAdminMock.mockReturnValue({ from: vi.fn(() => chain) });

    const { POST } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await POST(req({ name: CONSTITUTION_FLAG, is_enabled: true }) as never) as Response;

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FLAG_PROTECTED');
    expect(body.tier).toBe('constitution_pinned');
    expect(insertPayloads).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
    expect(invalidateFlagCache).not.toHaveBeenCalled();
  });

  it('refuses creation under the ff_python_ PREFIX rule for an un-enumerated name → 403 FLAG_PROTECTED', async () => {
    const { chain, insertPayloads } = makeChain();
    getSupabaseAdminMock.mockReturnValue({ from: vi.fn(() => chain) });

    const { POST } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await POST(req({ name: 'ff_python_shiny_new_service_v1' }) as never) as Response;

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FLAG_PROTECTED');
    expect(body.tier).toBe('special_do_not_touch');
    expect(insertPayloads).toHaveLength(0);
  });

  it('creating an UNPROTECTED name proceeds normally (guardrail invisible to normal flags)', async () => {
    const { chain, insertPayloads } = makeChain({
      insertResult: { data: { id: 'new-flag-id', flag_name: UNPROTECTED_FLAG }, error: null },
    });
    getSupabaseAdminMock.mockReturnValue({ from: vi.fn(() => chain) });

    const { POST } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await POST(req({ name: UNPROTECTED_FLAG, is_enabled: false }) as never) as Response;

    expect(res.status).not.toBe(403);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(insertPayloads).toHaveLength(1);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(invalidateFlagCache).toHaveBeenCalledTimes(1);
  });
});

// ─── PATCH — is_enabled / rollout_percentage changes on an existing protected flag ──

describe('PATCH /api/internal/admin/feature-flags — protected-flag guardrail', () => {
  it('refuses an is_enabled change on an existing protected flag → 403 FLAG_PROTECTED, DB update never called', async () => {
    const { chain, updatePayloads } = makeChain({ existingFlagName: CONSTITUTION_FLAG });
    getSupabaseAdminMock.mockReturnValue({ from: vi.fn(() => chain) });

    const { PATCH } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await PATCH(req({ id: FLAG_ID, is_enabled: true }, { method: 'PATCH' }) as never) as Response;

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FLAG_PROTECTED');
    expect(body.tier).toBe('constitution_pinned');
    expect(updatePayloads).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
    expect(invalidateFlagCache).not.toHaveBeenCalled();
  });

  it('refuses a rollout_percentage change on an existing protected flag → 403 FLAG_PROTECTED', async () => {
    const { chain, updatePayloads } = makeChain({ existingFlagName: SPECIAL_FLAG });
    getSupabaseAdminMock.mockReturnValue({ from: vi.fn(() => chain) });

    const { PATCH } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await PATCH(req({ id: FLAG_ID, rollout_percentage: 10 }, { method: 'PATCH' }) as never) as Response;

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FLAG_PROTECTED');
    expect(body.tier).toBe('special_do_not_touch');
    expect(updatePayloads).toHaveLength(0);
  });

  it('a description-only edit on an existing protected flag is UNAFFECTED (not gated)', async () => {
    const { chain, updatePayloads } = makeChain({
      existingFlagName: CONSTITUTION_FLAG,
      updateResult: { data: null, error: null },
    });
    getSupabaseAdminMock.mockReturnValue({ from: vi.fn(() => chain) });

    const { PATCH } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await PATCH(
      req({ id: FLAG_ID, description: 'copy tweak only' }, { method: 'PATCH' }) as never,
    ) as Response;

    expect(res.status).not.toBe(403);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(updatePayloads).toHaveLength(1);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
  });

  it('an is_enabled change on an UNPROTECTED flag proceeds normally', async () => {
    const { chain, updatePayloads } = makeChain({
      existingFlagName: UNPROTECTED_FLAG,
      updateResult: { data: null, error: null },
    });
    getSupabaseAdminMock.mockReturnValue({ from: vi.fn(() => chain) });

    const { PATCH } = await import('@/app/api/internal/admin/feature-flags/route');
    const res = await PATCH(req({ id: FLAG_ID, is_enabled: true }, { method: 'PATCH' }) as never) as Response;

    expect(res.status).not.toBe(403);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(updatePayloads).toHaveLength(1);
  });
});
