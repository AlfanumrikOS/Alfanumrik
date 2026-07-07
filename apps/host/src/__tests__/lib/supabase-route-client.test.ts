/**
 * REG-219 — Bearer-aware, RLS-respecting route client (XC-3 Phase 2 enabler).
 *
 * Proves `createSupabaseRouteClient()` can NEVER become a service-role bypass:
 *   (a) Bearer request → client built on the ANON key with the caller's
 *       `Authorization: Bearer <jwt>` forwarded as a global header (so PostgREST
 *       runs under the caller's identity and RLS `auth.uid()` resolves).
 *   (b) No Authorization header → delegates to the cookie-based
 *       `createSupabaseServerClient()` (web/RLS path).
 *   (c) The service-role key is NEVER passed to `createClient` on any path.
 *
 * The supabase libraries are mocked at the module boundary so we can inspect the
 * exact arguments the helper passes (the key + the global header).
 *
 * Invariants: P8 (RLS boundary), P9 (RBAC enforcement — defense in depth).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @supabase/supabase-js createClient (Bearer transport) ───────────────
const _createClient = vi.fn((_url: string, _key: string, _opts: unknown) => ({
  __kind: 'bearer-client',
  url: _url,
  key: _key,
  opts: _opts,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) =>
    _createClient(args[0] as string, args[1] as string, args[2]),
}));

// ── Mock the cookie client (web path delegate) ───────────────────────────────
const _createServerClient = vi.fn(async () => ({ __kind: 'cookie-client' }));
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: () => _createServerClient(),
}));

import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';

// Fake, non-JWT-shaped fixtures (no real secret; deliberately not token-shaped).
const ANON_KEY = 'fake-anon-public-key-FOR-TEST';
const SERVICE_ROLE_KEY = 'fake-service-role-FOR-TEST';
const URL = 'https://project.supabase.co';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
});

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://app.alfanumrik.com/api/student/daily-plan', {
    headers,
  });
}

describe('createSupabaseRouteClient — Bearer path (REG-219)', () => {
  it('forwards the caller Bearer JWT as a global Authorization header and uses the anon key', async () => {
    const JWT = 'caller-access-token-123';
    await createSupabaseRouteClient(reqWith({ Authorization: `Bearer ${JWT}` }));

    expect(_createClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = _createClient.mock.calls[0];

    // anon key — NEVER service-role
    expect(key).toBe(ANON_KEY);
    expect(key).not.toBe(SERVICE_ROLE_KEY);
    expect(url).toBe(URL);

    // caller's JWT forwarded verbatim so RLS auth.uid() resolves
    expect((opts as any).global.headers.Authorization).toBe(`Bearer ${JWT}`);

    // stateless per-request client (no session persistence)
    expect((opts as any).auth.persistSession).toBe(false);
    expect((opts as any).auth.autoRefreshToken).toBe(false);

    // cookie delegate must NOT be used on the Bearer path
    expect(_createServerClient).not.toHaveBeenCalled();
  });

  it('matches the Authorization header case-insensitively (lowercase header)', async () => {
    await createSupabaseRouteClient(reqWith({ authorization: 'Bearer lower-jwt' }));
    expect(_createClient).toHaveBeenCalledTimes(1);
    const [, , opts] = _createClient.mock.calls[0];
    expect((opts as any).global.headers.Authorization).toBe('Bearer lower-jwt');
  });
});

describe('createSupabaseRouteClient — cookie path (REG-219)', () => {
  it('delegates to the cookie-based server client when no Authorization header is present', async () => {
    const client = await createSupabaseRouteClient(reqWith({}));
    expect(_createServerClient).toHaveBeenCalledTimes(1);
    expect(_createClient).not.toHaveBeenCalled();
    expect((client as any).__kind).toBe('cookie-client');
  });

  it('delegates to the cookie path when Authorization is present but not a Bearer scheme', async () => {
    await createSupabaseRouteClient(reqWith({ Authorization: 'Basic abc123' }));
    expect(_createServerClient).toHaveBeenCalledTimes(1);
    expect(_createClient).not.toHaveBeenCalled();
  });

  it('delegates to the cookie path when the Bearer token is empty', async () => {
    await createSupabaseRouteClient(reqWith({ Authorization: 'Bearer    ' }));
    expect(_createServerClient).toHaveBeenCalledTimes(1);
    expect(_createClient).not.toHaveBeenCalled();
  });
});

describe('createSupabaseRouteClient — never service-role (REG-219)', () => {
  it('does not pass the service-role key to createClient on any Bearer call', async () => {
    await createSupabaseRouteClient(reqWith({ Authorization: 'Bearer jwt-x' }));
    for (const call of _createClient.mock.calls) {
      expect(call[1]).not.toBe(SERVICE_ROLE_KEY);
    }
  });

  it('fails closed (throws, builds nothing) if the anon key is misconfigured to equal the service-role key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE_ROLE_KEY;
    await expect(
      createSupabaseRouteClient(reqWith({ Authorization: 'Bearer jwt-y' })),
    ).rejects.toThrow(/service-role/i);
    expect(_createClient).not.toHaveBeenCalled();
  });
});
