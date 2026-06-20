/**
 * POST /api/super-admin/billing/tax-config — set a per-SAC GST rate (Track A.3).
 *
 * Pins:
 *   - auth: authorizeAdmin(request, 'super_admin') — non-super-admin → 403 (P9),
 *     short-circuits before any write.
 *   - HISTORY-PRESERVING: writes a NEW effective-dated row via UPSERT on
 *     (sac, effective_from). It must NOT UPDATE an older effective_from row in
 *     place — asserted by checking the upsert conflict target + that an
 *     earlier-dated row is never the conflict key.
 *   - audit is metadata-only (P13): SAC + rate codes, no PII.
 *   - validation: numeric SAC, rate 0..100, YYYY-MM-DD effective_from.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuthorizeAdmin = vi.fn();
const mockLogAdminAudit = vi.fn();
vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...a: unknown[]) => mockAuthorizeAdmin(...a),
  logAdminAudit: (...a: unknown[]) => mockLogAdminAudit(...a),
}));

// Capture upsert calls (payload + options) and stage the returned row.
const upsertCalls = vi.hoisted(() => ({ list: [] as Array<{ payload: any; options: any }> }));
let _upsertResult: any = { data: { id: 'tc-1', sac: '9992', gst_rate: 18, is_exempt: false, effective_from: '2026-06-20' }, error: null };
function fromMock() {
  const chain: any = {};
  chain.upsert = (payload: any, options: any) => {
    upsertCalls.list.push({ payload, options });
    return chain;
  };
  chain.update = () => { throw new Error('UPDATE-in-place must never be used (history-preserving)'); };
  chain.select = () => chain;
  chain.maybeSingle = () => Promise.resolve(_upsertResult);
  return chain;
}
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: () => fromMock() } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function req(body: unknown): any {
  return { json: async () => body, headers: { get: () => null } };
}

function authorized() {
  return { authorized: true, userId: 'u1', adminId: 'a1', email: 'admin@x.com', name: 'Admin', adminLevel: 'super_admin' };
}
function deniedAdmin(status: number) {
  const { NextResponse } = require('next/server');
  return { authorized: false, response: NextResponse.json({ error: 'denied', code: 'ADMIN_INSUFFICIENT_LEVEL' }, { status }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertCalls.list = [];
  _upsertResult = { data: { id: 'tc-1', sac: '9992', gst_rate: 18, is_exempt: false, effective_from: '2026-06-20' }, error: null };
  mockAuthorizeAdmin.mockResolvedValue(authorized());
  mockLogAdminAudit.mockResolvedValue(undefined);
});

async function loadPOST() {
  return (await import('@/app/api/super-admin/billing/tax-config/route')).POST;
}

describe('POST /api/super-admin/billing/tax-config — auth (P9)', () => {
  it('requires the super_admin level', async () => {
    const POST = await loadPOST();
    await POST(req({ sac: '9992', gst_rate: 18 }));
    expect(mockAuthorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
  });

  it('a non-super-admin is rejected with 403 and never writes', async () => {
    mockAuthorizeAdmin.mockResolvedValue(deniedAdmin(403));
    const POST = await loadPOST();
    const res = await POST(req({ sac: '9992', gst_rate: 18 }));
    expect(res.status).toBe(403);
    expect(upsertCalls.list).toHaveLength(0);
    expect(mockLogAdminAudit).not.toHaveBeenCalled();
  });
});

describe('POST /api/super-admin/billing/tax-config — history-preserving write', () => {
  it('inserts a NEW effective-dated row (upsert on sac,effective_from) — never UPDATE-in-place', async () => {
    const POST = await loadPOST();
    const res = await POST(req({ sac: '9992', gst_rate: 18, effective_from: '2026-07-01' }));
    expect(res.status).toBe(200);

    expect(upsertCalls.list).toHaveLength(1);
    const { payload, options } = upsertCalls.list[0];
    // Conflict target is the (sac, effective_from) composite — a NEW date is a NEW row.
    expect(options).toEqual({ onConflict: 'sac,effective_from' });
    expect(payload.sac).toBe('9992');
    expect(payload.gst_rate).toBe(18);
    expect(payload.effective_from).toBe('2026-07-01');
    expect(payload.is_active).toBe(true);
    // fromMock().update throws if ever reached — proving no in-place UPDATE was used.
  });

  it('defaults effective_from to today (server-side) when omitted', async () => {
    const POST = await loadPOST();
    await POST(req({ sac: '9992', gst_rate: 18 }));
    const today = new Date().toISOString().slice(0, 10);
    expect(upsertCalls.list[0].payload.effective_from).toBe(today);
  });

  it('rejects an out-of-range rate (>100) with 400 before any write', async () => {
    const POST = await loadPOST();
    const res = await POST(req({ sac: '9992', gst_rate: 150 }));
    expect(res.status).toBe(400);
    expect(upsertCalls.list).toHaveLength(0);
  });

  it('rejects a non-numeric SAC with 400', async () => {
    const POST = await loadPOST();
    const res = await POST(req({ sac: 'abc', gst_rate: 18 }));
    expect(res.status).toBe(400);
    expect(upsertCalls.list).toHaveLength(0);
  });
});

describe('POST /api/super-admin/billing/tax-config — audit (P13)', () => {
  it('writes a metadata-only audit (codes + rate, no PII)', async () => {
    const POST = await loadPOST();
    await POST(req({ sac: '9992', gst_rate: 18, is_exempt: false, effective_from: '2026-07-01' }));
    expect(mockLogAdminAudit).toHaveBeenCalledTimes(1);
    const args = mockLogAdminAudit.mock.calls[0];
    // logAdminAudit(auth, action, entity, entityId, details, ip)
    expect(args[1]).toBe('billing.tax_config_set');
    expect(args[2]).toBe('tax_config');
    expect(args[4]).toEqual({ sac: '9992', gst_rate: 18, is_exempt: false, effective_from: '2026-07-01' });
    // The audit details must not contain PII keys.
    expect(JSON.stringify(args[4])).not.toMatch(/email|phone|name|gstin/i);
  });
});
