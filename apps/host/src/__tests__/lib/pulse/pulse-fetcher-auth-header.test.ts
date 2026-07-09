/**
 * Pulse client-fetcher Bearer-token forwarding (P0 auth fix, 2026-06-16).
 *
 * WHY this exists / what landed:
 *   This app's browser Supabase client persists the session in localStorage, NOT
 *   in a cookie (plain `createClient`, not `createBrowserClient`). Server routes
 *   (`authorizeRequest`) authenticate via `Authorization: Bearer <access_token>`
 *   FIRST; a client fetch with `credentials: 'same-origin'` alone carries no
 *   session, so every `/api/pulse/*` request 401'd. The fix: `pulseFetcher` in
 *   `src/lib/pulse/use-pulse.ts` now spreads `await authHeader()` into the fetch
 *   headers (mirrors the teacher / school-admin authed-fetch fixes).
 *
 * COVERAGE — two complementary layers, mirroring the school-admin `ccFetcher`
 * pattern (`src/__tests__/lib/school-admin/authed-fetch.test.ts`): test the
 * smallest shared seam, NOT a heavy SWR/component mount.
 *
 *   1. Behavioral — `pulseFetcher` is a module-LOCAL (un-exported) function in
 *      use-pulse.ts and the module is `'use client'` + pulls SWR. Importing it
 *      would drag the SWR data layer into this unit, so its body is reproduced
 *      VERBATIM here over the REAL `authHeader()` helper (which IS imported and
 *      exercised for real against a stubbed supabase session). This pins:
 *        - session present → fetch carries `Authorization: Bearer <token>`,
 *        - no session      → request STILL fires (no throw), no Authorization,
 *        - non-2xx         → throws an Error with a numeric `.status`,
 *        - 2xx             → unwraps the `{ success, data }` envelope to `.data`.
 *
 *   2. Structural — use-pulse.ts must import AND spread `authHeader()` into the
 *      pulseFetcher headers. A regression that drops the spread (reverting to a
 *      bare `fetch`) re-opens the 401 and is caught here without an SWR mount.
 *
 * Mock seam: `@alfanumrik/lib/supabase-client` `supabase.auth.getSession` is the ONLY thing
 * stubbed (that is the seam `authHeader()` reads from); `global.fetch` is stubbed
 * to observe the outgoing request. The Bearer-forwarding logic runs for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Mock the Supabase client seam authHeader() reads its session from. ─────────
const sessionHolder: { session: { access_token: string } | null } = { session: null };

vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: sessionHolder.session }, error: null })),
    },
  },
  supabaseUrl: 'https://placeholder.supabase.co',
  supabaseAnonKey: 'anon-key',
}));

import { authHeader } from '@alfanumrik/lib/api/auth-header';

// A real Response so `.ok` / `.json()` behave like the platform.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionHolder.session = null;
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Pull the (url, init) pair off the most recent fetch call. */
function lastFetch(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

/** Headers can be a Headers instance OR a plain object — normalise to a getter. */
function headerGet(init: RequestInit, name: string): string | null {
  const h = init.headers;
  if (h instanceof Headers) return h.get(name);
  if (Array.isArray(h)) {
    const found = h.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  if (h && typeof h === 'object') {
    const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? (h as Record<string, string>)[key] : null;
  }
  return null;
}

// ── Verbatim reproduction of use-pulse.ts `pulseFetcher` (over the REAL authHeader). ──
// Kept byte-for-byte equivalent to the source so this pins the live contract.
async function pulseFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: await authHeader(),
  });
  if (!res.ok) {
    const error = new Error(`Pulse fetch failed: ${url}`) as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  const json = (await res.json()) as { success?: boolean; data?: T };
  return (json.data ?? null) as T;
}

const URL = '/api/pulse/me';

describe('pulseFetcher — Bearer-token forwarding (over real authHeader)', () => {
  it('forwards Authorization: Bearer <token> when a session exists', async () => {
    sessionHolder.session = { access_token: 'pulse-token-123' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { signals: [] } }));

    await pulseFetcher(URL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = lastFetch();
    expect(url).toBe(URL);
    expect(headerGet(init, 'Authorization')).toBe('Bearer pulse-token-123');
    // credentials kept so the cookie fallback path remains intact.
    expect(init.credentials).toBe('same-origin');
  });

  it('still sends the request (no throw at the header layer) and omits Authorization with NO session', async () => {
    sessionHolder.session = null;
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: null }));

    await pulseFetcher(URL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const auth = headerGet(lastFetch().init, 'Authorization');
    // Authorization is absent — never a literal "Bearer null"/"Bearer undefined".
    expect(auth == null || auth === '').toBe(true);
    expect(auth ?? '').not.toContain('null');
    expect(auth ?? '').not.toContain('undefined');
  });

  it('throws an Error carrying a numeric .status on a non-2xx (SWR onErrorRetry can branch on 4xx)', async () => {
    sessionHolder.session = null; // no session → server 401
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401));

    await expect(pulseFetcher(URL)).rejects.toMatchObject({ status: 401 });
  });

  it('unwraps the { success, data } envelope to the bare contract type on a 2xx', async () => {
    sessionHolder.session = { access_token: 'tok' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { mood: 'green' } }));

    const out = await pulseFetcher<{ mood: string }>(URL);
    expect(out).toEqual({ mood: 'green' });
  });
});

// ── Structural pin: use-pulse.ts imports AND spreads authHeader() in pulseFetcher. ──
describe('use-pulse.ts forwards authHeader() into pulseFetcher (structural pin)', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/lib/pulse/use-pulse.ts'), 'utf8');

  it('imports authHeader from the shared helper', () => {
    expect(src).toMatch(
      /import\s*\{\s*authHeader\s*\}\s*from\s*['"](?:@\/lib|@alfanumrik\/lib)\/api\/auth-header['"]/,
    );
  });

  it('spreads/awaits authHeader() into the fetch headers (not a dead import)', () => {
    expect(src).toMatch(/headers:\s*await\s+authHeader\(\)/);
  });
});

// ── Structural pin: the three repointed school-admin surfaces use authedFetch. ──
describe('school-admin surfaces forward Bearer via authedFetch (structural pin)', () => {
  const SCHOOL_ADMIN_SURFACES = [
    'src/app/school-admin/enroll/page.tsx',
    'src/app/school-admin/setup/page.tsx',
    '../../packages/ui/src/school-admin/principal-ai/PrincipalAiChat.tsx',
  ];

  it.each(SCHOOL_ADMIN_SURFACES)('%s imports authedFetch from the shared helper', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(src).toMatch(
      /import\s*\{\s*authedFetch\s*\}\s*from\s*['"](?:@\/lib|@alfanumrik\/lib)\/school-admin\/authed-fetch['"]/,
    );
  });

  it.each(SCHOOL_ADMIN_SURFACES)('%s actually calls authedFetch( (not a dead import)', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(src).toMatch(/authedFetch\(/);
  });
});
