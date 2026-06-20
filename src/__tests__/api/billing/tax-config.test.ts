/**
 * GET /api/billing/tax-config — current active GST rate for a SAC (Track A.3).
 *
 * Pins:
 *   - auth gate: authorizeRequest(request, 'payments.subscribe'); denial short-
 *     circuits before any DB read.
 *   - returns the in-force rate (active, greatest effective_from <= today).
 *   - no config row → 0% / configured:false (matches compute_gst no-row behavior).
 *   - invalid (non-numeric) sac param → 400.
 *   - response is money/codes only — no PII (P13).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a) }));

let _row: any = { data: null, error: null };
const dbAccess = vi.hoisted(() => ({ called: false, filters: [] as Array<[string, unknown]> }));
function fromMock() {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = (c: string, v: unknown) => { dbAccess.filters.push([c, v]); return chain; };
  chain.lte = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = () => Promise.resolve(_row);
  return chain;
}
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: () => { dbAccess.called = true; return fromMock(); } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function req(url = 'http://localhost/api/billing/tax-config?sac=9992'): any {
  return { url };
}

function denied(status: number) {
  const { NextResponse } = require('next/server');
  return {
    authorized: false,
    errorResponse: NextResponse.json({ error: 'Access denied', code: 'PERMISSION_DENIED' }, { status }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbAccess.called = false;
  dbAccess.filters = [];
  _row = { data: null, error: null };
  mockAuthorizeRequest.mockResolvedValue({ authorized: true, errorResponse: undefined });
});

async function loadGET() {
  return (await import('@/app/api/billing/tax-config/route')).GET;
}

describe('GET /api/billing/tax-config — auth', () => {
  it('gates on the EXACT permission "payments.subscribe"', async () => {
    const GET = await loadGET();
    await GET(req());
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'payments.subscribe');
  });

  it('returns the denial verbatim and never touches the DB', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(403));
    const GET = await loadGET();
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(dbAccess.called).toBe(false);
  });
});

describe('GET /api/billing/tax-config — read behavior', () => {
  it('returns the active in-force rate for the SAC', async () => {
    _row = {
      data: { sac: '9992', gst_rate: 18, is_exempt: false, effective_from: '2026-04-01', effective_to: null },
      error: null,
    };
    const GET = await loadGET();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ sac: '9992', gst_rate: 18, is_exempt: false, configured: true });
    // Scoped to active rows for the requested SAC.
    expect(dbAccess.filters).toContainEqual(['sac', '9992']);
    expect(dbAccess.filters).toContainEqual(['is_active', true]);
  });

  it('returns 0% / configured:false when no config row exists for the SAC', async () => {
    _row = { data: null, error: null };
    const GET = await loadGET();
    const res = await GET(req('http://localhost/api/billing/tax-config?sac=9971'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ sac: '9971', gst_rate: 0, is_exempt: false, effective_from: null, configured: false });
  });

  it('defaults to SAC 9992 when no sac query param is given', async () => {
    _row = { data: { sac: '9992', gst_rate: 18, is_exempt: false, effective_from: '2026-04-01' }, error: null };
    const GET = await loadGET();
    const res = await GET(req('http://localhost/api/billing/tax-config'));
    expect(res.status).toBe(200);
    expect(dbAccess.filters).toContainEqual(['sac', '9992']);
  });

  it('rejects a non-numeric sac with 400', async () => {
    const GET = await loadGET();
    const res = await GET(req('http://localhost/api/billing/tax-config?sac=abc'));
    expect(res.status).toBe(400);
    expect(dbAccess.called).toBe(false);
  });

  it('the response carries no PII keys (P13)', async () => {
    _row = { data: { sac: '9992', gst_rate: 18, is_exempt: false, effective_from: '2026-04-01' }, error: null };
    const GET = await loadGET();
    const res = await GET(req());
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/email|phone|name|gstin/i);
  });
});
