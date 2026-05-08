import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /api/super-admin/readiness-rubric — Phase 4 of Exam-Ready 360°.
 *
 * Covers:
 *  - GET 401 unauthorized
 *  - GET happy path: returns config + defaults
 *  - GET 500 on DB error
 *  - PATCH 401 unauthorized
 *  - PATCH 400 invalid body
 *  - PATCH 400 no valid fields
 *  - PATCH 400 non-numeric value
 *  - PATCH happy path: returns updated config + defaults; emits audit log
 *  - PATCH 422 on CHECK constraint violation (tier monotonicity / weight sum)
 *  - PATCH rejects unknown fields silently (allowlist)
 */

// ── admin-auth mock ─────────────────────────────────────────────────────────
const _adminAuthImpl = vi.fn();
const _logAdminAuditImpl = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => _adminAuthImpl(...args),
  logAdminAudit: (...args: unknown[]) => _logAdminAuditImpl(...args),
}));

function setAuthorized() {
  _adminAuthImpl.mockResolvedValue({
    authorized: true,
    userId: 'admin-user-uuid',
    adminId: 'admin-id',
    email: 'admin@alfanumrik.com',
    name: 'Test Admin',
    adminLevel: 'super',
  });
}

function setUnauthorized() {
  _adminAuthImpl.mockResolvedValue({
    authorized: false,
    response: new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ── logger mock ─────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── supabaseAdmin mock ──────────────────────────────────────────────────────
let _selectResult: { data: unknown; error: unknown } = {
  data: {
    ready_mastered_ratio: 0.85,
    ready_quiz_avg: 80,
    ready_spaced_reviews: 3,
    almost_mastered_ratio: 0.70,
    almost_quiz_avg: 60,
    almost_spaced_reviews: 1,
    building_mastered_ratio: 0.40,
    building_quiz_count: 1,
    weight_mastery: 0.50,
    weight_recent_quiz: 0.30,
    weight_spaced_reviews: 0.20,
    updated_at: '2026-05-08T00:00:00Z',
    updated_by: null,
  },
  error: null,
};
let _updateResult: { data: unknown; error: unknown } = { data: null, error: null };
let _lastUpdatePayload: unknown = null;

function setSelectResult(r: { data: unknown; error: unknown }) {
  _selectResult = r;
}
function setUpdateResult(r: { data: unknown; error: unknown }) {
  _updateResult = r;
}

function chainMock() {
  const chain: Record<string, unknown> = {};
  chain['select'] = (..._args: unknown[]) => chain;
  chain['eq'] = (..._args: unknown[]) => chain;
  chain['update'] = (payload: unknown) => {
    _lastUpdatePayload = payload;
    return chain;
  };
  chain['single'] = () => Promise.resolve(_lastUpdatePayload ? _updateResult : _selectResult);
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => chainMock(),
  },
}));

function makeReq(method: 'GET' | 'PATCH', body?: unknown): NextRequest {
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest('http://localhost/api/super-admin/readiness-rubric', init);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PATCH: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _lastUpdatePayload = null;
  _selectResult = {
    data: {
      ready_mastered_ratio: 0.85,
      ready_quiz_avg: 80,
      ready_spaced_reviews: 3,
      almost_mastered_ratio: 0.70,
      almost_quiz_avg: 60,
      almost_spaced_reviews: 1,
      building_mastered_ratio: 0.40,
      building_quiz_count: 1,
      weight_mastery: 0.50,
      weight_recent_quiz: 0.30,
      weight_spaced_reviews: 0.20,
      updated_at: '2026-05-08T00:00:00Z',
      updated_by: null,
    },
    error: null,
  };
  const mod = await import('@/app/api/super-admin/readiness-rubric/route');
  GET = mod.GET;
  PATCH = mod.PATCH;
});

describe('GET /api/super-admin/readiness-rubric', () => {
  it('returns 401 when unauthorized', async () => {
    setUnauthorized();
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(401);
  });

  it('returns config + defaults for super-admin', async () => {
    setAuthorized();
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.config.ready_mastered_ratio).toBe(0.85);
    expect(body.data.defaults.ready_mastered_ratio).toBe(0.85);
  });

  it('returns 500 when DB query fails', async () => {
    setAuthorized();
    setSelectResult({ data: null, error: { message: 'DB outage' } });
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/super-admin/readiness-rubric', () => {
  it('returns 401 when unauthorized', async () => {
    setUnauthorized();
    const res = await PATCH(makeReq('PATCH', { ready_mastered_ratio: 0.9 }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for non-object body', async () => {
    setAuthorized();
    // Use NextRequest directly — null body parses to null.
    const req = new NextRequest('http://localhost/api/super-admin/readiness-rubric', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when no valid fields are supplied', async () => {
    setAuthorized();
    const res = await PATCH(makeReq('PATCH', { unknown_field: 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no valid fields/i);
  });

  it('returns 400 for non-numeric field value', async () => {
    setAuthorized();
    const res = await PATCH(makeReq('PATCH', { ready_mastered_ratio: 'high' }));
    expect(res.status).toBe(400);
  });

  it('happy path: applies updates, returns updated config, emits audit log', async () => {
    setAuthorized();
    setUpdateResult({
      data: {
        ready_mastered_ratio: 0.90,
        ready_quiz_avg: 85,
        ready_spaced_reviews: 3,
        almost_mastered_ratio: 0.70,
        almost_quiz_avg: 60,
        almost_spaced_reviews: 1,
        building_mastered_ratio: 0.40,
        building_quiz_count: 1,
        weight_mastery: 0.50,
        weight_recent_quiz: 0.30,
        weight_spaced_reviews: 0.20,
        updated_at: new Date().toISOString(),
        updated_by: 'admin-user-uuid',
      },
      error: null,
    });
    const res = await PATCH(makeReq('PATCH', { ready_mastered_ratio: 0.90, ready_quiz_avg: 85 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.config.ready_mastered_ratio).toBe(0.90);
    expect(body.data.config.ready_quiz_avg).toBe(85);

    // Audit log fired with diff
    expect(_logAdminAuditImpl).toHaveBeenCalledTimes(1);
    const auditCall = _logAdminAuditImpl.mock.calls[0];
    expect(auditCall[1]).toBe('readiness_rubric_updated');
    const meta = auditCall[4];
    expect(meta.diff.ready_mastered_ratio).toEqual({ from: 0.85, to: 0.90 });
    expect(meta.diff.ready_quiz_avg).toEqual({ from: 80, to: 85 });
  });

  it('returns 422 with detail when CHECK constraint fires', async () => {
    setAuthorized();
    setUpdateResult({
      data: null,
      error: {
        message: 'new row for relation "readiness_rubric_config" violates check constraint "chk_tier_monotone_ratio"',
      },
    });
    const res = await PATCH(makeReq('PATCH', { ready_mastered_ratio: 0.5 }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.detail).toMatch(/chk_tier_monotone_ratio/);
  });

  it('rejects unknown fields silently (allowlist)', async () => {
    setAuthorized();
    setUpdateResult({
      data: {
        ready_mastered_ratio: 0.85,
        ready_quiz_avg: 80,
        ready_spaced_reviews: 3,
        almost_mastered_ratio: 0.70,
        almost_quiz_avg: 60,
        almost_spaced_reviews: 1,
        building_mastered_ratio: 0.40,
        building_quiz_count: 1,
        weight_mastery: 0.50,
        weight_recent_quiz: 0.30,
        weight_spaced_reviews: 0.20,
        updated_at: new Date().toISOString(),
        updated_by: 'admin-user-uuid',
      },
      error: null,
    });
    // Mix of known + unknown — should accept only the known one.
    const res = await PATCH(makeReq('PATCH', { ready_quiz_avg: 82, evil_field: 999 }));
    expect(res.status).toBe(200);
    // Verify only the allowlisted field reached the update payload
    const payload = _lastUpdatePayload as Record<string, unknown>;
    expect(payload).toHaveProperty('ready_quiz_avg', 82);
    expect(payload).not.toHaveProperty('evil_field');
  });
});
