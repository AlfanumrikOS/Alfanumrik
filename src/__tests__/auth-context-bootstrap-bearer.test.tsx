/**
 * AuthContext bootstrap-fallback fetch — M3 client + R2 layer-3 (2026-06-10)
 *
 * When an authenticated user has NO profile rows (RPC returns nothing and all
 * four role-table lookups come back empty), AuthContext fires the layer-3
 * P15 failsafe: POST /api/auth/bootstrap. The 2026-06-10 audit fixes pinned
 * here:
 *
 *   - M3 (client): the fetch attaches `Authorization: Bearer <access_token>`
 *     when a session token is available (3s-raced getSession), because
 *     password-login users hold the session in localStorage and have no sb-*
 *     cookies — without the header the bootstrap route 401'd.
 *   - Graceful degradation: when the token re-read returns no session or
 *     throws, the request goes out WITHOUT the Authorization header (exactly
 *     the pre-M3 shape) instead of failing.
 *   - R2 (layer-3): the payload grade defaults to '9' via normalizeGrade
 *     (was a hand-rolled `meta.grade || '6'`), unified with the
 *     callback/confirm/bootstrap-route failsafe layers. Grades stay strings
 *     per P5.
 *
 * We mount the REAL AuthProvider with the supabase client mocked at the
 * module boundary and global.fetch stubbed — asserting on the actual request
 * AuthContext emits, not on replicated logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// ── supabase client mock (module boundary) ──────────────────────

const getSessionMock = vi.fn();
const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const onAuthStateChangeMock = vi.fn((..._args: unknown[]) => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      getUser: (...args: unknown[]) => getUserMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
  getStudentSnapshot: vi.fn().mockResolvedValue(null),
}));

// Non-critical side-effect modules — keep the auth path light.
vi.mock('@/lib/swr', () => ({ clearAllCache: vi.fn() }));
vi.mock('@/lib/use-atlas-flag', () => ({ clearAtlasFlagCache: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/posthog/client', () => ({ identify: vi.fn(), reset: vi.fn() }));

// ── Helpers ─────────────────────────────────────────────────────

/** Chainable PostgREST table mock: every lookup resolves to "no row". */
function emptyTableChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.single = () => Promise.resolve({ data: null, error: null });
  return chain;
}

const fetchMock = vi.fn();

function makeUser(meta: Record<string, unknown>) {
  return {
    id: 'auth-user-bootstrap-1',
    email: 'newkid@example.com',
    user_metadata: meta,
  };
}

/** Find the /api/auth/bootstrap fetch call and parse its headers + body. */
function getBootstrapCall(): { headers: Record<string, string>; body: Record<string, unknown> } {
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/bootstrap');
  expect(call, 'expected a fetch to /api/auth/bootstrap').toBeDefined();
  const init = call![1] as RequestInit;
  return {
    headers: (init.headers ?? {}) as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

async function mountProviderAndAwaitBootstrap() {
  const { AuthProvider } = await import('@/lib/AuthContext');
  render(
    <AuthProvider>
      <div data-testid="child" />
    </AuthProvider>
  );
  await waitFor(
    () => {
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/auth/bootstrap')).toBe(true);
    },
    { timeout: 8000 }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  // get_user_role RPC: supports .abortSignal() and resolves to "no roles"
  // so the parallel table fallback (also empty) routes into the bootstrap path.
  rpcMock.mockImplementation(() => ({
    abortSignal: () => Promise.resolve({ data: null, error: null }),
  }));
  fromMock.mockImplementation(() => emptyTableChain());
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });

  // Bootstrap route responds NOT-ok so AuthContext does not recurse into a
  // second fetchUser pass — keeps each test to exactly one bootstrap request.
  fetchMock.mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({ success: false }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── M3: Authorization Bearer header ─────────────────────────────

describe('AuthContext bootstrap fetch — Authorization header (M3)', () => {
  it('attaches Authorization: Bearer <token> when getSession returns a session with an access token', async () => {
    const user = makeUser({ role: 'student', name: 'Kid' });
    getSessionMock.mockResolvedValue({
      data: { session: { user, access_token: 'session-token-abc' } },
    });

    await mountProviderAndAwaitBootstrap();

    const { headers } = getBootstrapCall();
    expect(headers['Authorization']).toBe('Bearer session-token-abc');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits the Authorization header when the session carries no access token (graceful degradation)', async () => {
    const user = makeUser({ role: 'student', name: 'Kid' });
    // Session resolves the user but exposes no access_token — the token
    // re-read yields null and the request must go out in the pre-M3 shape.
    getSessionMock.mockResolvedValue({
      data: { session: { user } },
    });

    await mountProviderAndAwaitBootstrap();

    const { headers } = getBootstrapCall();
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits the Authorization header when the token re-read throws (graceful degradation)', async () => {
    const user = makeUser({ role: 'student', name: 'Kid' });
    getSessionMock
      // 1st call: top of fetchUser — resolves the user (with a token, which
      // is irrelevant because the bootstrap block re-reads the session).
      .mockResolvedValueOnce({
        data: { session: { user, access_token: 'token-from-first-read' } },
      })
      // 2nd call: the M3 token re-read — rejects (e.g. auth lock contention).
      .mockRejectedValueOnce(new Error('_acquireLock contention'))
      // Any later calls: logged out.
      .mockResolvedValue({ data: { session: null } });

    await mountProviderAndAwaitBootstrap();

    const { headers } = getBootstrapCall();
    expect(headers).not.toHaveProperty('Authorization');
  });
});

// ── R2: payload grade default via normalizeGrade (P5) ───────────

describe('AuthContext bootstrap fetch — payload grade (R2, P5)', () => {
  it("defaults payload grade to '9' when metadata grade is missing (was '6' pre-R2)", async () => {
    const user = makeUser({ role: 'student', name: 'Kid' }); // no grade key
    getSessionMock.mockResolvedValue({
      data: { session: { user, access_token: 'tok' } },
    });

    await mountProviderAndAwaitBootstrap();

    const { body } = getBootstrapCall();
    expect(body.grade).toBe('9');
    expect(typeof body.grade).toBe('string');
    expect(body.role).toBe('student');
    expect(body.board).toBe('CBSE');
  });

  it("normalizes an invalid metadata grade to '9' instead of forwarding garbage", async () => {
    const user = makeUser({ role: 'student', name: 'Kid', grade: 'abc' });
    getSessionMock.mockResolvedValue({
      data: { session: { user, access_token: 'tok' } },
    });

    await mountProviderAndAwaitBootstrap();

    const { body } = getBootstrapCall();
    expect(body.grade).toBe('9');
  });

  it('coerces a numeric metadata grade to a P5 string via normalizeGrade', async () => {
    const user = makeUser({ role: 'student', name: 'Kid', grade: 7 });
    getSessionMock.mockResolvedValue({
      data: { session: { user, access_token: 'tok' } },
    });

    await mountProviderAndAwaitBootstrap();

    const { body } = getBootstrapCall();
    expect(body.grade).toBe('7');
    expect(typeof body.grade).toBe('string');
  });

  it('passes a valid metadata grade through unchanged', async () => {
    const user = makeUser({ role: 'student', name: 'Kid', grade: '11' });
    getSessionMock.mockResolvedValue({
      data: { session: { user, access_token: 'tok' } },
    });

    await mountProviderAndAwaitBootstrap();

    const { body } = getBootstrapCall();
    expect(body.grade).toBe('11');
  });
});
