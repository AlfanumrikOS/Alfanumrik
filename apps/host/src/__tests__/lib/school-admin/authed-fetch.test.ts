/**
 * authed-fetch.ts — Bearer-token forwarding helper (P0 auth fix, 2026-06-16).
 *
 * WHY this exists / what landed:
 *   The browser Supabase client persists the session in localStorage (plain
 *   `createClient`, NOT `createBrowserClient`), so NO cookie carries the session.
 *   Server routes (`authorizeRequest` / `authorizeSchoolAdmin`) authenticate via
 *   `Authorization: Bearer <access_token>` FIRST, then fall back to cookies. A
 *   client fetch with `credentials: 'same-origin'` alone therefore 401s. The
 *   landed fix factors the established getToken pattern into one helper
 *   (`getAccessToken()` + `authedFetch(url, init?)`) and repoints the
 *   school-admin client fetchers (CommandCenter ccFetcher, modules, staff,
 *   reports-depth, ai-config, branding, SchoolAdminShell, invite-codes,
 *   audit-log, api-keys, rbac) at it.
 *
 * Contract pinned here (the helper itself):
 *   1. Session present     → fetch called with `Authorization: Bearer <token>`.
 *   2. No session          → request STILL sent (no throw), Authorization absent
 *                            (server 401 → existing retry UX handles it upstream).
 *   3. Caller init merged  → method/body/headers preserved, Authorization added
 *                            alongside (not clobbering), `credentials:'same-origin'` set.
 *   4. getAccessToken()    → returns the token, and null when there is no session.
 *
 * Plus a focused contract pin on the CommandCenter `ccFetcher` shape (see the
 * second describe block for why it is reproduced rather than imported).
 *
 * Mock seam: `@alfanumrik/lib/supabase-client` `supabase.auth.getSession` is the ONLY thing
 * stubbed; `global.fetch` is stubbed to observe the outgoing request. Business
 * logic in the helper is exercised for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock the Supabase client seam. A module-level holder lets each test drive
//    what getSession() resolves to (a session with an access_token, or null). ──
const sessionHolder: { session: { access_token: string } | null } = { session: null };

vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: sessionHolder.session }, error: null })),
    },
  },
}));

import { authedFetch, getAccessToken } from '@alfanumrik/lib/school-admin/authed-fetch';

const URL = '/api/school-admin/overview';

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
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
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

// ─────────────────────────────────────────────────────────────────────────────
describe('authedFetch — Bearer-token forwarding', () => {
  it('forwards Authorization: Bearer <token> when a session exists', async () => {
    sessionHolder.session = { access_token: 'token-abc-123' };

    await authedFetch(URL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = lastFetch();
    expect(url).toBe(URL);
    expect(headerGet(init, 'Authorization')).toBe('Bearer token-abc-123');
  });

  it('still sends the request (no throw) and omits Authorization when there is NO session', async () => {
    sessionHolder.session = null;

    // Must NOT throw — the server returns 401 and existing retry UX handles it.
    await expect(authedFetch(URL)).resolves.toBeInstanceOf(Response);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { init } = lastFetch();
    // Authorization is absent/empty — never a literal "Bearer null"/"Bearer undefined".
    const auth = headerGet(init, 'Authorization');
    expect(auth == null || auth === '').toBe(true);
    expect(auth ?? '').not.toContain('null');
    expect(auth ?? '').not.toContain('undefined');
  });

  it('preserves caller method, body, and existing headers while adding Authorization', async () => {
    sessionHolder.session = { access_token: 'tok-merge' };

    await authedFetch(URL, {
      method: 'POST',
      body: JSON.stringify({ name: 'New Class' }),
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'keep-me' },
    });

    const { init } = lastFetch();
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'New Class' }));
    // Caller headers survive the merge…
    expect(headerGet(init, 'Content-Type')).toBe('application/json');
    expect(headerGet(init, 'X-Custom')).toBe('keep-me');
    // …and Authorization is added alongside them.
    expect(headerGet(init, 'Authorization')).toBe('Bearer tok-merge');
  });

  it('does NOT clobber a caller-provided Authorization header', async () => {
    sessionHolder.session = { access_token: 'session-token' };

    await authedFetch(URL, { headers: { Authorization: 'Bearer caller-supplied' } });

    const { init } = lastFetch();
    expect(headerGet(init, 'Authorization')).toBe('Bearer caller-supplied');
  });

  it("sets credentials: 'same-origin' so the cookie fallback path remains intact", async () => {
    sessionHolder.session = { access_token: 'tok' };

    await authedFetch(URL);

    const { init } = lastFetch();
    expect(init.credentials).toBe('same-origin');
  });

  it('passes through the URL unchanged (no rewriting of query params)', async () => {
    sessionHolder.session = { access_token: 'tok' };
    const withQuery = '/api/school-admin/classes-at-risk?limit=20&offset=0';

    await authedFetch(withQuery);

    expect(lastFetch().url).toBe(withQuery);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getAccessToken — token read from the live session', () => {
  it('returns the access token when a session exists', async () => {
    sessionHolder.session = { access_token: 'live-token-xyz' };
    await expect(getAccessToken()).resolves.toBe('live-token-xyz');
  });

  it('returns null when there is no session', async () => {
    sessionHolder.session = null;
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('does NOT call fetch (it only reads the session)', async () => {
    sessionHolder.session = { access_token: 'tok' };
    await getAccessToken();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CommandCenter `ccFetcher` contract pin.
//
// WHY reproduced, not imported: `ccFetcher` is a module-LOCAL function inside
// `src/app/school-admin/CommandCenter.tsx` (not exported), and CommandCenter is
// a heavy client component (SWR + dynamic imports + Auth/permissions/pulse
// hooks). Importing it to reach one helper would drag the whole data layer into
// this unit. The function under real scrutiny — `authedFetch` — IS imported and
// exercised for real below. The `ccFetcher` body is reproduced VERBATIM from
// CommandCenter.tsx so this test pins the documented multi-school picker
// contract (200 → parsed JSON; 400 with { school_ids } → SchoolPickerError with
// .status + .schoolIds) on top of the real Bearer-forwarding helper. If the
// CommandCenter source diverges from this shape, the contract note here is the
// canary; do not weaken it.
// ─────────────────────────────────────────────────────────────────────────────
interface SchoolPickerError extends Error {
  status: number;
  schoolIds?: string[];
}

// Verbatim reproduction of CommandCenter.tsx `ccFetcher` (lines 82-99).
async function ccFetcher<T>(url: string): Promise<T> {
  const res = await authedFetch(url);
  if (!res.ok) {
    let body: { error?: string; school_ids?: string[] } | null = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(body?.error || `Request failed (${res.status})`) as SchoolPickerError;
    err.status = res.status;
    if (res.status === 400 && Array.isArray(body?.school_ids)) {
      err.schoolIds = body!.school_ids;
    }
    throw err;
  }
  return res.json() as Promise<T>;
}

describe('ccFetcher contract (over real authedFetch) — multi-school picker intact', () => {
  it('returns parsed JSON on a 200 and forwards the Bearer token', async () => {
    sessionHolder.session = { access_token: 'cc-token' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { class_count: 4 }, data_state: 'live' }, 200));

    const out = await ccFetcher<{ data: { class_count: number }; data_state: string }>(URL);

    expect(out.data.class_count).toBe(4);
    expect(out.data_state).toBe('live');
    // The repointed fetcher still carries the Bearer header (the whole point of the fix).
    expect(headerGet(lastFetch().init, 'Authorization')).toBe('Bearer cc-token');
  });

  it('surfaces a SchoolPickerError with .status=400 and .schoolIds on a 400 { school_ids } body', async () => {
    sessionHolder.session = { access_token: 'cc-token' };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'Multiple schools — specify ?school_id', school_ids: ['s-a', 's-b'] }, 400),
    );

    await expect(ccFetcher(URL)).rejects.toMatchObject({
      status: 400,
      schoolIds: ['s-a', 's-b'],
    });
  });

  it('throws a plain error (no schoolIds) on a non-400 failure', async () => {
    sessionHolder.session = { access_token: 'cc-token' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403));

    let caught: SchoolPickerError | undefined;
    try {
      await ccFetcher(URL);
    } catch (e) {
      caught = e as SchoolPickerError;
    }
    expect(caught).toBeDefined();
    expect(caught!.status).toBe(403);
    expect(caught!.schoolIds).toBeUndefined();
  });

  it('does not treat a 400 WITHOUT school_ids as a picker error (no schoolIds attached)', async () => {
    sessionHolder.session = { access_token: 'cc-token' };
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, 400));

    let caught: SchoolPickerError | undefined;
    try {
      await ccFetcher(URL);
    } catch (e) {
      caught = e as SchoolPickerError;
    }
    expect(caught!.status).toBe(400);
    expect(caught!.schoolIds).toBeUndefined();
  });
});
