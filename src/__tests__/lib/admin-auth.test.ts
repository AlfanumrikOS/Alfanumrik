/**
 * admin-auth.ts — unit tests.
 *
 * Server-side admin authorization. Two modes:
 *   1. Session-based (authorizeAdmin) — used by /api/super-admin/*
 *   2. Secret-based (requireAdminSecret) — used by /api/internal/admin/*
 *
 * Plus low-level helpers: isValidUUID, supabaseAdminUrl, supabaseAdminHeaders,
 * logAdminAudit, logAdminAction.
 *
 * We test:
 *   - requireAdminSecret: 503 when SUPER_ADMIN_SECRET unset, 401 when wrong/missing
 *     header, null (auth OK) when matching
 *   - isValidUUID: valid v4 → true, garbage / wrong length → false
 *   - supabaseAdminUrl: builds REST URL with and without params; throws when
 *     NEXT_PUBLIC_SUPABASE_URL is missing
 *   - supabaseAdminHeaders: includes apikey, Authorization, Prefer; throws
 *     when SERVICE_ROLE_KEY is missing
 *   - authorizeAdmin: 500 when env vars missing, 401 when no token, 401 on
 *     GoTrue failure, 401 when /auth/v1/user has no id, 403 when admin lookup
 *     returns empty (after fallback), 200 happy path with Bearer token,
 *     fallback path when service role returns empty but user-token retry
 *     succeeds, 500 on admin_users HTTP failure, 500 on uncaught throw
 *   - logAdminAction: silently succeeds; never throws on Supabase errors
 *   - logAdminAudit: no-op when env missing; sends POST when configured
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock supabase-admin (logAdminAction uses it) ─────────────

const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({ insert: mockInsert }));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({ from: mockFrom })),
}));

// ── Mock logger so error paths don't pollute output ──────────

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  requireAdminSecret,
  isValidUUID,
  supabaseAdminUrl,
  supabaseAdminHeaders,
  logAdminAction,
  logAdminAudit,
  authorizeAdmin,
  type AdminAuth,
} from '@/lib/admin-auth';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Reset env each test
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ─── isValidUUID ──────────────────────────────────────────────

describe('isValidUUID', () => {
  it('accepts a canonical UUID v4 string', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts upper-case hex digits', () => {
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });

  it('rejects strings with the wrong segment length', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440')).toBe(false);
  });

  it('rejects strings with non-hex characters', () => {
    expect(isValidUUID('zzzzzzzz-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('rejects bare strings missing dashes', () => {
    expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
  });
});

// ─── supabaseAdminUrl ────────────────────────────────────────

describe('supabaseAdminUrl', () => {
  it('builds a REST URL with no query params', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    expect(supabaseAdminUrl('admin_users')).toBe('https://test.supabase.co/rest/v1/admin_users');
  });

  it('appends params with a leading ? when provided', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    expect(supabaseAdminUrl('admin_users', 'select=*&limit=1')).toBe(
      'https://test.supabase.co/rest/v1/admin_users?select=*&limit=1',
    );
  });

  it('throws when NEXT_PUBLIC_SUPABASE_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => supabaseAdminUrl('admin_users')).toThrow(/Supabase URL not configured/);
  });
});

// ─── supabaseAdminHeaders ────────────────────────────────────

describe('supabaseAdminHeaders', () => {
  it('returns headers with apikey, Authorization, Content-Type, and default Prefer', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-key';
    const h = supabaseAdminHeaders();
    expect(h.apikey).toBe('svc-role-key');
    expect(h.Authorization).toBe('Bearer svc-role-key');
    expect(h['Content-Type']).toBe('application/json');
    expect(h.Prefer).toBe('count=exact');
  });

  it('respects custom Prefer override', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role-key';
    const h = supabaseAdminHeaders('return=representation');
    expect(h.Prefer).toBe('return=representation');
  });

  it('throws when SERVICE_ROLE_KEY is unset', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => supabaseAdminHeaders()).toThrow(/Service role key not configured/);
  });
});

// ─── requireAdminSecret ──────────────────────────────────────

describe('requireAdminSecret', () => {
  function reqWith(headers: Record<string, string>): NextRequest {
    return new NextRequest('https://example.com/api/internal/admin/anything', { headers });
  }

  it('returns 503 when SUPER_ADMIN_SECRET is not configured', async () => {
    delete process.env.SUPER_ADMIN_SECRET;
    const r = requireAdminSecret(reqWith({}));
    expect(r).not.toBeNull();
    expect(r?.status).toBe(503);
    const body = await r!.json();
    expect(body.error).toBe('Admin not configured');
  });

  it('returns 401 when header is missing', async () => {
    process.env.SUPER_ADMIN_SECRET = 'expected-secret';
    const r = requireAdminSecret(reqWith({}));
    expect(r?.status).toBe(401);
    const body = await r!.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when header is wrong', async () => {
    process.env.SUPER_ADMIN_SECRET = 'expected-secret';
    const r = requireAdminSecret(reqWith({ 'x-admin-secret': 'wrong' }));
    expect(r?.status).toBe(401);
  });

  it('returns null (auth OK) when secret matches', () => {
    process.env.SUPER_ADMIN_SECRET = 'expected-secret';
    expect(requireAdminSecret(reqWith({ 'x-admin-secret': 'expected-secret' }))).toBeNull();
  });
});

// ─── logAdminAction ──────────────────────────────────────────

describe('logAdminAction', () => {
  it('inserts an audit row with normalized null defaults', async () => {
    mockInsert.mockResolvedValueOnce({ data: null, error: null });

    await logAdminAction({
      action: 'flag.toggle',
      entity_type: 'feature_flag',
      entity_id: 'ff-123',
      details: { from: false, to: true },
      ip: '127.0.0.1',
    });

    expect(mockFrom).toHaveBeenCalledWith('admin_audit_log');
    expect(mockInsert).toHaveBeenCalledWith({
      admin_id: null,
      action: 'flag.toggle',
      entity_type: 'feature_flag',
      entity_id: 'ff-123',
      details: { from: false, to: true },
      ip_address: '127.0.0.1',
    });
  });

  it('uses null for entity_id, empty {} for details, null for ip when omitted', async () => {
    mockInsert.mockResolvedValueOnce({ data: null, error: null });

    await logAdminAction({ action: 'a', entity_type: 't' });

    expect(mockInsert).toHaveBeenCalledWith({
      admin_id: null,
      action: 'a',
      entity_type: 't',
      entity_id: null,
      details: {},
      ip_address: null,
    });
  });

  it('never throws even when the Supabase insert blows up', async () => {
    mockInsert.mockRejectedValueOnce(new Error('db down'));
    await expect(
      logAdminAction({ action: 'a', entity_type: 't' }),
    ).resolves.toBeUndefined();
  });
});

// ─── logAdminAudit (super-admin path; sends a POST via fetch) ─────

describe('logAdminAudit', () => {
  const admin: AdminAuth = {
    authorized: true,
    userId: 'u-1',
    adminId: 'a-1',
    email: 'admin@x.com',
    name: 'Admin',
    adminLevel: 'super',
  };

  it('is a no-op when env config is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await logAdminAudit(admin, 'flag.toggle', 'feature_flag', 'ff-1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to /rest/v1/admin_audit_log with admin metadata in details', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 201 }),
    );

    await logAdminAudit(admin, 'flag.toggle', 'feature_flag', 'ff-1', { x: 1 }, '203.0.113.1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://test.supabase.co/rest/v1/admin_audit_log');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '{}');
    expect(body.action).toBe('flag.toggle');
    expect(body.details).toMatchObject({
      x: 1,
      admin_name: 'Admin',
      admin_email: 'admin@x.com',
      admin_level: 'super',
    });
    expect(body.ip_address).toBe('203.0.113.1');
    fetchSpy.mockRestore();
  });

  it('swallows fetch errors silently', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(
      logAdminAudit(admin, 'a', 't', 'id'),
    ).resolves.toBeUndefined();
  });
});

// ─── authorizeAdmin (most code in admin-auth.ts) ─────────────

describe('authorizeAdmin', () => {
  function reqWith(headers: Record<string, string>): NextRequest {
    return new NextRequest('https://example.com/api/super-admin/foo', { headers });
  }

  it('returns 500 when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    const r = await authorizeAdmin(reqWith({}));
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(500);
    }
  });

  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const r = await authorizeAdmin(reqWith({}));
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(500);
    }
  });

  it('returns 401 ADMIN_NO_TOKEN when no Authorization header and no auth cookie', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    const r = await authorizeAdmin(reqWith({}));
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(401);
      const body = await r.response.json();
      expect(body.code).toBe('ADMIN_NO_TOKEN');
    }
  });

  it('returns 401 ADMIN_SESSION_EXPIRED when GoTrue rejects the token', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('expired', { status: 401 }),
    );

    const r = await authorizeAdmin(reqWith({ Authorization: 'Bearer bad-token' }));
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(401);
      const body = await r.response.json();
      expect(body.code).toBe('ADMIN_SESSION_EXPIRED');
    }
  });

  it('returns 401 ADMIN_INVALID_SESSION when GoTrue returns no id', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ /* no id */ }), { status: 200 }),
    );

    const r = await authorizeAdmin(reqWith({ Authorization: 'Bearer fake' }));
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      const body = await r.response.json();
      expect(body.code).toBe('ADMIN_INVALID_SESSION');
    }
  });

  it('returns 500 ADMIN_LOOKUP_FAILED when admin_users HTTP query fails', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u-1', email: 'a@x.com' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));

    const r = await authorizeAdmin(reqWith({ Authorization: 'Bearer good' }));
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(500);
      const body = await r.response.json();
      expect(body.code).toBe('ADMIN_LOOKUP_FAILED');
    }
  });

  it('returns 403 ADMIN_NOT_FOUND when no admin row is found (and fallback also empty)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    vi.spyOn(globalThis, 'fetch')
      // GoTrue user
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u-1', email: 'a@x.com' }), { status: 200 }))
      // Service role lookup → empty
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      // Fallback retry with user token → also empty
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const r = await authorizeAdmin(reqWith({ Authorization: 'Bearer good' }));
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(403);
      const body = await r.response.json();
      expect(body.code).toBe('ADMIN_NOT_FOUND');
    }
  });

  it('returns authorized=true with admin metadata on the happy path', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u-1', email: 'a@x.com' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'admin-id-1', name: 'Alice', email: 'admin@x.com', admin_level: 'super',
      }]), { status: 200 }));

    const r = await authorizeAdmin(reqWith({ Authorization: 'Bearer good' }));
    expect(r.authorized).toBe(true);
    if (r.authorized) {
      expect(r.userId).toBe('u-1');
      expect(r.adminId).toBe('admin-id-1');
      expect(r.email).toBe('admin@x.com');
      expect(r.name).toBe('Alice');
      expect(r.adminLevel).toBe('super');
    }
  });

  it('falls back to user-token retry when service role returns empty', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    vi.spyOn(globalThis, 'fetch')
      // GoTrue
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u-2' }), { status: 200 }))
      // Service role: empty
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      // Fallback retry: returns the admin row
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'admin-2', name: 'Bob', email: 'bob@x.com', admin_level: 'standard',
      }]), { status: 200 }));

    const r = await authorizeAdmin(reqWith({ Authorization: 'Bearer good' }));
    expect(r.authorized).toBe(true);
    if (r.authorized) {
      expect(r.adminId).toBe('admin-2');
      expect(r.name).toBe('Bob');
    }
  });

  it('returns 500 ADMIN_AUTH_EXCEPTION when fetch throws unexpectedly', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network gone'));

    const r = await authorizeAdmin(reqWith({ Authorization: 'Bearer good' }));
    expect(r.authorized).toBe(false);
    if (!r.authorized) {
      expect(r.response.status).toBe(500);
      const body = await r.response.json();
      expect(body.code).toBe('ADMIN_AUTH_EXCEPTION');
    }
  });

  it('extracts the access token from a sb-* auth cookie when no Bearer header is set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';

    const cookieValue = encodeURIComponent(
      JSON.stringify({ access_token: 'cookie-token', token_type: 'bearer' }),
    );
    const cookie = `sb-test-auth-token=${cookieValue}`;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u-3', email: 'c@x.com' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 'admin-3', name: 'Cam', email: 'c@x.com', admin_level: 'super',
      }]), { status: 200 }));

    const r = await authorizeAdmin(reqWith({ Cookie: cookie }));
    expect(r.authorized).toBe(true);
  });
});
