/**
 * Phase E custom-domain endpoint tests.
 *
 * Pins:
 *   - PATCH /institutions accepts `custom_domain` in updates; resets
 *     domain_verified=false on every set; null clears the field;
 *     malformed domain → 400.
 *   - PATCH audit action `tenant.custom_domain_changed` for domain changes
 *     (more specific than tenant.type_changed and school.updated).
 *   - POST /verify-domain runs the DNS TXT lookup and flips
 *     domain_verified=true ONLY when the expected token appears.
 *   - 404 / DNS-fail / token-mismatch all return 200 with verified=false
 *     (NOT 5xx — these are user-facing diagnostics).
 *   - Auth gate on both endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── admin-auth + dns mocks ───────────────────────────────────────────
const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();
vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: () => ({ apikey: 'stub', Authorization: 'Bearer stub' }),
}));

// vi.hoisted ensures `resolveTxtMock` is initialised before vi.mock factory
// runs (vi.mock is hoisted to the top of the file at transform time).
const { resolveTxtMock } = vi.hoisted(() => ({ resolveTxtMock: vi.fn() }));
vi.mock('node:dns/promises', () => ({
  default: { resolveTxt: resolveTxtMock },
  resolveTxt: resolveTxtMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── fetch mock — captures HTTP traffic for the schools table ─────────
interface FetchCall { url: string; init: RequestInit | undefined; }
let fetchCalls: FetchCall[] = [];
let fetchResponses: Array<{ ok: boolean; status: number; body: unknown }> = [];

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  resolveTxtMock.mockReset();

  authorizeAdmin.mockResolvedValue({
    authorized: true,
    user: { id: 'admin-1' },
    response: undefined,
  });
  logAdminAudit.mockResolvedValue(undefined);

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    fetchCalls.push({ url, init });
    const r = fetchResponses.shift() ?? { ok: true, status: 200, body: [] };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

import { PATCH } from '@/app/api/super-admin/institutions/route';
import { POST as VerifyDomain } from '@/app/api/super-admin/institutions/verify-domain/route';

function makeRequest(method: 'PATCH' | 'POST', path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

// ── PATCH custom_domain ─────────────────────────────────────────────

describe('PATCH /api/super-admin/institutions — custom_domain', () => {
  it('accepts a valid domain, resets domain_verified=false, audit action tenant.custom_domain_changed', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [{ id: 's1', custom_domain: 'learn.dps.com' }] });
    const res = await PATCH(makeRequest('PATCH', '/api/super-admin/institutions', {
      id: 's1',
      updates: { custom_domain: 'learn.dps.com' },
    }));
    expect(res.status).toBe(200);

    const upsert = fetchCalls.find(c => c.init?.method === 'PATCH');
    expect(upsert).toBeTruthy();
    const patch = JSON.parse(String(upsert!.init!.body));
    expect(patch.custom_domain).toBe('learn.dps.com');
    expect(patch.domain_verified).toBe(false); // ALWAYS reset on a domain change

    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'tenant.custom_domain_changed',
      'school',
      's1',
      expect.anything(),
    );
  });

  it('lowercases + trims the domain before persisting', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [{ id: 's1' }] });
    await PATCH(makeRequest('PATCH', '/api/super-admin/institutions', {
      id: 's1',
      updates: { custom_domain: '  Learn.DPS.com  ' },
    }));
    const upsert = fetchCalls.find(c => c.init?.method === 'PATCH');
    const patch = JSON.parse(String(upsert!.init!.body));
    expect(patch.custom_domain).toBe('learn.dps.com');
  });

  it('null clears the field AND resets domain_verified', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [{ id: 's1' }] });
    await PATCH(makeRequest('PATCH', '/api/super-admin/institutions', {
      id: 's1',
      updates: { custom_domain: null },
    }));
    const upsert = fetchCalls.find(c => c.init?.method === 'PATCH');
    const patch = JSON.parse(String(upsert!.init!.body));
    expect(patch.custom_domain).toBeNull();
    expect(patch.domain_verified).toBe(false);
  });

  // Note: 'learn.dps' is intentionally NOT rejected — short TLDs like
  // ".dps" are RFC-permissible (think internal-use / new-gTLD). The DB
  // partial index handles disambiguation; we don't bake hostname-suffix
  // policy into the API. Test only the SHAPE-broken cases.
  it.each([
    'not-a-domain',
    'http://learn.dps.com',
    'learn.dps.com/path',
    '.com',
    'a..b.com',
    '',
  ])('rejects malformed domain "%s"', async (value) => {
    const res = await PATCH(makeRequest('PATCH', '/api/super-admin/institutions', {
      id: 's1',
      updates: { custom_domain: value },
    }));
    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('non-string non-null custom_domain → 400', async () => {
    const res = await PATCH(makeRequest('PATCH', '/api/super-admin/institutions', {
      id: 's1',
      updates: { custom_domain: 42 },
    }));
    expect(res.status).toBe(400);
  });
});

// ── POST verify-domain ──────────────────────────────────────────────

describe('POST /api/super-admin/institutions/verify-domain', () => {
  it('flips domain_verified=true when expected TXT token is present', async () => {
    // 1st fetch: school lookup
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: 's1', custom_domain: 'learn.dps.com', domain_verified: false }],
    });
    // 2nd fetch: PATCH update domain_verified=true
    fetchResponses.push({ ok: true, status: 200, body: [{ id: 's1', domain_verified: true }] });

    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-s1']]);

    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', { id: 's1' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.verified).toBe(true);
    expect(body.expectedToken).toBe('alfanumrik-verify-s1');
    expect(body.expectedRecord).toBe('_alfanumrik-verify.learn.dps.com');

    // Update PATCH was issued.
    const updates = fetchCalls.filter(c => c.init?.method === 'PATCH');
    expect(updates).toHaveLength(1);
    const patch = JSON.parse(String(updates[0].init!.body));
    expect(patch.domain_verified).toBe(true);

    // Audit recorded.
    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'tenant.custom_domain_verified',
      'school',
      's1',
      expect.anything(),
    );
  });

  it('returns verified=false (200, NOT 5xx) when DNS lookup throws', async () => {
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: 's1', custom_domain: 'learn.dps.com', domain_verified: false }],
    });
    const dnsErr = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    resolveTxtMock.mockRejectedValueOnce(dnsErr);

    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', { id: 's1' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.verified).toBe(false);
    expect(body.message).toMatch(/_alfanumrik-verify\.learn\.dps\.com/);

    expect(logAdminAudit).not.toHaveBeenCalled();
    // No PATCH call.
    expect(fetchCalls.filter(c => c.init?.method === 'PATCH')).toHaveLength(0);
  });

  it('returns verified=false when TXT exists but token does not match', async () => {
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: 's1', custom_domain: 'learn.dps.com', domain_verified: false }],
    });
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-WRONG-id']]);

    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', { id: 's1' }));
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.message).toMatch(/none match/);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('handles multi-chunk TXT records (concatenates parts)', async () => {
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: 's1', custom_domain: 'learn.dps.com', domain_verified: false }],
    });
    fetchResponses.push({ ok: true, status: 200, body: [] });
    // resolveTxt returns string[][] — split chunks must be concatenated.
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-', 's1']]);

    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', { id: 's1' }));
    const body = await res.json();
    expect(body.verified).toBe(true);
  });

  it('school not found → 404', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [] });
    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', { id: 'ghost' }));
    expect(res.status).toBe(404);
  });

  it('skips re-verifying when already verified (idempotent — no PATCH, no audit)', async () => {
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: 's1', custom_domain: 'learn.dps.com', domain_verified: true }],
    });
    resolveTxtMock.mockResolvedValueOnce([['alfanumrik-verify-s1']]);

    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', { id: 's1' }));
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.message).toBe('Already verified.');
    expect(fetchCalls.filter(c => c.init?.method === 'PATCH')).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('school with no custom_domain set returns instructions, no DNS call', async () => {
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: 's1', custom_domain: null, domain_verified: false }],
    });
    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', { id: 's1' }));
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.message).toMatch(/No custom domain set/);
    expect(resolveTxtMock).not.toHaveBeenCalled();
  });

  it('rejects missing id with 400', async () => {
    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', {}));
    expect(res.status).toBe(400);
  });
});

describe('Auth gate', () => {
  it('PATCH denied → 401, no DB ops', async () => {
    const { NextResponse } = await import('next/server');
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await PATCH(makeRequest('PATCH', '/api/super-admin/institutions', {
      id: 's1', updates: { custom_domain: 'learn.dps.com' },
    }));
    expect(res.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
  });

  it('verify-domain denied → 401, no DNS call', async () => {
    const { NextResponse } = await import('next/server');
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await VerifyDomain(makeRequest('POST', '/api/super-admin/institutions/verify-domain', { id: 's1' }));
    expect(res.status).toBe(401);
    expect(resolveTxtMock).not.toHaveBeenCalled();
  });
});
