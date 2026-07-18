/**
 * REG-271 (part b) — server-side `email_verified` emit contract (P13 / P15).
 *
 * completeSignupBootstrap (packages/lib/src/identity/complete-signup.ts) is the
 * shared choke point for BOTH /auth/callback (PKCE) and /auth/confirm
 * (token_hash) verification flows. Wave 2 added the B2C funnel's server stitch
 * point: emit `email_verified` ONCE, on first-time verification only, keyed by
 * the hashed distinct id so it joins the same PostHog person the browser
 * identified.
 *
 * Contract pinned here:
 *   - Fires EXACTLY ONCE on first verification (`!hasProfile`).
 *   - Does NOT fire on a repeat verification (profile already exists).
 *   - Payload is EXACTLY `{ role, method: 'email' }` — no name/email/phone/UUID (P13).
 *   - role is normalized to the signup_complete vocabulary:
 *       teacher→'teacher', parent→'guardian', student→'student',
 *       institution_admin→SKIPPED (no emit — B2B, not the B2C funnel).
 *   - distinctId is the 16-hex hash of the AUTH uid, never the raw UUID (P13).
 *   - idempotencyKey is timestamp-free (`email_verified:<hash>`) → forever-dedup.
 *   - The emit is FAIL-SOFT (P15): a throw in the emit path must NOT break
 *     completeSignupBootstrap's return (the caller always redirects).
 *
 * Strategy: drive the REAL completeSignupBootstrap with mocked collaborators.
 * We keep the REAL hashDistinctId (partial mock via importOriginal) so the
 * distinctId assertion is against the true hash. `after()` from next/server is
 * mocked to invoke its callback synchronously so we can assert the capture.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── after() seam: default = run the deferred callback immediately so the
// capture inside it actually executes in-test. Individual tests can override
// the impl (e.g. to throw) to exercise the fail-soft path.
const afterImpl = { fn: (cb: () => unknown): void => { void cb(); } };
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (cb: () => unknown) => afterImpl.fn(cb) };
});

// ── capture spy; keep the REAL hashDistinctId so we can assert the true hash.
const captureMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/posthog/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/posthog/server')>();
  return { ...actual, capture: (...a: unknown[]) => captureMock(...a) };
});

// ── admin client: bootstrap RPC + session-registration chain, all harmless.
const rpcMock = vi.fn().mockResolvedValue({ data: { status: 'success' }, error: null });
vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => Promise.resolve({ data: [] });
  chain.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'sess-1' } }) }) });
  chain.update = () => ({ eq: () => Promise.resolve({ data: null }) });
  const admin = { from: () => chain, rpc: (...a: unknown[]) => rpcMock(...a) };
  return { getSupabaseAdmin: () => admin, supabaseAdmin: admin };
});

// ── metadata → params: role comes straight from user_metadata.role.
vi.mock('@alfanumrik/lib/identity/bootstrap-profile', () => ({
  profileParamsFromMetadata: (user: { email?: string; user_metadata?: Record<string, unknown> }) => ({
    email: user.email ?? 'x@y.com',
    name: (user.user_metadata?.name as string) ?? 'Test User',
    role: (user.user_metadata?.role as string) ?? 'student',
    grade: '9',
    board: 'CBSE',
    school_name: '',
    school_city: '',
    school_state: '',
    principal_name: '',
    subjects: [],
    grades_taught: [],
    phone: null,
    link_code: null,
  }),
}));

const ensureSchoolAdminMock = vi.fn().mockResolvedValue({ ok: true, schoolId: 's-1', schoolAdminId: 'sa-1' });
vi.mock('@alfanumrik/lib/identity/school-admin-bootstrap', () => ({
  ensureSchoolAdminOnboarding: (...a: unknown[]) => ensureSchoolAdminMock(...a),
}));

import { completeSignupBootstrap, type SignupUser } from '@alfanumrik/lib/identity/complete-signup';
import { hashDistinctId } from '@alfanumrik/lib/posthog/server';

const AUTH_UID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/**
 * Build the request-scoped server client. `rows` maps a table name → whether a
 * profile row exists for it. Both the initial existence probes and the
 * post-bootstrap re-probes read through this same stub.
 */
function makeServerClient(rows: Record<string, boolean> = {}): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'a', refresh_token: 'r' } } }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: rows[table] ? { id: `${table}-1` } : null, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function makeUser(role: string): SignupUser {
  return { id: AUTH_UID, email: 'learner@example.com', user_metadata: { role, name: 'Aarav' } };
}

/** All `email_verified` capture() calls. */
function emailVerifiedCalls() {
  return captureMock.mock.calls.filter((c) => c[0] === 'email_verified');
}

const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  afterImpl.fn = (cb: () => unknown) => { void cb(); };
  rpcMock.mockResolvedValue({ data: { status: 'success' }, error: null });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('REG-271b — email_verified fires once on first-time verification', () => {
  it('first-time student verification emits exactly one email_verified', async () => {
    const role = await completeSignupBootstrap(makeServerClient({}), makeUser('student'));
    expect(role).toBe('student');
    expect(emailVerifiedCalls()).toHaveLength(1);
  });

  it('does NOT emit when a profile already exists (repeat verification)', async () => {
    // students row present → hasProfile true → the !hasProfile emit guard skips.
    const role = await completeSignupBootstrap(makeServerClient({ students: true }), makeUser('student'));
    expect(role).toBe('student');
    expect(emailVerifiedCalls()).toHaveLength(0);
  });
});

describe('REG-271b — payload is exactly { role, method:"email" } (P13 boundary)', () => {
  it('carries only role + method — no name/email/phone/UUID keys', async () => {
    await completeSignupBootstrap(makeServerClient({}), makeUser('student'));
    const [event, distinctId, payload, idempotencyKey] = emailVerifiedCalls()[0];

    expect(event).toBe('email_verified');
    // Exact shape — deep equality catches any extra (PII-shaped) key.
    expect(payload).toEqual({ role: 'student', method: 'email' });

    // Defensive: no PII-shaped key or the raw UUID anywhere in the payload.
    const keys = Object.keys(payload as Record<string, unknown>);
    expect(keys.sort()).toEqual(['method', 'role']);
    // Value guards: no PII VALUE leaks (note `method:'email'` is the literal
    // channel enum, not a PII value — the key/deep-equal checks above already
    // pin that only `role` + `method` keys exist).
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(AUTH_UID);              // no raw UUID
    expect(serialized).not.toContain('learner@example.com'); // no email value
    expect(serialized).not.toContain('Aarav');               // no name value

    // idempotencyKey is timestamp-free → forever-dedup on a re-clicked link.
    expect(idempotencyKey).toBe(`email_verified:${distinctId}`);
    expect(idempotencyKey).not.toMatch(/\d{10}/); // no unix-seconds suffix
  });
});

describe('REG-271b — distinctId is the hashed AUTH uid, never the raw UUID (P13)', () => {
  it('distinctId equals hashDistinctId(auth uid) and is a 16-hex string', async () => {
    await completeSignupBootstrap(makeServerClient({}), makeUser('student'));
    const [, distinctId] = emailVerifiedCalls()[0];
    expect(distinctId).toBe(hashDistinctId(AUTH_UID));
    expect(distinctId).toMatch(/^[0-9a-f]{16}$/);
    expect(distinctId).not.toBe(AUTH_UID);
  });
});

describe('REG-271b — role normalized to the signup_complete vocabulary', () => {
  it('teacher → role "teacher"', async () => {
    const role = await completeSignupBootstrap(makeServerClient({}), makeUser('teacher'));
    expect(role).toBe('teacher');
    expect(emailVerifiedCalls()[0][2]).toEqual({ role: 'teacher', method: 'email' });
  });

  it('parent → role "guardian" (internal-vocabulary mapping)', async () => {
    const role = await completeSignupBootstrap(makeServerClient({}), makeUser('parent'));
    // The redirect role stays 'parent'; the FUNNEL role is normalized to 'guardian'.
    expect(role).toBe('parent');
    expect(emailVerifiedCalls()[0][2]).toEqual({ role: 'guardian', method: 'email' });
  });

  it('student → role "student"', async () => {
    await completeSignupBootstrap(makeServerClient({}), makeUser('student'));
    expect(emailVerifiedCalls()[0][2]).toEqual({ role: 'student', method: 'email' });
  });

  it('institution_admin → NO emit (B2B path skipped by normalizeFunnelRole)', async () => {
    const role = await completeSignupBootstrap(makeServerClient({}), makeUser('institution_admin'));
    expect(role).toBe('institution_admin');
    expect(ensureSchoolAdminMock).toHaveBeenCalledTimes(1); // still onboarded
    expect(emailVerifiedCalls()).toHaveLength(0);           // but no funnel emit
  });
});

describe('REG-271b — the emit is fail-soft (P15: telemetry never breaks the funnel)', () => {
  it('a throw in after() (missing request context) does NOT break the return', async () => {
    afterImpl.fn = () => { throw new Error('after() called outside a request scope'); };
    // Must still resolve to the role, never reject.
    await expect(
      completeSignupBootstrap(makeServerClient({}), makeUser('student')),
    ).resolves.toBe('student');
  });

  it('a throw INSIDE the deferred capture does NOT reject completeSignupBootstrap', async () => {
    // after() runs the callback (which awaits capture → rejects). The callback
    // rejection is swallowed by after()'s own semantics; the outer function
    // must still resolve to the role.
    afterImpl.fn = (cb: () => unknown) => { void Promise.resolve(cb()).catch(() => {}); };
    captureMock.mockRejectedValueOnce(new Error('posthog ingest exploded'));
    await expect(
      completeSignupBootstrap(makeServerClient({}), makeUser('student')),
    ).resolves.toBe('student');
  });
});
