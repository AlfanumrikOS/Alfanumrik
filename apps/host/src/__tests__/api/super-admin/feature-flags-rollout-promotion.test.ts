/**
 * Feature-flags route — rollout-promotion + pagination contract tests
 * (feature-flag RCA repair, 2026-07-20).
 *
 * Pins the "enabled ⇒ effective" repair in
 *   src/app/api/super-admin/feature-flags/route.ts
 *
 * Root cause being pinned: feature_flags.rollout_percentage has a DB DEFAULT
 * of 0 and the web evaluator (packages/lib/src/feature-flags.ts) returns
 * FALSE for rollout_percentage=0 even when is_enabled=true. Before the
 * repair, (a) newly created flags inherited the 0 default and could never
 * turn on, and (b) toggling a 0%-rollout flag "on" silently kept it OFF for
 * every user. The route now writes rollout_percentage explicitly on POST and
 * conditionally promotes 0 → 100 on PATCH-enable.
 *
 * PATCH promotion matrix (the exact contract):
 *   - enable, previous rollout 0, no explicit rollout in body  → writes 100
 *   - enable, previous rollout non-zero (e.g. a deliberate 10% ramp)
 *                                                              → NOT touched
 *   - enable with an explicit rollout in the body              → body wins
 *   - disable                                                  → never promotes
 *   - previous state unreadable/missing                        → never promotes
 *
 * Also pinned here:
 *   - GET pagination: default limit=500 / offset=0, clamped to 1..1000 —
 *     the old hard-coded limit=100 silently truncated the admin flag list.
 *   - Flag-name regex at the route boundary: /^[a-z][a-z0-9_]*$/ — digits
 *     are legal (ff_school_pulse_v1), leading digit / uppercase / hyphen
 *     are not.
 *
 * Mocking style mirrors the sibling feature-flags-mutation-gate.test.ts:
 * authorizeAdmin / logAdminAudit stubbed at the module seam, global fetch
 * stubbed so the PostgREST calls (and their exact bodies/URLs) are
 * observable. Zod validation is intentionally NOT mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/admin-auth')>('@alfanumrik/lib/admin-auth');
  return {
    ...actual,
    authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
    logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  };
});

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  invalidateFlagCache: vi.fn(),
}));

const logOpsEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => logOpsEvent(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FLAG_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_UID = '22222222-2222-4222-8222-222222222222';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  adminId: 'admin-row-id',
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

function req(method: string, body?: unknown, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/super-admin/feature-flags${query}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-role-key';
  // NB: a fresh Response per call — a Response body is single-use, and the
  // POST/GET handlers read the body of more than one PostgREST response.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } }),
  );
  authorizeAdmin.mockResolvedValue(AUTH_OK);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

/**
 * Runs a PATCH { enabled?, rollout? } against a queued previous state and
 * returns the JSON body the route sent to PostgREST.
 */
async function runPatch(
  updates: Record<string, unknown>,
  prevStateResponse: Response,
): Promise<{ status: number; patchBody: Record<string, unknown> }> {
  fetchSpy
    .mockResolvedValueOnce(prevStateResponse) // previous-state read
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: FLAG_ID, flag_name: 'ff_demo_v1' }]), { status: 200 }),
    ); // PATCH write (return=representation)

  const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');
  const res = await PATCH(req('PATCH', { id: FLAG_ID, updates }));

  // Second fetch call is the PATCH write — verify and parse its body.
  const [, init] = fetchSpy.mock.calls[1] as [unknown, RequestInit];
  expect(init.method).toBe('PATCH');
  return { status: res.status, patchBody: JSON.parse(String(init.body)) };
}

const prevState = (rollout: number, enabled = false) =>
  new Response(
    JSON.stringify([{ flag_name: 'ff_demo_v1', is_enabled: enabled, rollout_percentage: rollout }]),
    { status: 200 },
  );

// ─── PATCH rollout-promotion matrix ───────────────────────────────────

describe('feature-flags PATCH — 0-rollout promotion matrix', () => {
  it('enable with previous rollout 0 and no explicit rollout → writes rollout_percentage 100', async () => {
    const { status, patchBody } = await runPatch({ enabled: true }, prevState(0));
    expect(status).toBe(200);
    expect(patchBody.is_enabled).toBe(true);
    expect(patchBody.rollout_percentage).toBe(100);

    // C1 (ops review): when the promotion fires, the audit details must show
    // what was ACTUALLY written, not just what the caller sent.
    const auditDetails = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(auditDetails.rollout_promoted).toBe(true);
    const effective = auditDetails.effective_updates as Record<string, unknown>;
    expect(effective.is_enabled).toBe(true);
    expect(effective.rollout_percentage).toBe(100);
    // bookkeeping columns are excluded from effective_updates
    expect('updated_by' in effective).toBe(false);
    expect('updated_at' in effective).toBe(false);
    // pre-existing keys unchanged (additive contract)
    expect(auditDetails.updates).toEqual({ enabled: true });
    expect(auditDetails.flag_name).toBe('ff_demo_v1');

    // Mirrored into the ops event context
    const opsContext = (logOpsEvent.mock.calls[0][0] as { context: Record<string, unknown> }).context;
    expect(opsContext.rollout_promoted).toBe(true);
    expect((opsContext.effective_updates as Record<string, unknown>).rollout_percentage).toBe(100);
  });

  it('enable with previous rollout 10 (deliberate ramp) → rollout is NOT touched', async () => {
    const { status, patchBody } = await runPatch({ enabled: true }, prevState(10));
    expect(status).toBe(200);
    expect(patchBody.is_enabled).toBe(true);
    expect('rollout_percentage' in patchBody).toBe(false);

    // C1: no promotion → rollout_promoted is false and effective_updates
    // carries no rollout_percentage.
    const auditDetails = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(auditDetails.rollout_promoted).toBe(false);
    expect('rollout_percentage' in (auditDetails.effective_updates as Record<string, unknown>)).toBe(false);
    const opsContext = (logOpsEvent.mock.calls[0][0] as { context: Record<string, unknown> }).context;
    expect(opsContext.rollout_promoted).toBe(false);
  });

  it('enable with an explicit rollout in the body → the body value wins over promotion', async () => {
    const { status, patchBody } = await runPatch(
      { enabled: true, rollout_percentage: 25 },
      prevState(0),
    );
    expect(status).toBe(200);
    expect(patchBody.rollout_percentage).toBe(25);

    // C1: caller-supplied rollout is NOT a promotion — the flag is false even
    // though effective_updates carries the (caller's) rollout_percentage.
    const auditDetails = logAdminAudit.mock.calls[0][4] as Record<string, unknown>;
    expect(auditDetails.rollout_promoted).toBe(false);
    expect((auditDetails.effective_updates as Record<string, unknown>).rollout_percentage).toBe(25);
  });

  it('enable with an explicit rollout of 0 → stays 0 (explicit body suppresses promotion)', async () => {
    const { status, patchBody } = await runPatch(
      { enabled: true, rollout_percentage: 0 },
      prevState(0),
    );
    expect(status).toBe(200);
    expect(patchBody.rollout_percentage).toBe(0);
  });

  it('disable → never promotes, even at previous rollout 0', async () => {
    const { status, patchBody } = await runPatch({ enabled: false }, prevState(0, true));
    expect(status).toBe(200);
    expect(patchBody.is_enabled).toBe(false);
    expect('rollout_percentage' in patchBody).toBe(false);
  });

  it('non-enabled update (description only) → never promotes', async () => {
    const { status, patchBody } = await runPatch({ description: 'copy tweak' }, prevState(0));
    expect(status).toBe(200);
    expect('rollout_percentage' in patchBody).toBe(false);
    expect('is_enabled' in patchBody).toBe(false);
  });

  it('previous-state read empty (flag row missing) → no promotion written', async () => {
    const { patchBody } = await runPatch(
      { enabled: true },
      new Response('[]', { status: 200 }),
    );
    expect('rollout_percentage' in patchBody).toBe(false);
  });

  it('previous-state read fails (500) → no promotion written', async () => {
    const { patchBody } = await runPatch(
      { enabled: true },
      new Response('error', { status: 500 }),
    );
    expect('rollout_percentage' in patchBody).toBe(false);
  });
});

// ─── POST always writes rollout_percentage explicitly ─────────────────

describe('feature-flags POST — explicit rollout_percentage (never inherits DB DEFAULT 0)', () => {
  /** fetch call #0 = uniqueness check ([] → no dupe), #1 = insert. */
  async function runPost(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/super-admin/feature-flags/route');
    const res = await POST(req('POST', body));
    const insertCall = fetchSpy.mock.calls[1] as [unknown, RequestInit] | undefined;
    return {
      status: res.status,
      insertBody: insertCall ? JSON.parse(String(insertCall[1].body)) : null,
    };
  }

  it('POST without rollout_percentage → inserts rollout_percentage 100', async () => {
    const { status, insertBody } = await runPost({ name: 'ff_demo_v1', enabled: true });
    expect(status).toBe(201);
    expect(insertBody?.rollout_percentage).toBe(100);
  });

  it('POST with a validated rollout_percentage → inserts the caller value', async () => {
    const { status, insertBody } = await runPost({
      name: 'ff_demo_v1',
      enabled: false,
      rollout_percentage: 10,
    });
    expect(status).toBe(201);
    expect(insertBody?.rollout_percentage).toBe(10);
  });

  it('POST with an explicit rollout_percentage of 0 → inserts 0 (caller value respected)', async () => {
    const { status, insertBody } = await runPost({
      name: 'ff_demo_v1',
      enabled: false,
      rollout_percentage: 0,
    });
    expect(status).toBe(201);
    expect(insertBody?.rollout_percentage).toBe(0);
  });
});

// ─── GET pagination (no silent truncation) ────────────────────────────

describe('feature-flags GET — query-param pagination, default 500, clamp 1..1000', () => {
  async function runGet(query: string): Promise<string> {
    const { GET } = await import('@/app/api/super-admin/feature-flags/route');
    const res = await GET(req('GET', undefined, query));
    expect(res.status).toBe(200);
    return String(fetchSpy.mock.calls[0][0]);
  }

  it('default request uses limit=500 and offset=0 — the old limit=100 truncation is gone', async () => {
    const url = await runGet('');
    expect(url).toContain('limit=500');
    expect(url).toContain('offset=0');
    expect(url).not.toContain('limit=100');
  });

  it('?limit above the cap is clamped to 1000', async () => {
    const url = await runGet('?limit=5000');
    expect(url).toContain('limit=1000');
  });

  it('?limit=0 is clamped up to 1', async () => {
    const url = await runGet('?limit=0');
    expect(url).toContain('limit=1&');
  });

  it('non-numeric ?limit falls back to the default 500', async () => {
    const url = await runGet('?limit=abc');
    expect(url).toContain('limit=500');
  });

  it('?offset is honoured; negative offset falls back to 0', async () => {
    expect(await runGet('?offset=40')).toContain('offset=40');
    fetchSpy.mockClear();
    expect(await runGet('?offset=-5')).toContain('offset=0');
  });
});

// ─── Flag-name regex at the route boundary ────────────────────────────

describe('feature-flags — flag-name regex /^[a-z][a-z0-9_]*$/ (route boundary)', () => {
  it.each(['ff_school_pulse_v1', 'ff_foxy_math_format_v2'])(
    'POST accepts the real flag name %s (digits are legal)',
    async (name) => {
      const { POST } = await import('@/app/api/super-admin/feature-flags/route');
      // ff_school_pulse_v1 is a PROTECTED name (constitution_pinned — see
      // @alfanumrik/lib/flags/protected-flags): creating it requires the typed
      // confirmation body field. Sending confirm=name is a no-op for the
      // non-protected name, so both cases exercise the regex boundary.
      const res = await POST(req('POST', { name, enabled: false, confirm: name }));
      expect(res.status).toBe(201);
    },
  );

  it('POST with a protected name and NO confirm → 409 FLAG_PROTECTED before any DB write', async () => {
    const { POST } = await import('@/app/api/super-admin/feature-flags/route');
    const res = await POST(req('POST', { name: 'ff_school_pulse_v1', enabled: false }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('FLAG_PROTECTED');
    expect(body.confirm_required).toBe('ff_school_pulse_v1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it.each(['1bad', 'Bad_Flag', 'bad-flag', ''])(
    'POST rejects invalid flag name %j with 400 and no DB write',
    async (name) => {
      const { POST } = await import('@/app/api/super-admin/feature-flags/route');
      const res = await POST(req('POST', { name, enabled: false }));
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(logAdminAudit).not.toHaveBeenCalled();
    },
  );

  it('PATCH rejects an invalid rename (updates.name "1bad") with 400', async () => {
    const { PATCH } = await import('@/app/api/super-admin/feature-flags/route');
    const res = await PATCH(req('PATCH', { id: FLAG_ID, updates: { name: '1bad' } }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
