/**
 * POST /api/schools/claim-admin — Phase 1 Track A public claim endpoint.
 *
 * Pins the route contract in src/app/api/schools/claim-admin/route.ts:
 *
 *   - PUBLIC + IP rate-limited (10 / 15 min): a tripped limiter returns 429 with
 *     a Retry-After header and the claim helper is NEVER invoked.
 *   - NON-LEAKY copy: an unknown / malformed token returns a GENERIC message that
 *     does not distinguish "unknown" from "malformed" (no token-existence oracle).
 *   - IDEMPOTENT success: both `claimed` and `already_claimed` return 200 success
 *     so a re-POSTed invite link never dead-ends the principal (P15).
 *   - expired token → 410; unexpected failure → 500 with generic copy.
 *   - P13: the raw token, the password, and any email are never logged.
 *
 * Mock style mirrors the sibling route tests in src/__tests__/api/** — the
 * helper, the rate limiter, and the admin client are all mocked; we assert on the
 * HTTP envelope + whether the helper was reached.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ────────────────────────────────────────────────────────
const { mockRateLimit, mockClaim } = vi.hoisted(() => ({
  mockRateLimit: vi.fn(),
  mockClaim: vi.fn(),
}));

vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ __fake: true }),
}));
vi.mock('@/lib/school-provisioning', () => ({
  claimAdminToken: (...a: unknown[]) => mockClaim(...a),
}));

const loggerCalls: string[] = [];
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (e: string, m: unknown) => loggerCalls.push(JSON.stringify({ e, m })),
    warn: (e: string, m: unknown) => loggerCalls.push(JSON.stringify({ e, m })),
    error: (e: string, m: unknown) => loggerCalls.push(JSON.stringify({ e, m })),
    debug: (e: string, m: unknown) => loggerCalls.push(JSON.stringify({ e, m })),
  },
}));

import { POST } from '@/app/api/schools/claim-admin/route';

const RAW_TOKEN = 'super-secret-claim-token-1234567890';
const SECRET_PW = 'my-new-password-9';

function makeRequest(body: unknown, ip = '203.0.113.7'): NextRequest {
  return new NextRequest('http://localhost/api/schools/claim-admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function allowRate() {
  mockRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: Math.ceil(Date.now() / 1000) + 900,
  });
}

beforeEach(() => {
  loggerCalls.length = 0;
  mockRateLimit.mockReset();
  mockClaim.mockReset();
  allowRate();
});

describe('POST /api/schools/claim-admin — rate limiting', () => {
  it('returns 429 with Retry-After and never calls the claim helper when limited', async () => {
    mockRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Math.ceil(Date.now() / 1000) + 600,
    });
    const res = await POST(makeRequest({ token: RAW_TOKEN }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('rate-limits per IP (the limiter key carries the forwarded IP)', async () => {
    mockClaim.mockResolvedValue({
      status: 'claimed',
      school_id: 's1',
      school_admin_id: 'a1',
      auth_user_id: 'u1',
    });
    await POST(makeRequest({ token: RAW_TOKEN }, '198.51.100.5'));
    const key = String(mockRateLimit.mock.calls[0][0]);
    expect(key).toContain('198.51.100.5');
  });
});

describe('POST /api/schools/claim-admin — non-leaky responses', () => {
  it('invalid_token → 400 with generic copy that does not reveal existence', async () => {
    mockClaim.mockResolvedValue({ status: 'invalid_token' });
    const res = await POST(makeRequest({ token: RAW_TOKEN }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    // Generic — must not say "not found" / "unknown" / "already used" etc.
    expect(body.error).toMatch(/invalid/i);
    expect(body.error).not.toMatch(/not found|unknown|does not exist|already/i);
  });

  it('expired token → 410 with a re-issue hint (still no existence leak)', async () => {
    mockClaim.mockResolvedValue({ status: 'expired' });
    const res = await POST(makeRequest({ token: RAW_TOKEN }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/expired/i);
  });

  it('a missing token is rejected with 400 before the helper runs', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('an out-of-range password is rejected with 400 without echoing the value', async () => {
    const res = await POST(makeRequest({ token: RAW_TOKEN, password: 'short' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('short');
    expect(mockClaim).not.toHaveBeenCalled();
  });
});

describe('POST /api/schools/claim-admin — idempotent success (P15)', () => {
  it('claimed → 200 success with the school + admin ids', async () => {
    mockClaim.mockResolvedValue({
      status: 'claimed',
      school_id: 'school-1',
      school_admin_id: 'admin-1',
      auth_user_id: 'user-1',
      // DELTA: the helper now threads the REAL GoTrue password outcome; the route
      // surfaces it verbatim. A genuine success → password_set true.
      password_set: true,
    });
    const res = await POST(makeRequest({ token: RAW_TOKEN, password: SECRET_PW }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('claimed');
    expect(body.data.school_id).toBe('school-1');
    expect(body.data.password_set).toBe(true);
  });

  it('already_claimed → 200 success (replayed link never 4xxs the principal)', async () => {
    mockClaim.mockResolvedValue({
      status: 'already_claimed',
      school_id: 'school-1',
      school_admin_id: 'admin-1',
      auth_user_id: 'user-1',
    });
    const res = await POST(makeRequest({ token: RAW_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('already_claimed');
  });

  it('failed → 500 with generic copy', async () => {
    mockClaim.mockResolvedValue({ status: 'failed', error: 'Unexpected claim error.' });
    const res = await POST(makeRequest({ token: RAW_TOKEN }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/could not complete/i);
  });
});

describe('POST /api/schools/claim-admin — password_set accuracy (DELTA, P15 best-effort)', () => {
  it('claimed with a genuine GoTrue success → password_set: true (link active either way)', async () => {
    mockClaim.mockResolvedValue({
      status: 'claimed',
      school_id: 'school-1',
      school_admin_id: 'admin-1',
      auth_user_id: 'user-1',
      password_set: true,
    });
    const res = await POST(makeRequest({ token: RAW_TOKEN, password: SECRET_PW }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The claim succeeded — the link is activated regardless of the password.
    expect(body.data.status).toBe('claimed');
    expect(body.data.password_set).toBe(true);
  });

  it('claimed but GoTrue password update FAILED → password_set: false, still 200/claimed', async () => {
    // The helper reports a genuine failure (best-effort password set lost) while
    // still activating the link — P15: a password failure must NOT block activation.
    mockClaim.mockResolvedValue({
      status: 'claimed',
      school_id: 'school-1',
      school_admin_id: 'admin-1',
      auth_user_id: 'user-1',
      password_set: false,
    });
    const res = await POST(makeRequest({ token: RAW_TOKEN, password: SECRET_PW }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('claimed');
    // The route surfaces the REAL outcome so the client can prompt reset-password.
    expect(body.data.password_set).toBe(false);
  });

  it('already_claimed never re-reports a password set (no stranger re-activation)', async () => {
    mockClaim.mockResolvedValue({
      status: 'already_claimed',
      school_id: 'school-1',
      school_admin_id: 'admin-1',
      auth_user_id: 'user-1',
    });
    const res = await POST(makeRequest({ token: RAW_TOKEN, password: SECRET_PW }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The result type for already_claimed carries no password_set; the route
    // coerces the display to false (the && short-circuits on status).
    expect(body.data.password_set).toBe(false);
  });
});

describe('POST /api/schools/claim-admin — P13 no-PII logging', () => {
  it('never logs the raw token or the password (claimed path)', async () => {
    mockClaim.mockResolvedValue({
      status: 'claimed',
      school_id: 'school-1',
      school_admin_id: 'admin-1',
      auth_user_id: 'user-1',
    });
    await POST(makeRequest({ token: RAW_TOKEN, password: SECRET_PW }));
    const all = loggerCalls.join('\n');
    expect(all).not.toContain(RAW_TOKEN);
    expect(all).not.toContain(SECRET_PW);
  });

  it('never logs the raw token or the password on the failure path', async () => {
    mockClaim.mockResolvedValue({ status: 'failed', error: 'Unexpected claim error.' });
    await POST(makeRequest({ token: RAW_TOKEN, password: SECRET_PW }));
    const all = loggerCalls.join('\n');
    expect(all).not.toContain(RAW_TOKEN);
    expect(all).not.toContain(SECRET_PW);
  });
});
