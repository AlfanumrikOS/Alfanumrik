/**
 * Tests for OAuth2 authorization and token endpoints.
 *
 * Covers:
 *   GET  /api/oauth/authorize — validates auth request params, returns app/scope info
 *   POST /api/oauth/token     — authorization_code and refresh_token grants
 *
 * Both routes use getSupabaseAdmin() (service role, NOT the server client).
 * The token route uses secureEqual from @/lib/secure-compare for constant-time
 * secret comparison.
 *
 * authorize:
 *   1. Missing required param       → 400 invalid_request
 *   2. Unknown client_id            → 400 invalid_client
 *   3. Redirect URI mismatch        → 400 invalid_redirect_uri
 *   4. Valid request                → 200 with app info + scope details
 *
 * token:
 *   1. Missing grant_type           → 400 invalid_request
 *   2. Unsupported grant_type       → 400 unsupported_grant_type
 *   3. Invalid authorization code   → 400 invalid_grant
 *   4. Valid authorization_code     → 400 invalid_grant (consent screen not yet built)
 *   5. Valid refresh_token grant    → 200 with access_token, refresh_token, token_type, expires_in
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mutable holders ───────────────────────────────────────────────────
const holders = vi.hoisted(() => ({
  // Controlled per test — returns the chainable supabase admin query builder.
  mockFrom: vi.fn(),
  // secureEqual: default impl is identity comparison (a === b).
  mockSecureEqual: vi.fn((a: string, b: string) => a === b),
}));

// ── mock: supabase-admin ──────────────────────────────────────────────────────
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: (...args: unknown[]) => holders.mockFrom(...args),
  })),
  supabaseAdmin: { from: (...args: unknown[]) => holders.mockFrom(...args) },
}));

// ── mock: secure-compare ─────────────────────────────────────────────────────
vi.mock('@/lib/secure-compare', () => ({
  secureEqual: (a: string, b: string) => holders.mockSecureEqual(a, b),
}));

// ── mock: logger ──────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── lazy imports after mocks ──────────────────────────────────────────────────
import { GET  } from '@/app/api/oauth/authorize/route';
import { POST } from '@/app/api/oauth/token/route';

// ── constants ─────────────────────────────────────────────────────────────────
const CLIENT_ID       = 'test-client-id';
const APP_ID          = 'app-uuid-1111-1111-1111-111111111111';
const SCHOOL_ID       = 'school-uuid-2222-2222-2222-222222222222';
const REDIRECT_URI    = 'https://example.com/oauth/callback';
const SCOPE           = 'student.read';
const CLIENT_SECRET   = 'valid-secret';
// SHA-256('valid-secret') in hex — used as the stored hash.
// The mock secureEqual simply does `a === b` so we just need to supply the
// same value for both provided and stored, which is handled via the mock.
const SECRET_HASH     = 'sha256-of-valid-secret';

/** Approved, active OAuth app returned by the DB mock. */
const MOCK_APP = {
  id: APP_ID,
  name: 'Test App',
  description: 'An integration test app',
  logo_url: null,
  homepage_url: 'https://example.com',
  privacy_policy_url: 'https://example.com/privacy',
  redirect_uris: [REDIRECT_URI],
  requested_scopes: [SCOPE],
  app_type: 'confidential',
  review_status: 'approved',
  is_active: true,
  client_secret_hash: SECRET_HASH,
};

/** Active scope record returned by the DB mock. */
const MOCK_SCOPE = {
  code: SCOPE,
  display_name: 'Read student data',
  display_name_hi: 'छात्र डेटा पढ़ें',
  description: 'Read-only access to student profile',
  risk_level: 'low',
  is_active: true,
};

const MOCK_SCHOOL = { id: SCHOOL_ID, name: 'Test School', logo_url: null };

// ── Request builders ──────────────────────────────────────────────────────────

function authorizeUrl(overrides: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    school_id: SCHOOL_ID,
    response_type: 'code',
    ...overrides,
  });
  // Remove explicitly undefined keys
  for (const [key, val] of [...params.entries()]) {
    if (val === undefined || val === 'undefined') params.delete(key);
  }
  return `http://localhost/api/oauth/authorize?${params.toString()}`;
}

function makeAuthorizeRequest(overrides: Record<string, string | undefined> = {}): NextRequest {
  return new NextRequest(authorizeUrl(overrides));
}

function makeTokenRequest(body: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── DB mock helpers ───────────────────────────────────────────────────────────

/**
 * Sets up holders.mockFrom to return the given data for known tables.
 * Tables not listed return { data: null, error: { message: 'not found' } }.
 */
function setupDb({
  app = MOCK_APP as typeof MOCK_APP | null,
  appError = null as { message: string } | null,
  scopes = [MOCK_SCOPE] as typeof MOCK_SCOPE[],
  scopeError = null as { message: string } | null,
  school = MOCK_SCHOOL as typeof MOCK_SCHOOL | null,
  schoolError = null as { message: string } | null,
  tokenRecord = null as Record<string, unknown> | null,
  tokenError = null as { message: string } | null,
  tokenInsertError = null as { message: string } | null,
} = {}) {
  holders.mockFrom.mockImplementation((table: string) => {
    if (table === 'oauth_apps') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: app, error: appError }),
          }),
        }),
      };
    }
    if (table === 'oauth_scopes') {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: scopes, error: scopeError }),
        }),
      };
    }
    if (table === 'schools') {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: school, error: schoolError }),
          }),
        }),
      };
    }
    if (table === 'oauth_tokens') {
      const revokeEq = vi.fn().mockResolvedValue({ error: null });
      const revokeUpdate = vi.fn().mockReturnValue({ eq: revokeEq });
      return {
        select: () => ({
          eq: (_col: string, _val: unknown) => ({
            is: () => ({
              single: () => Promise.resolve({ data: tokenRecord, error: tokenError }),
            }),
          }),
        }),
        update: revokeUpdate,
        insert: () => Promise.resolve({ error: tokenInsertError }),
      };
    }
    return {
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'unknown table' } }) }) }),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/oauth/authorize
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/oauth/authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holders.mockSecureEqual.mockImplementation((a: string, b: string) => a === b);
  });

  // ── param validation ──────────────────────────────────────────────────────

  it('returns 400 invalid_request when client_id is missing', async () => {
    const params = new URLSearchParams({
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      school_id: SCHOOL_ID,
      response_type: 'code',
    });
    const req = new NextRequest(`http://localhost/api/oauth/authorize?${params}`);
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 invalid_request when redirect_uri is missing', async () => {
    const params = new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE, school_id: SCHOOL_ID, response_type: 'code' });
    const req = new NextRequest(`http://localhost/api/oauth/authorize?${params}`);
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 invalid_request when scope is missing', async () => {
    const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, school_id: SCHOOL_ID, response_type: 'code' });
    const req = new NextRequest(`http://localhost/api/oauth/authorize?${params}`);
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 invalid_request when school_id is missing', async () => {
    const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPE, response_type: 'code' });
    const req = new NextRequest(`http://localhost/api/oauth/authorize?${params}`);
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 unsupported_response_type when response_type is not code', async () => {
    const req = makeAuthorizeRequest({ response_type: 'token' });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_response_type');
  });

  it('returns 400 invalid_request when code_challenge is present but method is not S256', async () => {
    const req = makeAuthorizeRequest({ code_challenge: 'abc123', code_challenge_method: 'plain' });
    // DB not needed — validation rejects before the DB call
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  // ── client lookup ─────────────────────────────────────────────────────────

  it('returns 400 invalid_client when client_id is not found in DB', async () => {
    setupDb({ app: null, appError: { message: 'Not found' } });
    const res = await GET(makeAuthorizeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  it('returns 400 invalid_client when app is inactive', async () => {
    setupDb({ app: { ...MOCK_APP, is_active: false } });
    const res = await GET(makeAuthorizeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  it('returns 400 app_not_approved when app review_status is pending', async () => {
    setupDb({ app: { ...MOCK_APP, review_status: 'pending' } });
    const res = await GET(makeAuthorizeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('app_not_approved');
  });

  // ── redirect_uri validation ───────────────────────────────────────────────

  it('returns 400 invalid_redirect_uri when redirect_uri is not in the registered list', async () => {
    setupDb();
    const res = await GET(makeAuthorizeRequest({ redirect_uri: 'https://evil.example.com/steal' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_redirect_uri');
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it('returns 200 with app info, scope details, and school on a valid request', async () => {
    setupDb();
    const res = await GET(makeAuthorizeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // App info
    expect(body.data.app.id).toBe(APP_ID);
    expect(body.data.app.name).toBe('Test App');
    // Scope details
    expect(Array.isArray(body.data.scopes)).toBe(true);
    expect(body.data.scopes[0].code).toBe(SCOPE);
    expect(body.data.scopes[0].risk_level).toBe('low');
    // P7 bilingual pin: the Hindi display name must be present in the scope
    // payload the consent screen renders — never dropped in favor of
    // English-only.
    expect(body.data.scopes[0].display_name_hi).toBe('छात्र डेटा पढ़ें');
    // School info
    expect(body.data.school.id).toBe(SCHOOL_ID);
    expect(body.data.school.name).toBe('Test School');
    // PKCE fields absent when not provided
    expect(body.data.code_challenge).toBeNull();
    expect(body.data.code_challenge_method).toBeNull();
  });

  it('echoes state and PKCE params when provided', async () => {
    setupDb();
    const res = await GET(makeAuthorizeRequest({
      state: 'csrf-token-xyz',
      code_challenge: 'base64url-challenge',
      code_challenge_method: 'S256',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.state).toBe('csrf-token-xyz');
    expect(body.data.code_challenge).toBe('base64url-challenge');
    expect(body.data.code_challenge_method).toBe('S256');
  });

  it('returns 400 invalid_scope when requested scope is unknown or inactive', async () => {
    // Return empty active scopes — all requested scopes are unknown
    setupDb({ scopes: [] });
    const res = await GET(makeAuthorizeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_scope');
  });

  it('P13: invalid_client denial response contains no PII keys', async () => {
    setupDb({ app: null, appError: { message: 'Not found' } });
    const res = await GET(makeAuthorizeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    const raw = JSON.stringify(body).toLowerCase();
    expect(raw).not.toMatch(/email/);
    expect(raw).not.toMatch(/phone/);
    expect(raw).not.toMatch(/"name"/);
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/oauth/token
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/oauth/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holders.mockSecureEqual.mockImplementation((a: string, b: string) => a === b);
  });

  // ── grant_type validation ─────────────────────────────────────────────────

  it('returns 400 invalid_request when grant_type is missing', async () => {
    const req = makeTokenRequest({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 400 unsupported_grant_type for unrecognised grant type', async () => {
    const req = makeTokenRequest({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_grant_type');
  });

  // ── authorization_code grant ──────────────────────────────────────────────

  it('returns 400 invalid_request when code is missing for authorization_code grant', async () => {
    const req = makeTokenRequest({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns 401 invalid_client when client credentials are invalid for authorization_code grant', async () => {
    setupDb({ app: null, appError: { message: 'Not found' } });
    const req = makeTokenRequest({
      grant_type: 'authorization_code',
      client_id: 'unknown-client',
      client_secret: 'wrong-secret',
      code: 'some-code',
      redirect_uri: REDIRECT_URI,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  it('returns 400 invalid_grant for authorization_code grant (consent screen not yet built)', async () => {
    // Client validates OK but the code exchange is a stub returning invalid_grant.
    setupDb({ app: { ...MOCK_APP, client_secret_hash: 'hashed-secret' } });
    // secureEqual: make the secret comparison pass
    holders.mockSecureEqual.mockReturnValue(true);

    const req = makeTokenRequest({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: 'any-code',
      redirect_uri: REDIRECT_URI,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
  });

  // ── refresh_token grant ───────────────────────────────────────────────────

  it('returns 400 invalid_request when refresh_token is missing', async () => {
    const req = makeTokenRequest({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns 401 invalid_client when client credentials are wrong for refresh_token grant', async () => {
    setupDb({ app: null, appError: { message: 'Not found' } });
    const req = makeTokenRequest({
      grant_type: 'refresh_token',
      client_id: 'bad-client',
      client_secret: 'bad-secret',
      refresh_token: 'rt-xxx',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  it('returns 400 invalid_grant when refresh token is not found in DB', async () => {
    setupDb({
      app: { ...MOCK_APP, client_secret_hash: 'any-hash' },
      tokenRecord: null,
      tokenError: { message: 'Row not found' },
    });
    holders.mockSecureEqual.mockReturnValue(true);

    const req = makeTokenRequest({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: 'expired-or-invalid-rt',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
  });

  it('returns 200 with new tokens on a valid refresh_token grant', async () => {
    const TOKEN_RECORD = {
      id: 'tok-111',
      app_id: APP_ID,
      school_id: SCHOOL_ID,
      user_id: 'user-abc',
      scopes: [SCOPE],
      refresh_token_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      revoked_at: null,
    };

    setupDb({
      app: { ...MOCK_APP, client_secret_hash: 'any-hash' },
      tokenRecord: TOKEN_RECORD,
    });
    // Secret comparison always passes in this test
    holders.mockSecureEqual.mockReturnValue(true);

    const req = makeTokenRequest({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: 'valid-refresh-token',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body.access_token).toBe('string');
    expect(body.access_token.length).toBeGreaterThan(0);
    expect(typeof body.refresh_token).toBe('string');
    expect(body.refresh_token.length).toBeGreaterThan(0);
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    // Cache-Control must be no-store on token endpoint
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 400 invalid_grant when refresh token belongs to a different app', async () => {
    const TOKEN_RECORD = {
      id: 'tok-222',
      app_id: 'different-app-id',  // does not match APP_ID
      school_id: SCHOOL_ID,
      user_id: 'user-abc',
      scopes: [SCOPE],
      refresh_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      revoked_at: null,
    };
    setupDb({
      app: { ...MOCK_APP, client_secret_hash: 'any-hash' },
      tokenRecord: TOKEN_RECORD,
    });
    holders.mockSecureEqual.mockReturnValue(true);

    const req = makeTokenRequest({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: 'rt-from-other-app',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
  });

  it('returns 400 invalid_grant when refresh token has expired', async () => {
    const TOKEN_RECORD = {
      id: 'tok-333',
      app_id: APP_ID,
      school_id: SCHOOL_ID,
      user_id: 'user-abc',
      scopes: [SCOPE],
      refresh_token_expires_at: new Date(Date.now() - 1000).toISOString(), // expired 1 s ago
      revoked_at: null,
    };
    setupDb({
      app: { ...MOCK_APP, client_secret_hash: 'any-hash' },
      tokenRecord: TOKEN_RECORD,
    });
    holders.mockSecureEqual.mockReturnValue(true);

    const req = makeTokenRequest({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: 'expired-rt',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
  });

  it('accepts form-urlencoded body for refresh_token grant', async () => {
    const TOKEN_RECORD = {
      id: 'tok-444',
      app_id: APP_ID,
      school_id: SCHOOL_ID,
      user_id: 'user-abc',
      scopes: [SCOPE],
      refresh_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
      revoked_at: null,
    };
    setupDb({
      app: { ...MOCK_APP, client_secret_hash: 'any-hash' },
      tokenRecord: TOKEN_RECORD,
    });
    holders.mockSecureEqual.mockReturnValue(true);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: 'valid-rt-form',
    });
    const req = new NextRequest('http://localhost/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.token_type).toBe('Bearer');
  });
});
