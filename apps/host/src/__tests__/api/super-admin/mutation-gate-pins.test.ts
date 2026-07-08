/**
 * Phase 4 final pin cluster — gate pins for the 7 highest-blast-radius mutation
 * routes (REG-119).
 *
 * Every one of these routes ALREADY has a working auth gate (the coverage scan
 * confirmed no security hole). This file PINS the gate so a future edit can't
 * silently weaken it — a downgrade to a lower tier, a dropped level/permission
 * arg, or moving the gate after DB I/O all turn a test red.
 *
 * Strategy (mirrors rbac-elevation.test.ts + subscribers-replay.test.ts):
 *   - Mock the auth seam (`authorizeAdmin` / `authorizeSchoolAdmin`).
 *   - DENY case: gate returns its unauthorized response → assert the route
 *     returns THAT response AND the first DB/service seam is NEVER touched
 *     (short-circuit). Also assert the EXACT level/permission string the source
 *     passes — so a downgrade to a lower tier flips the test.
 *   - ALLOW case: gate returns authorized → assert the route proceeds PAST the
 *     gate (the DB/service seam IS reached). This proves the deny assertion is
 *     non-vacuous (the gate is the only thing stopping the request).
 *
 * Scope is intentionally tight: this pins the GATE, not business logic. Happy-
 * path / business-logic tests live in dedicated files where they exist.
 *
 * The seven routes (gate + exact level/permission per SOURCE):
 *   1. super-admin/rbac POST                       authorizeAdmin('super_admin')
 *   2. school-admin/rbac POST                      authorizeSchoolAdmin('institution.manage')
 *   3. super-admin/alfabot/denylist POST + DELETE  authorizeAdmin('super_admin')
 *   4. super-admin/oauth-apps POST                 authorizeAdmin('support')
 *   5. school-admin/data-export POST               authorizeSchoolAdmin(<resolved code>)
 *   6. super-admin/projectors/replay POST          authorizeAdmin('support')
 *   7. super-admin/subscribers/[name]/dead-letters/[event_id]/retry POST
 *                                                  authorizeAdmin('support')
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ─── Auth seams ──────────────────────────────────────────────────────────────
const authorizeAdmin = vi.fn();
const authorizeSchoolAdmin = vi.fn();
const logAdminAudit = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  isValidUUID: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: () => ({ apikey: 'stub', Authorization: 'Bearer stub' }),
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...args: unknown[]) => authorizeSchoolAdmin(...args),
}));

// ─── DB / service seams — each is a spy so we can assert "never touched on deny"
// and "reached on allow". The terminal shape is just enough for the route to not
// crash AFTER the gate on the allow path.
const supabaseFrom = vi.fn();
const getSupabaseAdminFn = vi.fn();
const replayForStudent = vi.fn();

/** A permissive chainable stub: every builder method returns the same proxy,
 *  and awaiting any terminal resolves to { data: [], error: null }. */
function makeChain(): unknown {
  const result = { data: [], error: null, count: 0 };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => resolve(result);
      }
      return () => proxy;
    },
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  // `denylist` and `projectors/replay` import the `supabaseAdmin` property.
  get supabaseAdmin() {
    return { from: (...a: unknown[]) => { supabaseFrom(...a); return makeChain(); } };
  },
  // `oauth-apps`, `data-export`, `dead-letters/retry` import the factory.
  getSupabaseAdmin: (...a: unknown[]) => {
    getSupabaseAdminFn(...a);
    return { from: (...b: unknown[]) => { supabaseFrom(...b); return makeChain(); } };
  },
}));

vi.mock('@alfanumrik/lib/state/subscribers/dispatcher', () => ({
  standardDispatcher: {
    replayForStudent: (...a: unknown[]) => {
      replayForStudent(...a);
      return Promise.resolve({ replayed: 0, errors: [] });
    },
  },
}));

// `data-export` resolves its permission code through this helper. We spy on it
// to (a) feed a deterministic resolved code and (b) prove the route hands that
// EXACT resolved code to the gate.
const schoolAdminPermissionCode = vi.fn();
vi.mock('@alfanumrik/lib/school-admin/permission-code', () => ({
  schoolAdminPermissionCode: (...a: unknown[]) => schoolAdminPermissionCode(...a),
}));

// Quiet infra.
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/audit', () => ({ logSchoolAudit: vi.fn() }));

const UUID = '11111111-1111-4111-8111-111111111111';

/** Deny envelope for `authorizeAdmin`: { authorized:false, response }. */
const denyAdmin = {
  authorized: false,
  response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
};
/** Allow envelope for `authorizeAdmin`. */
const allowAdmin = {
  authorized: true,
  userId: 'admin-1',
  adminId: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  adminLevel: 'super',
};
/** Deny envelope for `authorizeSchoolAdmin`: { authorized:false, errorResponse }. */
const denySchool = {
  authorized: false,
  userId: null,
  schoolId: null,
  schoolAdminId: null,
  schoolAdminRole: null,
  errorResponse: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
};
/** Allow envelope for `authorizeSchoolAdmin`. */
const allowSchool = {
  authorized: true,
  userId: 'sa-user-1',
  schoolId: UUID,
  schoolAdminId: 'sa-1',
  schoolAdminRole: 'institution_admin',
};

beforeEach(() => {
  authorizeAdmin.mockReset();
  authorizeSchoolAdmin.mockReset();
  logAdminAudit.mockReset().mockResolvedValue(undefined);
  supabaseFrom.mockReset();
  getSupabaseAdminFn.mockReset();
  replayForStudent.mockReset();
  schoolAdminPermissionCode.mockReset();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
  // A stub fetch so any accidental call on a DENY path is observable rather than
  // a network error (the super-admin/rbac + school-admin/rbac routes use fetch).
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

function req(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

// Number of fetch calls made (deny paths must make ZERO).
function fetchCallCount(): number {
  return (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. super-admin/rbac POST — authorizeAdmin('super_admin'), privilege elevation
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/super-admin/rbac — super_admin gate (privilege elevation)', () => {
  it('denies a non-super_admin and never reaches the elevation/DB seam', async () => {
    authorizeAdmin.mockResolvedValue(denyAdmin);
    const { POST } = await import('@/app/api/super-admin/rbac/route');
    const res = await POST(
      req('/api/super-admin/rbac', 'POST', {
        action: 'grant_elevation',
        userId: UUID,
        elevatedRoleId: UUID,
        reason: 'a long enough reason string',
        durationHours: 1,
      }),
    );
    expect(res.status).toBe(403);
    // EXACT level string — a downgrade to a lower tier turns this red.
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
    // Short-circuit: request body was never read (no elevation work attempted).
    expect(logAdminAudit).not.toHaveBeenCalled();
    expect(fetchCallCount()).toBe(0);
  });

  it('passes the gate past authorization when authorized (deny is non-vacuous)', async () => {
    authorizeAdmin.mockResolvedValue(allowAdmin);
    const { POST } = await import('@/app/api/super-admin/rbac/route');
    // No `action` → route falls through to "Unknown action" 400 AFTER the gate.
    const res = await POST(req('/api/super-admin/rbac', 'POST', {}));
    expect(res.status).toBe(400);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. school-admin/rbac POST — authorizeSchoolAdmin('institution.manage')
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/school-admin/rbac — institution.manage gate (tenant role elevation)', () => {
  it('denies without institution.manage and never reaches DB/service work', async () => {
    authorizeSchoolAdmin.mockResolvedValue(denySchool);
    const { POST } = await import('@/app/api/school-admin/rbac/route');
    const res = await POST(
      req('/api/school-admin/rbac', 'POST', {
        action: 'grant_elevation',
        userId: UUID,
        elevatedRoleId: UUID,
        reason: 'reason',
        durationHours: 1,
      }),
    );
    expect(res?.status).toBe(403);
    // EXACT permission code.
    expect((authorizeSchoolAdmin.mock.calls[0] as unknown[])[1]).toBe('institution.manage');
    expect(fetchCallCount()).toBe(0);
  });

  it('passes the gate when authorized (deny is non-vacuous)', async () => {
    authorizeSchoolAdmin.mockResolvedValue(allowSchool);
    const { POST } = await import('@/app/api/school-admin/rbac/route');
    // Unknown action → 400 AFTER the gate + school-context check.
    const res = await POST(req('/api/school-admin/rbac', 'POST', { action: '__none__' }));
    expect(res?.status).toBe(400);
    expect((authorizeSchoolAdmin.mock.calls[0] as unknown[])[1]).toBe('institution.manage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. super-admin/alfabot/denylist POST + DELETE — authorizeAdmin('super_admin')
// ═══════════════════════════════════════════════════════════════════════════
describe('super-admin/alfabot/denylist — super_admin gate (abuse blocklist mutation)', () => {
  it('POST denies a non-super_admin and never writes to alfabot_denylist', async () => {
    authorizeAdmin.mockResolvedValue(denyAdmin);
    const { POST } = await import('@/app/api/super-admin/alfabot/denylist/route');
    const res = await POST(
      req('/api/super-admin/alfabot/denylist', 'POST', { anonId: 'abc123', reason: 'spam' }),
    );
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('POST passes the gate when authorized (reaches the denylist write)', async () => {
    authorizeAdmin.mockResolvedValue(allowAdmin);
    const { POST } = await import('@/app/api/super-admin/alfabot/denylist/route');
    const res = await POST(
      req('/api/super-admin/alfabot/denylist', 'POST', { anonId: 'abc123', reason: 'spam' }),
    );
    expect(res.status).toBe(200);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
    expect(supabaseFrom).toHaveBeenCalledWith('alfabot_denylist');
  });

  it('DELETE denies a non-super_admin and never touches alfabot_denylist', async () => {
    authorizeAdmin.mockResolvedValue(denyAdmin);
    const { DELETE } = await import('@/app/api/super-admin/alfabot/denylist/route');
    const res = await DELETE(
      req('/api/super-admin/alfabot/denylist', 'DELETE', { anonId: 'abc123' }),
    );
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('super_admin');
    expect(supabaseFrom).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. super-admin/oauth-apps POST — authorizeAdmin('support')
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/super-admin/oauth-apps — support gate (issues OAuth client secrets)', () => {
  it('denies below the support floor and never reaches getSupabaseAdmin', async () => {
    authorizeAdmin.mockResolvedValue(denyAdmin);
    const { POST } = await import('@/app/api/super-admin/oauth-apps/route');
    const res = await POST(
      req('/api/super-admin/oauth-apps', 'POST', { action: 'approve_app', appId: UUID }),
    );
    expect(res.status).toBe(403);
    // EXACT CURRENT level — see under-leveled observation in the report.
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('support');
    expect(getSupabaseAdminFn).not.toHaveBeenCalled();
  });

  it('passes the gate when authorized (reaches getSupabaseAdmin)', async () => {
    authorizeAdmin.mockResolvedValue(allowAdmin);
    const { POST } = await import('@/app/api/super-admin/oauth-apps/route');
    const res = await POST(
      req('/api/super-admin/oauth-apps', 'POST', { action: 'approve_app', appId: UUID }),
    );
    // Proceeds past the gate (DB seam touched); status is whatever the stubbed
    // chain yields — we only assert the gate was passed + the seam reached.
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('support');
    expect(getSupabaseAdminFn).toHaveBeenCalled();
    expect(res.status).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. school-admin/data-export POST — authorizeSchoolAdmin(<resolved code>),
//    bulk student PII export (P13)
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/school-admin/data-export — export-data gate (bulk student PII, P13)', () => {
  it('denies without the export permission and runs NO export/DB work', async () => {
    schoolAdminPermissionCode.mockResolvedValue('school.export_data');
    authorizeSchoolAdmin.mockResolvedValue(denySchool);
    const { POST } = await import('@/app/api/school-admin/data-export/route');
    const res = await POST(
      req('/api/school-admin/data-export', 'POST', { type: 'students' }),
    );
    expect(res?.status).toBe(403);
    // The route authorizes against the EXACT code the resolver returned.
    expect((authorizeSchoolAdmin.mock.calls[0] as unknown[])[1]).toBe('school.export_data');
    // No export generator ran → supabase never queried.
    expect(getSupabaseAdminFn).not.toHaveBeenCalled();
    expect(supabaseFrom).not.toHaveBeenCalled();
  });

  it('hands the resolver code to the gate and proceeds when authorized', async () => {
    // Prove the route forwards whatever the resolver returns — flag-ON code path.
    schoolAdminPermissionCode.mockResolvedValue('institution.export_reports');
    authorizeSchoolAdmin.mockResolvedValue(allowSchool);
    const { POST } = await import('@/app/api/school-admin/data-export/route');
    const res = await POST(
      req('/api/school-admin/data-export', 'POST', { type: 'students' }),
    );
    expect((authorizeSchoolAdmin.mock.calls[0] as unknown[])[1]).toBe('institution.export_reports');
    // Past the gate → export generator ran → supabase queried `students`.
    expect(getSupabaseAdminFn).toHaveBeenCalled();
    expect(supabaseFrom).toHaveBeenCalledWith('students');
    expect(res?.status).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. super-admin/projectors/replay POST — authorizeAdmin('support'),
//    destructive event replay
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/super-admin/projectors/replay — support gate (destructive replay)', () => {
  it('denies below the support floor and never invokes the dispatcher', async () => {
    authorizeAdmin.mockResolvedValue(denyAdmin);
    const { POST } = await import('@/app/api/super-admin/projectors/replay/route');
    const res = await POST(
      req('/api/super-admin/projectors/replay', 'POST', {
        subscriberName: 'mastery-state-writer',
        studentId: UUID,
      }),
    );
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('support');
    expect(replayForStudent).not.toHaveBeenCalled();
  });

  it('passes the gate when authorized (reaches the dispatcher replay)', async () => {
    authorizeAdmin.mockResolvedValue(allowAdmin);
    const { POST } = await import('@/app/api/super-admin/projectors/replay/route');
    const res = await POST(
      req('/api/super-admin/projectors/replay', 'POST', {
        subscriberName: 'mastery-state-writer',
        studentId: UUID,
      }),
    );
    expect(res.status).toBe(200);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('support');
    expect(replayForStudent).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. super-admin/subscribers/[name]/dead-letters/[event_id]/retry POST —
//    authorizeAdmin('support'), dead-letter replay (re-triggers side effects)
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry — support gate', () => {
  const ctx = {
    params: Promise.resolve({ name: 'mastery-state-writer', event_id: UUID }),
  };

  it('denies below the support floor and never deletes the dead-letter row', async () => {
    authorizeAdmin.mockResolvedValue(denyAdmin);
    const { POST } = await import(
      '@/app/api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry/route'
    );
    const res = await POST(
      req(
        `/api/super-admin/subscribers/mastery-state-writer/dead-letters/${UUID}/retry`,
        'POST',
        {},
      ),
      ctx,
    );
    expect(res.status).toBe(403);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('support');
    expect(getSupabaseAdminFn).not.toHaveBeenCalled();
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('passes the gate when authorized (reaches the dead-letter delete)', async () => {
    authorizeAdmin.mockResolvedValue(allowAdmin);
    const { POST } = await import(
      '@/app/api/super-admin/subscribers/[name]/dead-letters/[event_id]/retry/route'
    );
    const res = await POST(
      req(
        `/api/super-admin/subscribers/mastery-state-writer/dead-letters/${UUID}/retry`,
        'POST',
        {},
      ),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((authorizeAdmin.mock.calls[0] as unknown[])[1]).toBe('support');
    expect(getSupabaseAdminFn).toHaveBeenCalled();
    expect(supabaseFrom).toHaveBeenCalledWith('subscriber_dead_letters');
  });
});
