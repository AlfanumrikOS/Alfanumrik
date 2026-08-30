/**
 * CRITICAL AUTH PATH (see src/app/api/auth/session/route.ts's own header).
 * This file adds the FIRST test coverage session/route.ts has ever had.
 *
 * Pins the contract:
 *   POST   — register a device session; fail-open 200 `no_session_yet` when
 *            unauthenticated (2026-05-20 CEO directive — never 401 here);
 *            rate-limited (30/5min per user.id) but ONLY on the authenticated
 *            branch, so the fail-open path is never touched by the limiter
 *            (43654b97 / VULN-D3); enforces the 2-device limit by revoking
 *            the oldest session(s); reuses an already-registered session
 *            cookie instead of creating a duplicate row.
 *   DELETE — logout always returns 200 `logged_out` and clears the cookie,
 *            even on internal error (logout must never fail visibly).
 *   GET    — 401 when unauthenticated; otherwise the caller's own sessions,
 *            flagged with `is_current`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mutable state ─────────────────────────────────────────────────
const holders = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockAdminAuthGetUser: vi.fn(),
}));

const dbState = vi.hoisted(() => ({
  existingSession: null as { id: string; is_active: boolean } | null,
  // Shared "plain select" result — the route only ever reads one such array
  // per request (the active-session count on POST, or the session list on
  // GET), so one field is enough; set it per test.
  selectRows: [] as Array<Record<string, unknown>>,
  insertResult: { id: 'new-session-id' } as { id: string } | null,
  insertError: null as { message: string } | null,
}));

// ── mock: rate limiter ───────────────────────────────────────────────────
const mockRateLimit = vi.fn();
vi.mock('@alfanumrik/lib/api-rate-limit', () => ({
  checkApiRateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));

// ── mock: cookie-based auth (preferred path) ─────────────────────────────
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => holders.mockGetUser() },
  }),
}));

// ── mock: service-role admin client ──────────────────────────────────────
function makeUserActiveSessionsChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'update', 'insert']) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve({ data: dbState.existingSession, error: null });
  chain.single = () => Promise.resolve({ data: dbState.insertResult, error: dbState.insertError });
  // Bare `await` after .eq()/.order()/.limit() with no explicit terminal —
  // real supabase-js query builders are thenable at every step.
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
    resolve({ data: dbState.selectRows, error: null });
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'user_active_sessions') return makeUserActiveSessionsChain();
      // identity_events / auth_audit_log — fire-and-forget inserts.
      return { insert: () => Promise.resolve({ data: null, error: null }) };
    },
    auth: { getUser: (token: string) => holders.mockAdminAuthGetUser(token) },
  })),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST, DELETE, GET } from '@/app/api/auth/session/route';

const MOCK_USER = { id: 'user-uuid-1111' };
const SESSION_COOKIE = 'alfanumrik_sid';

function makeRequest(method: string, opts: { cookie?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  return new NextRequest('http://localhost/api/auth/session', {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function allowRate() {
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetAt: Math.ceil(Date.now() / 1000) + 300 });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.existingSession = null;
  dbState.selectRows = [];
  dbState.insertResult = { id: 'new-session-id' };
  dbState.insertError = null;
  allowRate();
  holders.mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  holders.mockAdminAuthGetUser.mockResolvedValue({ data: { user: null }, error: null });
});

describe('POST /api/auth/session — fail-open unauthenticated path', () => {
  it('returns 200 no_session_yet (never 401) and never calls the rate limiter', async () => {
    const res = await POST(makeRequest('POST'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'no_session_yet', session_id: null });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/session — rate limiting (VULN-D3, authenticated branch only)', () => {
  beforeEach(() => {
    holders.mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  });

  it('returns 429 with Retry-After + X-RateLimit-Remaining when the limiter denies', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Math.ceil(Date.now() / 1000) + 42 });
    const res = await POST(makeRequest('POST'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('keys the limiter by the authenticated user id, not IP', async () => {
    await POST(makeRequest('POST'));
    expect(mockRateLimit).toHaveBeenCalledWith(`session:${MOCK_USER.id}`, 30, 5 * 60 * 1000);
  });
});

describe('POST /api/auth/session — session registration', () => {
  beforeEach(() => {
    holders.mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
  });

  it('reuses an already-registered, still-active session instead of inserting a new one', async () => {
    dbState.existingSession = { id: 'existing-sid', is_active: true };
    const res = await POST(makeRequest('POST', { cookie: 'existing-sid' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ session_id: 'existing-sid', status: 'existing' });
  });

  it('registers a new session and sets the httpOnly cookie when under the device limit', async () => {
    dbState.selectRows = []; // no active sessions yet
    dbState.insertResult = { id: 'brand-new-sid' };
    const res = await POST(makeRequest('POST', { body: { device_label: 'Chrome on Windows' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ session_id: 'brand-new-sid', status: 'registered', sessions_revoked: 0 });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE}=brand-new-sid`);
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('revokes the oldest session(s) when already at the 2-device limit', async () => {
    dbState.selectRows = [
      { id: 'oldest', created_at: '2026-01-01T00:00:00Z', device_label: 'Old Phone' },
      { id: 'newer', created_at: '2026-02-01T00:00:00Z', device_label: 'Laptop' },
    ];
    dbState.insertResult = { id: 'third-device-sid' };
    const res = await POST(makeRequest('POST', { body: { device_label: 'New Phone' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sessions_revoked).toBe(1);
  });

  it('returns 500 when the session insert fails', async () => {
    dbState.insertResult = null;
    dbState.insertError = { message: 'db unavailable' };
    const res = await POST(makeRequest('POST'));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/auth/session — logout', () => {
  it('always returns 200 logged_out and clears the cookie, even when unauthenticated', async () => {
    holders.mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await DELETE(makeRequest('DELETE'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'logged_out' });
  });

  it('never fails visibly even when the auth client throws', async () => {
    holders.mockGetUser.mockRejectedValue(new Error('boom'));
    const res = await DELETE(makeRequest('DELETE', { cookie: 'some-sid' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'logged_out' });
  });
});

describe('GET /api/auth/session — list sessions', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(401);
  });

  it('returns the caller\'s sessions with is_current flagged against the request cookie', async () => {
    holders.mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
    dbState.selectRows = [
      { id: 'sid-a', device_label: 'Phone', created_at: '2026-01-01', last_seen_at: '2026-01-02', is_active: true, ip_address: '1.2.3.4' },
      { id: 'sid-b', device_label: 'Laptop', created_at: '2026-01-03', last_seen_at: '2026-01-04', is_active: true, ip_address: '5.6.7.8' },
    ];
    const res = await GET(makeRequest('GET', { cookie: 'sid-b' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sessions).toHaveLength(2);
    expect(json.sessions.find((s: { id: string }) => s.id === 'sid-b').is_current).toBe(true);
    expect(json.sessions.find((s: { id: string }) => s.id === 'sid-a').is_current).toBe(false);
  });
});
