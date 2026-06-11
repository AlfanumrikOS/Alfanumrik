/**
 * School-invoices auth-level pin (CEO-approved money-route tightening,
 * 2026-06-11).
 *
 * src/app/api/super-admin/invoices/route.ts:
 *   GET   (line ~17)  — list invoices       → reads stay 'support'
 *   POST  (line ~115) — generate invoice     → raised to 'super_admin'
 *   PATCH (line ~283) — flip status (→ paid) → raised to 'super_admin'
 *
 * The POST mints a billable invoice and the PATCH marks it paid — both are
 * state-changing money operations, so they require the super_admin floor. The
 * GET is a read and must stay at 'support' so support staff can keep triaging.
 *
 * This file pins all three levels, and proves that on a POST/PATCH denial NO
 * row is created/updated and NO audit row is written.
 *
 * The route talks to Postgres via raw fetch() against `supabaseAdminUrl`, so
 * the seam we mock is global fetch + the admin-auth helpers. On the denial
 * path fetch must never fire (the gate short-circuits first); we assert that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: () => ({ apikey: 'stub', Authorization: 'Bearer stub' }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
  // Any accidental fetch on a denial path is observable here instead of a
  // network error.
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/invoices', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

// ══════════════════════════════════════════════════════════════════════
//  GET — read stays 'support'
// ══════════════════════════════════════════════════════════════════════

describe('GET /api/super-admin/invoices — read level', () => {
  it('calls authorizeAdmin at the support (default) level, not super_admin', async () => {
    const { GET } = await import('@/app/api/super-admin/invoices/route');
    await GET(req('GET'));

    // GET passes no second arg → defaults to 'support'. Pin that it does NOT
    // request super_admin (which would lock support staff out of the read).
    const secondArg = (authorizeAdmin.mock.calls[0] as unknown[])[1];
    expect(secondArg).not.toBe('super_admin');
  });

  it('returns the authorizeAdmin denial response (403)', async () => {
    const { GET } = await import('@/app/api/super-admin/invoices/route');
    const res = await GET(req('GET'));
    expect(res.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  POST — generate invoice requires super_admin
// ══════════════════════════════════════════════════════════════════════

describe('POST /api/super-admin/invoices — generate level', () => {
  it('returns the denial (403), creates NO invoice and writes NO audit when denied', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/invoices/route');

    const res = await POST(
      req('POST', { school_id: UUID, period_start: '2026-06-01', period_end: '2026-06-30' }),
    );

    expect(res.status).toBe(403);
    // Gate short-circuits before any DB I/O.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('calls authorizeAdmin with super_admin on the authorized path', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // school lookup → student count → create. Sequence canned results.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: UUID, name: 'Test School', subscription_plan: 'standard' }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response('[]', { status: 200, headers: { 'content-range': '0-4/5' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'inv-1', status: 'generated' }]), { status: 201 }),
      );

    const { POST } = await import('@/app/api/super-admin/invoices/route');
    const res = await POST(
      req('POST', { school_id: UUID, period_start: '2026-06-01', period_end: '2026-06-30' }),
    );

    expect(res.status).toBe(201);
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
  });
});

// ══════════════════════════════════════════════════════════════════════
//  PATCH — mark paid requires super_admin
// ══════════════════════════════════════════════════════════════════════

describe('PATCH /api/super-admin/invoices — status-flip level', () => {
  it('returns the denial (403), updates NO invoice and writes NO audit when denied', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { PATCH } = await import('@/app/api/super-admin/invoices/route');

    const res = await PATCH(req('PATCH', { id: UUID, status: 'paid' }));

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('calls authorizeAdmin with super_admin on the authorized path', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // current invoice read (status 'sent') → update.
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: UUID, status: 'sent', school_id: 'school-1' }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: UUID, status: 'paid' }]), { status: 200 }),
      );

    const { PATCH } = await import('@/app/api/super-admin/invoices/route');
    const res = await PATCH(req('PATCH', { id: UUID, status: 'paid' }));

    expect(res.status).toBe(200);
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');
  });
});
