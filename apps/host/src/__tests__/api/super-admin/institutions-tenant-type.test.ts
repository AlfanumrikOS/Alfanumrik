/**
 * /api/super-admin/institutions — tenant_type extension tests.
 *
 * Pins the contract added in this PR:
 *
 *   - PATCH accepts `tenant_type` ∈ { school, coaching, corporate, government }.
 *   - Invalid tenant_type → 400 with no DB write.
 *   - Audit log records action `tenant.type_changed` for tenant_type updates,
 *     `school.updated` / `school.suspended` / `school.activated` for the
 *     other paths (regression guard).
 *   - GET select string includes the Phase B + custom_domain fields so the
 *     super-admin UI can render them.
 *
 * Mocking style mirrors src/__tests__/api/super-admin/plan-change-atomicity.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Module mocks (hoisted before route import) ────────────────────────

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  // Real impl just builds a URL string; the test asserts the substring
  // that proves the new fields are in the select.
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: (extra?: string) => ({
    apikey: 'stub',
    Authorization: 'Bearer stub',
    ...(extra ? { Prefer: extra } : {}),
  }),
}));

import { GET, PATCH } from '@/app/api/super-admin/institutions/route';

// ── fetch mock — captures URLs + bodies, returns canned responses ────

interface FetchCall { url: string; init: RequestInit | undefined; }
let fetchCalls: FetchCall[] = [];
let fetchResponse: { ok: boolean; status: number; bodyJson?: unknown; bodyText?: string; contentRange?: string } = {
  ok: true, status: 200, bodyJson: [],
};

beforeEach(() => {
  fetchCalls = [];
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();
  authorizeAdmin.mockResolvedValue({
    authorized: true,
    user: { id: 'admin-1' },
    response: undefined,
  });
  logAdminAudit.mockResolvedValue(undefined);

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    fetchCalls.push({ url, init });
    const headers = new Headers();
    if (fetchResponse.contentRange) headers.set('content-range', fetchResponse.contentRange);
    return new Response(
      fetchResponse.bodyText ?? JSON.stringify(fetchResponse.bodyJson ?? []),
      { status: fetchResponse.status, headers },
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(method: 'GET' | 'PATCH', body?: unknown, query?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/super-admin/institutions${query ? `?${query}` : ''}`,
    {
      method,
      body: body !== undefined ? JSON.stringify(body) : null,
      headers: { 'content-type': 'application/json' },
    },
  );
}

// ── GET ──────────────────────────────────────────────────────────────

describe('GET /api/super-admin/institutions', () => {
  it('select string includes tenant_type, font_heading, font_body, border_radius_px, custom_domain, domain_verified, slug', async () => {
    fetchResponse = { ok: true, status: 200, bodyJson: [], contentRange: '0-0/0' };
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);

    expect(fetchCalls).toHaveLength(1);
    const url = fetchCalls[0].url;
    // Each new field must appear in the select param.
    expect(url).toMatch(/select=[^&]*tenant_type/);
    expect(url).toMatch(/select=[^&]*font_heading/);
    expect(url).toMatch(/select=[^&]*font_body/);
    expect(url).toMatch(/select=[^&]*border_radius_px/);
    expect(url).toMatch(/select=[^&]*custom_domain/);
    expect(url).toMatch(/select=[^&]*domain_verified/);
    expect(url).toMatch(/select=[^&]*slug/);
  });
});

// ── PATCH ────────────────────────────────────────────────────────────

describe('PATCH /api/super-admin/institutions — tenant_type', () => {
  it.each(['school', 'coaching', 'corporate', 'government'] as const)(
    'accepts tenant_type=%s and logs the tenant.type_changed audit action',
    async (type) => {
      fetchResponse = { ok: true, status: 200, bodyJson: [{ id: 's1', tenant_type: type }] };
      const res = await PATCH(makeRequest('PATCH', {
        id: 's1',
        updates: { tenant_type: type },
      }));
      expect(res.status).toBe(200);

      // The PATCH HTTP must have been issued with a body that includes
      // tenant_type (and not the disallowed font/border fields).
      const upsert = fetchCalls.find(c => c.init?.method === 'PATCH');
      expect(upsert).toBeTruthy();
      const body = JSON.parse(String(upsert!.init!.body));
      expect(body.tenant_type).toBe(type);
      expect(body).not.toHaveProperty('font_heading');
      expect(body).not.toHaveProperty('border_radius_px');

      // Audit log fired with the dedicated action label.
      expect(logAdminAudit).toHaveBeenCalledTimes(1);
      const call = logAdminAudit.mock.calls[0];
      expect(call[1]).toBe('tenant.type_changed');
      expect(call[2]).toBe('school');
      expect(call[3]).toBe('s1');
    },
  );

  it('rejects an invalid tenant_type with 400 and NO upstream call', async () => {
    const res = await PATCH(makeRequest('PATCH', {
      id: 's1',
      updates: { tenant_type: 'monastery' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/tenant_type/);
    expect(fetchCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('rejects a non-string tenant_type with 400', async () => {
    const res = await PATCH(makeRequest('PATCH', {
      id: 's1',
      updates: { tenant_type: 42 },
    }));
    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it('PATCH with no tenant_type still uses school.updated audit action (regression guard)', async () => {
    fetchResponse = { ok: true, status: 200, bodyJson: [{ id: 's1' }] };
    const res = await PATCH(makeRequest('PATCH', {
      id: 's1',
      updates: { city: 'Lucknow' },
    }));
    expect(res.status).toBe(200);
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    expect(logAdminAudit.mock.calls[0][1]).toBe('school.updated');
  });

  it('PATCH with is_active=false uses school.suspended (regression guard)', async () => {
    fetchResponse = { ok: true, status: 200, bodyJson: [{ id: 's1' }] };
    await PATCH(makeRequest('PATCH', { id: 's1', updates: { is_active: false } }));
    expect(logAdminAudit.mock.calls[0][1]).toBe('school.suspended');
  });

  it('PATCH with both tenant_type and is_active prefers tenant.type_changed (more specific)', async () => {
    fetchResponse = { ok: true, status: 200, bodyJson: [{ id: 's1' }] };
    await PATCH(makeRequest('PATCH', {
      id: 's1',
      updates: { tenant_type: 'corporate', is_active: false },
    }));
    expect(logAdminAudit.mock.calls[0][1]).toBe('tenant.type_changed');
  });
});

describe('PATCH auth gate (regression guard)', () => {
  it('returns 401 when authorizeAdmin denies and never touches supabase', async () => {
    const { NextResponse } = await import('next/server');
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await PATCH(makeRequest('PATCH', {
      id: 's1', updates: { tenant_type: 'coaching' },
    }));
    expect(res.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});
