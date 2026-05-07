/**
 * /api/cron/reverify-domains — nightly drift detector tests.
 *
 * Pins:
 *   - CRON_SECRET auth (constant-time compare).
 *   - Healthy school: dns_ok + vercel_ok → no flip, no audit, counted as still_healthy.
 *   - DNS drift only: domain_verified flipped to false + audit row written.
 *   - Vercel drift only: same flip + audit (when Vercel is configured).
 *   - VERCEL_NOT_CONFIGURED: Vercel check skipped — DNS still authoritative,
 *     summary.vercel_skipped = true so caller knows TLS drift wasn't caught.
 *   - Per-school exception: aggregated into errors[], does NOT abort sweep.
 *   - Idempotent fetch: only schools with domain_verified=true are queried —
 *     an already-flipped school is not rechecked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── DNS mock (vi.hoisted because vi.mock is hoisted above let-bindings) ────
const { resolveTxtMock } = vi.hoisted(() => ({ resolveTxtMock: vi.fn() }));
vi.mock('node:dns/promises', () => ({
  default: { resolveTxt: resolveTxtMock },
  resolveTxt: resolveTxtMock,
}));

// ── Vercel client mock ─────────────────────────────────────────────────────
const getDomainStateMock = vi.fn();
const getVercelEnvMock = vi.fn();
vi.mock('@/lib/vercel/domains', () => ({
  getDomainState: (...args: unknown[]) => getDomainStateMock(...args),
  getVercelEnv: (...args: unknown[]) => getVercelEnvMock(...args),
}));

// ── Audit mock ─────────────────────────────────────────────────────────────
const logAdminAction = vi.fn();
vi.mock('@/lib/admin-auth', () => ({
  logAdminAction: (...args: unknown[]) => logAdminAction(...args),
}));

// ── Logger silencer ────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Supabase chain mock ────────────────────────────────────────────────────
//
// The route does two distinct Supabase chains:
//   1. fetch:  from('schools').select(...).eq(...).not(...).order(...).limit(N)
//   2. update: from('schools').update(...).eq(...).eq(...)
//
// We build a chainable thenable so both .then() and intermediate .eq() resolve.

interface MockState {
  fetchResponse: { data: unknown[]; error: { message: string } | null };
  updateResponses: Array<{ error: { message: string } | null }>;
  updateCalls: Array<{ patch: unknown; eqs: Array<[string, unknown]> }>;
}

const state: MockState = {
  fetchResponse: { data: [], error: null },
  updateResponses: [],
  updateCalls: [],
};

function buildChain(): unknown {
  // Chainable thenable. Each terminal awaiter resolves to fetchResponse.
  const chain: Record<string, unknown> = {};
  const ret = () => Promise.resolve(state.fetchResponse);
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.not = () => chain;
  chain.order = () => chain;
  chain.limit = () => ret();
  chain.then = (resolve: (v: unknown) => unknown) => ret().then(resolve);
  return chain;
}

function buildUpdateChain(patch: unknown): unknown {
  const eqs: Array<[string, unknown]> = [];
  const callIndex = state.updateCalls.length;
  state.updateCalls.push({ patch, eqs });
  const ret = () => {
    const r = state.updateResponses[callIndex] ?? { error: null };
    return Promise.resolve(r);
  };
  const chain: Record<string, unknown> = {};
  chain.eq = (col: string, val: unknown) => {
    eqs.push([col, val]);
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown) => ret().then(resolve);
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      select: () => buildChain(),
      update: (patch: unknown) => buildUpdateChain(patch),
    }),
  }),
}));

import { POST } from '@/app/api/cron/reverify-domains/route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resolveTxtMock.mockReset();
  getDomainStateMock.mockReset();
  getVercelEnvMock.mockReset();
  logAdminAction.mockReset();
  state.fetchResponse = { data: [], error: null };
  state.updateResponses = [];
  state.updateCalls = [];

  process.env.CRON_SECRET = 'test-secret-value';
  // Default: Vercel IS configured (so we exercise both DNS + Vercel paths)
  getVercelEnvMock.mockReturnValue({
    apiToken: 'tok',
    projectId: 'prj_test',
    teamId: undefined,
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== undefined) headers['x-cron-secret'] = secret;
  return new NextRequest('http://localhost/api/cron/reverify-domains', {
    method: 'POST',
    body: '{}',
    headers,
  });
}

// ── Auth gate ──────────────────────────────────────────────────────────────

describe('reverify-domains — auth gate', () => {
  it('rejects when x-cron-secret is missing → 401', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(state.updateCalls).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('rejects on wrong secret → 401', async () => {
    const res = await POST(makeRequest('not-the-secret'));
    expect(res.status).toBe(401);
  });

  it('accepts via authorization: Bearer fallback', async () => {
    const req = new NextRequest('http://localhost/api/cron/reverify-domains', {
      method: 'POST',
      body: '{}',
      headers: {
        authorization: 'Bearer test-secret-value',
        'content-type': 'application/json',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ── No verified schools ────────────────────────────────────────────────────

describe('reverify-domains — empty fleet', () => {
  it('returns 200 with zero counters when no schools to scan', async () => {
    const res = await POST(makeRequest('test-secret-value'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.schools_scanned).toBe(0);
    expect(body.data.drift_detected).toBe(0);
    expect(state.updateCalls).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

// ── Healthy school (no drift) ──────────────────────────────────────────────

describe('reverify-domains — healthy school', () => {
  it('does NOT flip or audit when DNS + Vercel both pass', async () => {
    state.fetchResponse = {
      data: [{ id: 'school-A', custom_domain: 'learn.dps.com', domain_verified: true }],
      error: null,
    };
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-school-A']]);
    getDomainStateMock.mockResolvedValueOnce({
      ok: true,
      data: { name: 'learn.dps.com', verified: true, misconfigured: false, verification: [] },
    });

    const res = await POST(makeRequest('test-secret-value'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.schools_scanned).toBe(1);
    expect(body.data.still_healthy).toBe(1);
    expect(body.data.drift_detected).toBe(0);
    expect(state.updateCalls).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

// ── DNS drift only ─────────────────────────────────────────────────────────

describe('reverify-domains — DNS drift', () => {
  it('flips domain_verified=false and audits when DNS TXT is missing', async () => {
    state.fetchResponse = {
      data: [{ id: 'school-A', custom_domain: 'learn.dps.com', domain_verified: true }],
      error: null,
    };
    const enotfound = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    resolveTxtMock.mockRejectedValueOnce(enotfound);
    getDomainStateMock.mockResolvedValueOnce({
      ok: true,
      data: { name: 'learn.dps.com', verified: true, misconfigured: false, verification: [] },
    });

    const res = await POST(makeRequest('test-secret-value'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.drift_detected).toBe(1);
    expect(body.data.still_healthy).toBe(0);

    // Optimistic update guard: WHERE id=X AND domain_verified=true.
    expect(state.updateCalls).toHaveLength(1);
    const updateCall = state.updateCalls[0];
    expect((updateCall.patch as { domain_verified: boolean }).domain_verified).toBe(false);
    expect(updateCall.eqs).toEqual([
      ['id', 'school-A'],
      ['domain_verified', true],
    ]);

    expect(logAdminAction).toHaveBeenCalledTimes(1);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'tenant.custom_domain_drift_detected',
      entity_type: 'school',
      entity_id: 'school-A',
      details: expect.objectContaining({
        custom_domain: 'learn.dps.com',
        triggered_by: 'cron/reverify-domains',
        drift: expect.objectContaining({
          dns_ok: false,
          vercel_ok: true,
        }),
      }),
    }));
  });

  it('detects token mismatch (TXT records exist but value is wrong)', async () => {
    state.fetchResponse = {
      data: [{ id: 'school-A', custom_domain: 'learn.dps.com', domain_verified: true }],
      error: null,
    };
    resolveTxtMock.mockResolvedValueOnce([['some-other-token-not-ours']]);
    getDomainStateMock.mockResolvedValueOnce({
      ok: true,
      data: { name: 'learn.dps.com', verified: true, misconfigured: false, verification: [] },
    });

    const res = await POST(makeRequest('test-secret-value'));
    const body = await res.json();
    expect(body.data.drift_detected).toBe(1);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({
        drift: expect.objectContaining({ dns_ok: false }),
      }),
    }));
  });
});

// ── Vercel drift only ──────────────────────────────────────────────────────

describe('reverify-domains — Vercel drift', () => {
  it('flips when Vercel reports verified=false', async () => {
    state.fetchResponse = {
      data: [{ id: 'school-A', custom_domain: 'learn.dps.com', domain_verified: true }],
      error: null,
    };
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-school-A']]);
    getDomainStateMock.mockResolvedValueOnce({
      ok: true,
      data: { name: 'learn.dps.com', verified: false, misconfigured: true, verification: [] },
    });

    const res = await POST(makeRequest('test-secret-value'));
    const body = await res.json();
    expect(body.data.drift_detected).toBe(1);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({
        drift: expect.objectContaining({
          dns_ok: true,
          vercel_ok: false,
        }),
      }),
    }));
  });

  it('flips when Vercel reports DOMAIN_NOT_ATTACHED (404)', async () => {
    state.fetchResponse = {
      data: [{ id: 'school-A', custom_domain: 'learn.dps.com', domain_verified: true }],
      error: null,
    };
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-school-A']]);
    getDomainStateMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      code: 'DOMAIN_NOT_ATTACHED',
      error: 'Domain is not attached to this Vercel project.',
    });

    const res = await POST(makeRequest('test-secret-value'));
    const body = await res.json();
    expect(body.data.drift_detected).toBe(1);
  });
});

// ── Vercel not configured ──────────────────────────────────────────────────

describe('reverify-domains — VERCEL_NOT_CONFIGURED', () => {
  it('skips Vercel check; DNS-only outcome remains authoritative', async () => {
    getVercelEnvMock.mockReturnValue(null);
    state.fetchResponse = {
      data: [
        { id: 'school-A', custom_domain: 'learn.dps.com', domain_verified: true },
        { id: 'school-B', custom_domain: 'broken.com', domain_verified: true },
      ],
      error: null,
    };
    // school-A: DNS OK
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-school-A']]);
    // school-B: DNS missing
    resolveTxtMock.mockRejectedValueOnce(
      Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
    );

    const res = await POST(makeRequest('test-secret-value'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.vercel_skipped).toBe(true);
    expect(body.data.drift_detected).toBe(1); // only school-B
    expect(body.data.still_healthy).toBe(1);  // school-A
    expect(getDomainStateMock).not.toHaveBeenCalled();

    // Audit for school-B records vercel_ok=null (skipped, not failed).
    const auditCall = logAdminAction.mock.calls[0]?.[0] as { details: { drift: { vercel_ok: unknown } } };
    expect(auditCall.details.drift.vercel_ok).toBeNull();
  });
});

// ── Per-school exception isolation ─────────────────────────────────────────

describe('reverify-domains — exception isolation', () => {
  it('one bad school does not abort the sweep', async () => {
    state.fetchResponse = {
      data: [
        { id: 'school-A', custom_domain: 'good.com', domain_verified: true },
        { id: 'school-B', custom_domain: 'explodes.com', domain_verified: true },
        { id: 'school-C', custom_domain: 'good2.com', domain_verified: true },
      ],
      error: null,
    };
    // Every school gets a DNS + Vercel call (Vercel is configured this run).
    // school-A healthy
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-school-A']]);
    getDomainStateMock.mockResolvedValueOnce({
      ok: true,
      data: { name: 'good.com', verified: true, misconfigured: false, verification: [] },
    });
    // school-B: getDomainState throws — exercises the per-school catch path
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-school-B']]);
    getDomainStateMock.mockRejectedValueOnce(new Error('vercel exploded'));
    // school-C healthy
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-school-C']]);
    getDomainStateMock.mockResolvedValueOnce({
      ok: true,
      data: { name: 'good2.com', verified: true, misconfigured: false, verification: [] },
    });

    const res = await POST(makeRequest('test-secret-value'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.schools_scanned).toBe(3);
    expect(body.data.still_healthy).toBe(2); // A + C ran cleanly
    expect(body.data.errors.length).toBe(1);
    expect(body.data.errors[0]).toMatch(/school-B_exception/);
    // No flip / audit for the exception case — sweep continues, doesn't poison
    // the row's state.
    expect(state.updateCalls).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

// ── Fetch failure ──────────────────────────────────────────────────────────

describe('reverify-domains — fetch failure', () => {
  it('returns 500 when school fetch fails', async () => {
    state.fetchResponse = { data: [], error: { message: 'connection refused' } };
    const res = await POST(makeRequest('test-secret-value'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});
