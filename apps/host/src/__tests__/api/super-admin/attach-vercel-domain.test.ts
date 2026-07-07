/**
 * /api/super-admin/institutions/attach-vercel-domain — endpoint tests.
 *
 * Pins:
 *   - 'attach' action calls attachDomainToProject + audits
 *     `tenant.vercel_domain_attached`.
 *   - 'status' action calls getDomainState (read-only) and does NOT audit.
 *   - VERCEL_NOT_CONFIGURED bubbles up as 503 (so the UI can render a
 *     sticky banner instead of treating it as a transient failure).
 *   - school missing custom_domain → 400.
 *   - Auth gate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── admin-auth + Vercel client mocks ────────────────────────────────
const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();
vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: () => ({ apikey: 'stub', Authorization: 'Bearer stub' }),
}));

const attachDomainToProject = vi.fn();
const getDomainState = vi.fn();
vi.mock('@alfanumrik/lib/vercel/domains', () => ({
  attachDomainToProject: (...args: unknown[]) => attachDomainToProject(...args),
  getDomainState: (...args: unknown[]) => getDomainState(...args),
}));

// ── fetch mock for the schools lookup ──────────────────────────────
let fetchResponses: Array<{ ok: boolean; status: number; body: unknown }> = [];

beforeEach(() => {
  fetchResponses = [];
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  attachDomainToProject.mockReset();
  getDomainState.mockReset();
  authorizeAdmin.mockResolvedValue({
    authorized: true,
    user: { id: 'admin-1' },
    response: undefined,
  });
  logAdminAudit.mockResolvedValue(undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const r = fetchResponses.shift() ?? { ok: true, status: 200, body: [] };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

import { POST } from '@/app/api/super-admin/institutions/attach-vercel-domain/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/institutions/attach-vercel-domain', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const HAPPY_DOMAIN = {
  name: 'learn.dps.com', verified: false, misconfigured: true,
  verification: [{ type: 'TXT', domain: '_vercel.learn.dps.com', value: 'vc-...', reason: 'pending' }],
};

describe('attach-vercel-domain — happy paths', () => {
  it('action=attach calls attachDomainToProject + writes audit', async () => {
    fetchResponses.push({
      ok: true, status: 200,
      body: [{ id: 's1', custom_domain: 'learn.dps.com' }],
    });
    attachDomainToProject.mockResolvedValueOnce({ ok: true, data: HAPPY_DOMAIN });

    const res = await POST(makeRequest({ id: 's1', action: 'attach' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.vercel.name).toBe('learn.dps.com');
    expect(body.vercel.verification).toHaveLength(1);

    expect(attachDomainToProject).toHaveBeenCalledWith('learn.dps.com');
    expect(getDomainState).not.toHaveBeenCalled();
    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'tenant.vercel_domain_attached',
      'school',
      's1',
      expect.objectContaining({ custom_domain: 'learn.dps.com' }),
    );
  });

  it('default action when omitted = attach', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [{ id: 's1', custom_domain: 'x.com' }] });
    attachDomainToProject.mockResolvedValueOnce({ ok: true, data: { ...HAPPY_DOMAIN, name: 'x.com' } });
    await POST(makeRequest({ id: 's1' }));
    expect(attachDomainToProject).toHaveBeenCalled();
    expect(getDomainState).not.toHaveBeenCalled();
  });

  it('action=status calls getDomainState (read-only) and does NOT audit', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [{ id: 's1', custom_domain: 'x.com' }] });
    getDomainState.mockResolvedValueOnce({
      ok: true,
      data: { name: 'x.com', verified: true, verification: [] },
    });

    const res = await POST(makeRequest({ id: 's1', action: 'status' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.vercel.verified).toBe(true);

    expect(getDomainState).toHaveBeenCalledWith('x.com');
    expect(attachDomainToProject).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled(); // status reads are passive
  });
});

describe('attach-vercel-domain — error paths', () => {
  it('VERCEL_NOT_CONFIGURED bubbles up as 503', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [{ id: 's1', custom_domain: 'x.com' }] });
    attachDomainToProject.mockResolvedValueOnce({
      ok: false,
      status: 500,
      code: 'VERCEL_NOT_CONFIGURED',
      error: 'Vercel API not configured (set VERCEL_API_TOKEN and VERCEL_PROJECT_ID).',
    });

    const res = await POST(makeRequest({ id: 's1', action: 'attach' }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe('VERCEL_NOT_CONFIGURED');
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('Vercel API rejection forwards status + code', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [{ id: 's1', custom_domain: 'x.com' }] });
    attachDomainToProject.mockResolvedValueOnce({
      ok: false,
      status: 403,
      code: 'forbidden',
      error: 'Token lacks scope',
    });

    const res = await POST(makeRequest({ id: 's1', action: 'attach' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Token lacks scope');
    expect(body.code).toBe('forbidden');
  });

  it('school not found → 404, no Vercel call', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [] });
    const res = await POST(makeRequest({ id: 'ghost', action: 'attach' }));
    expect(res.status).toBe(404);
    expect(attachDomainToProject).not.toHaveBeenCalled();
  });

  it('school has no custom_domain → 400 with hint to set it first', async () => {
    fetchResponses.push({
      ok: true, status: 200,
      body: [{ id: 's1', custom_domain: null }],
    });
    const res = await POST(makeRequest({ id: 's1', action: 'attach' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no custom_domain/i);
    expect(attachDomainToProject).not.toHaveBeenCalled();
  });

  it('rejects invalid action with 400', async () => {
    const res = await POST(makeRequest({ id: 's1', action: 'wreck-it' }));
    expect(res.status).toBe(400);
    expect(attachDomainToProject).not.toHaveBeenCalled();
  });

  it('rejects missing id with 400', async () => {
    const res = await POST(makeRequest({ action: 'attach' }));
    expect(res.status).toBe(400);
    expect(attachDomainToProject).not.toHaveBeenCalled();
  });
});

describe('Auth gate', () => {
  it('denied → 401, no Vercel call, no audit', async () => {
    const { NextResponse } = await import('next/server');
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await POST(makeRequest({ id: 's1' }));
    expect(res.status).toBe(401);
    expect(attachDomainToProject).not.toHaveBeenCalled();
    expect(getDomainState).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});
