/**
 * Offline-payment reconciliation submit auth-level pin (CEO-approved
 * money-route tightening, 2026-06-11).
 *
 * src/app/api/super-admin/reconciliation/route.ts:
 *   GET  (~58)  — list the reconciliation queue  → stays 'support'
 *   POST (~120) — submit a new offline payment    → raised to 'super_admin'
 *
 * POST writes a pending row into `payment_reconciliation_queue` (the first leg
 * of the two-person offline-money flow whose /approve sub-route actually moves
 * the money — pinned separately in reconciliation-actions.test.ts). Submitting
 * is itself a state change that must require the super_admin floor; reading the
 * queue stays at 'support'.
 *
 * On denial: returns the authorizeAdmin response, inserts NO row, fires NO
 * audit, and never reaches the feature-flag check. On the authorized path:
 * authorizeAdmin called with 'super_admin'.
 *
 * Seam: getSupabaseAdmin() chainable mock, isFeatureEnabled + capture +
 * logAdminAudit stubbed at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
}));

const isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabled(...args),
}));

vi.mock('@alfanumrik/lib/posthog/server', () => ({ capture: vi.fn() }));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Chainable getSupabaseAdmin() mock ────────────────────────────────

interface CannedResult {
  data: unknown;
  error: unknown;
}

let invoiceReadResult: CannedResult = { data: null, error: null };
let insertResult: CannedResult = { data: { id: 'recon-1' }, error: null };

const insertCalls: Array<{ table: string; payload: unknown }> = [];

function makeChainable(table: string) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => Promise.resolve({ data: [], error: null, count: 0 })),
    maybeSingle: vi.fn(() => Promise.resolve(invoiceReadResult)),
    single: vi.fn(() => Promise.resolve(insertResult)),
    insert: vi.fn((payload: unknown) => {
      insertCalls.push({ table, payload });
      return chain;
    }),
  };
  return chain;
}

const supabaseStub = {
  from: vi.fn((table: string) => makeChainable(table)),
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
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

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/reconciliation', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls.length = 0;
  invoiceReadResult = { data: null, error: null };
  insertResult = { data: { id: 'recon-1' }, error: null };
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
  isFeatureEnabled.mockResolvedValue(true);
});

// ══════════════════════════════════════════════════════════════════════
//  GET — read stays 'support'
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/reconciliation — read level', () => {
  it('calls authorizeAdmin at support (default), not super_admin', async () => {
    const { GET } = await import('@/app/api/super-admin/reconciliation/route');
    await GET(req('GET'));
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).not.toBe('super_admin');
  });
});

// ══════════════════════════════════════════════════════════════════════
//  POST submit — requires super_admin
// ══════════════════════════════════════════════════════════════════════

describe('POST /api/super-admin/reconciliation — submit level', () => {
  it('returns the denial (403) and performs NO state change when denied', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/reconciliation/route');

    const res = await POST(
      req('POST', {
        invoice_id: UUID,
        received_amount_inr: 5000,
        payment_method: 'bank_transfer',
        reference_number: 'NEFT-123',
      }),
    );

    expect(res.status).toBe(403);
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('calls authorizeAdmin with super_admin on the authorized path', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // unpaid invoice whose amount matches the received amount within tolerance.
    invoiceReadResult = {
      data: { id: UUID, school_id: 'school-1', amount_inr: 5000, status: 'sent' },
      error: null,
    };

    const { POST } = await import('@/app/api/super-admin/reconciliation/route');
    const res = await POST(
      req('POST', {
        invoice_id: UUID,
        received_amount_inr: 5000,
        payment_method: 'bank_transfer',
        reference_number: 'NEFT-123',
      }),
    );

    expect(res.status).toBe(200);
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
    expect(insertCalls.some((c) => c.table === 'payment_reconciliation_queue')).toBe(true);
  });
});
