/**
 * School-contracts auth-level pin (CEO-approved money-route tightening,
 * 2026-06-11).
 *
 * Contracts are B2B legal/money documents. The mutating handlers were raised
 * from the defaulted 'support' floor to 'super_admin'; the reads stay 'support'.
 *
 *   contracts/route.ts            GET  (~58)  list      → 'support'
 *                                 POST (~107) create     → 'super_admin'
 *   contracts/[id]/route.ts       GET  (~45)  read       → 'support'
 *                                 PATCH(~75)  sign/cancel → 'super_admin'
 *   contracts/[id]/renew/route.ts POST (~64)  renew      → 'super_admin'
 *
 * Each mutation: on denial the handler returns the authorizeAdmin response and
 * performs ZERO state change — no school_contracts insert/update, no
 * next_contract_number RPC, no audit. On the authorized path it calls
 * authorizeAdmin(..., 'super_admin'). All routes are gated behind
 * `ff_school_contracts_v1`, but that flag check runs AFTER the auth gate, so on
 * the denial path it never fires (asserted).
 *
 * Seam: getSupabaseAdmin() chainable mock (insert/update/rpc recorded),
 * isFeatureEnabled + capture + logAdminAudit stubbed at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
}));

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabled(...args),
}));

vi.mock('@/lib/posthog/server', () => ({ capture: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Chainable getSupabaseAdmin() mock ────────────────────────────────

interface CannedResult {
  data: unknown;
  error: unknown;
}

let readResult: CannedResult = { data: null, error: null };
let rpcResult: CannedResult = { data: 1, error: null };
let insertResult: CannedResult = { data: { id: 'new-contract', contract_number: 'ALF-CTR/2526/XX/00001' }, error: null };

const insertCalls: Array<{ table: string; payload: unknown }> = [];
const updateCalls: Array<{ table: string; payload: unknown }> = [];
const rpcCalls: Array<{ fn: string; args: unknown }> = [];

function makeChainable(table: string) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => Promise.resolve({ data: [], error: null, count: 0 })),
    maybeSingle: vi.fn(() => Promise.resolve(readResult)),
    single: vi.fn(() => Promise.resolve(insertResult)),
    insert: vi.fn((payload: unknown) => {
      insertCalls.push({ table, payload });
      return chain;
    }),
    update: vi.fn((payload: unknown) => {
      updateCalls.push({ table, payload });
      return chain;
    }),
    // terminal update chain (.eq().in()) resolves here
    then: (resolve: (r: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };
  return chain;
}

const supabaseStub = {
  from: vi.fn((table: string) => makeChainable(table)),
  rpc: vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve(rpcResult);
  }),
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseStub,
  supabaseAdmin: supabaseStub,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────

const UUID = '11111111-1111-4111-8111-111111111111';
const ADMIN_UID = '22222222-2222-4222-8222-222222222222';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  adminId: 'admin-row-id',
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

const AUTH_DENIED = () => ({
  authorized: false as const,
  response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
});

function req(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  updateCalls.length = 0;
  rpcCalls.length = 0;
  readResult = { data: null, error: null };
  rpcResult = { data: 1, error: null };
  insertResult = { data: { id: 'new-contract', contract_number: 'ALF-CTR/2526/XX/00001' }, error: null };
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
  isFeatureEnabled.mockResolvedValue(true);
});

// ══════════════════════════════════════════════════════════════════════
//  contracts/route.ts
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/contracts — read level', () => {
  it('calls authorizeAdmin at support (default), not super_admin', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    const { GET } = await import('@/app/api/super-admin/contracts/route');
    await GET(req('/api/super-admin/contracts', 'GET'));
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).not.toBe('super_admin');
  });
});

describe('POST /api/super-admin/contracts — create level', () => {
  it('returns the denial (403) and performs NO state change when denied', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/contracts/route');

    const res = await POST(
      req('/api/super-admin/contracts', 'POST', {
        school_id: UUID,
        start_date: '2026-06-01',
        end_date: '2027-05-31',
        billing_cycle: 'annual',
        seats_purchased: 100,
        value_inr: 50000,
      }),
    );

    expect(res.status).toBe(403);
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
    // Flag check is downstream of the auth gate.
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('calls authorizeAdmin with super_admin on the authorized path', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // school lookup returns a row so the create proceeds.
    readResult = { data: { id: UUID, state: 'KA' }, error: null };

    const { POST } = await import('@/app/api/super-admin/contracts/route');
    await POST(
      req('/api/super-admin/contracts', 'POST', {
        school_id: UUID,
        start_date: '2026-06-01',
        end_date: '2027-05-31',
        billing_cycle: 'annual',
        seats_purchased: 100,
        value_inr: 50000,
      }),
    );

    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
    expect(insertCalls.some((c) => c.table === 'school_contracts')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  contracts/[id]/route.ts
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/contracts/[id] — read level', () => {
  it('calls authorizeAdmin at support (default), not super_admin', async () => {
    const { GET } = await import('@/app/api/super-admin/contracts/[id]/route');
    await GET(req(`/api/super-admin/contracts/${UUID}`, 'GET'), ctx(UUID));
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).not.toBe('super_admin');
  });
});

describe('PATCH /api/super-admin/contracts/[id] — sign/cancel level', () => {
  it('returns the denial (403) and performs NO state change when denied', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { PATCH } = await import('@/app/api/super-admin/contracts/[id]/route');

    const res = await PATCH(
      req(`/api/super-admin/contracts/${UUID}`, 'PATCH', { action: 'sign', pdf_url: 'https://x/y.pdf' }),
      ctx(UUID),
    );

    expect(res.status).toBe(403);
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('calls authorizeAdmin with super_admin on the authorized path', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // draft row so the sign branch flips it to active.
    readResult = {
      data: { id: UUID, school_id: 'school-1', status: 'draft', pdf_url: null, contract_number: 'ALF-CTR/2526/KA/00001' },
      error: null,
    };

    const { PATCH } = await import('@/app/api/super-admin/contracts/[id]/route');
    const res = await PATCH(
      req(`/api/super-admin/contracts/${UUID}`, 'PATCH', { action: 'sign', pdf_url: 'https://x/y.pdf' }),
      ctx(UUID),
    );

    expect(res.status).toBe(200);
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
    expect(updateCalls.some((c) => c.table === 'school_contracts')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  contracts/[id]/renew/route.ts
// ══════════════════════════════════════════════════════════════════════

describe('POST /api/super-admin/contracts/[id]/renew — renew level', () => {
  it('returns the denial (403) and performs NO state change when denied', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/contracts/[id]/renew/route');

    const res = await POST(
      req(`/api/super-admin/contracts/${UUID}/renew`, 'POST', {}),
      ctx(UUID),
    );

    expect(res.status).toBe(403);
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('calls authorizeAdmin with super_admin on the authorized path', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // previous active contract row.
    readResult = {
      data: {
        id: UUID,
        school_id: 'school-1',
        status: 'active',
        end_date: '2026-05-31',
        billing_cycle: 'annual',
        seats_purchased: 100,
        value_inr: 50000,
      },
      error: null,
    };

    const { POST } = await import('@/app/api/super-admin/contracts/[id]/renew/route');
    await POST(req(`/api/super-admin/contracts/${UUID}/renew`, 'POST', {}), ctx(UUID));

    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
    expect(insertCalls.some((c) => c.table === 'school_contracts')).toBe(true);
  });
});
