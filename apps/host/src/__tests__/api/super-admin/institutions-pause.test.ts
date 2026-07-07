/**
 * /api/super-admin/institutions/[id]/{pause,resume} — operator workflow tests.
 *
 * Pins the contract added by the pause/resume PR:
 *
 *   - 401 when authorizeAdmin denies (no DB writes).
 *   - 400 on name mismatch — the retype-name guardrail is enforced
 *     SERVER-SIDE, not just by the modal. This is the load-bearing
 *     test: dropping it would let any client skip the modal and pause
 *     a school by id.
 *   - 200 on the happy path (pause + resume).
 *   - Idempotent re-pause: still updates `paused_at`, `pause_reason`,
 *     and writes a fresh audit entry.
 *   - Audit actions: `school.paused` / `school.resumed`.
 *
 * Mocking style mirrors src/__tests__/api/super-admin/custom-domain.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── admin-auth mock (hoisted before route import) ─────────────────────

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn();

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
  // Real isValidUUID — fast regex, no reason to mock. We deliberately
  // accept the same shape the live helper does so tests don't drift.
  isValidUUID: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  supabaseAdminUrl: (table: string, params?: string) =>
    `https://stub.supabase.co/rest/v1/${table}${params ? `?${params}` : ''}`,
  supabaseAdminHeaders: (extra?: string) => ({
    apikey: 'stub',
    Authorization: 'Bearer stub',
    ...(extra ? { Prefer: extra } : {}),
  }),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── fetch mock — queues canned responses per request order ──────────

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}
let fetchCalls: FetchCall[] = [];
let fetchResponses: Array<{ ok: boolean; status: number; body: unknown }> = [];

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
  authorizeAdmin.mockReset();
  logAdminAudit.mockReset();

  authorizeAdmin.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    adminId: 'admin-1',
    email: 'ops@alfanumrik.com',
    name: 'Ops',
    adminLevel: 'super_admin',
  });
  logAdminAudit.mockResolvedValue(undefined);

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL | Request).toString();
    fetchCalls.push({ url, init });
    const r = fetchResponses.shift() ?? { ok: true, status: 200, body: [] };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

import { POST as Pause } from '@/app/api/super-admin/institutions/[id]/pause/route';
import { POST as Resume } from '@/app/api/super-admin/institutions/[id]/resume/route';

// Valid UUID used throughout; the live `isValidUUID` helper rejects
// non-UUID ids, so the tests use this canonical id.
const SCHOOL_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_NAME = 'Delhi Public School';

function makeRequest(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
  });
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// ── POST /pause ────────────────────────────────────────────────────

describe('POST /api/super-admin/institutions/[id]/pause', () => {
  it('200 happy path: flips is_active=false, sets paused_at/by/reason, audits school.paused', async () => {
    // 1st fetch: school lookup
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: SCHOOL_ID, name: SCHOOL_NAME, is_active: true }],
    });
    // 2nd fetch: PATCH apply pause
    fetchResponses.push({ ok: true, status: 200, body: [{ id: SCHOOL_ID }] });

    const res = await Pause(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/pause`, {
        reason: 'Customer requested temporary hold during contract review.',
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, schoolId: SCHOOL_ID, name: SCHOOL_NAME });

    const patch = fetchCalls.find((c) => c.init?.method === 'PATCH');
    expect(patch).toBeTruthy();
    const payload = JSON.parse(String(patch!.init!.body));
    expect(payload.is_active).toBe(false);
    expect(payload.pause_reason).toMatch(/Customer requested/);
    expect(payload.paused_by_super_admin_id).toBe('admin-1');
    expect(typeof payload.paused_at).toBe('string');

    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'school.paused',
      'school',
      SCHOOL_ID,
      expect.objectContaining({
        school_name: SCHOOL_NAME,
        reason: expect.stringMatching(/Customer requested/),
      }),
    );
  });

  it('401 when authorizeAdmin denies — no DB ops', async () => {
    const { NextResponse } = await import('next/server');
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await Pause(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/pause`, {
        reason: 'plenty of characters here',
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );

    expect(res.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('400 on name mismatch — no DB writes, no audit (SERVER-SIDE guardrail)', async () => {
    // The school lookup still runs (we need its name to compare). The
    // critical assertion is that NO PATCH fires and NO audit logs.
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: SCHOOL_ID, name: SCHOOL_NAME, is_active: true }],
    });

    const res = await Pause(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/pause`, {
        reason: 'a valid length reason here',
        expectedSchoolName: 'WRONG SCHOOL NAME',
      }),
      paramsFor(SCHOOL_ID),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/does not match/);
    expect(fetchCalls.filter((c) => c.init?.method === 'PATCH')).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('400 when reason is missing or too short', async () => {
    const res1 = await Pause(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/pause`, {
        reason: 'short',
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error).toMatch(/reason/);

    const res2 = await Pause(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/pause`, {
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );
    expect(res2.status).toBe(400);

    expect(fetchCalls).toHaveLength(0);
  });

  it('400 when expectedSchoolName is missing', async () => {
    const res = await Pause(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/pause`, {
        reason: 'long enough reason here',
      }),
      paramsFor(SCHOOL_ID),
    );
    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it('400 on invalid UUID — no DB call', async () => {
    const res = await Pause(
      makeRequest('/api/super-admin/institutions/not-a-uuid/pause', {
        reason: 'long enough reason here',
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor('not-a-uuid'),
    );
    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it('404 when school not found', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [] });

    const res = await Pause(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/pause`, {
        reason: 'long enough reason here',
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );
    expect(res.status).toBe(404);
    expect(fetchCalls.filter((c) => c.init?.method === 'PATCH')).toHaveLength(0);
  });

  it('idempotent re-pause: 200 succeeds and STILL refreshes paused_at + audits', async () => {
    // School is already paused (is_active=false). Lookup returns that
    // state; the route should still issue the PATCH (refresh timestamp
    // + new reason) and write an audit row. This guards against the
    // "skip work if already paused" optimization that would lose the
    // updated reason — operations may re-pause with a new note.
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [{ id: SCHOOL_ID, name: SCHOOL_NAME, is_active: false }],
    });
    fetchResponses.push({ ok: true, status: 200, body: [{ id: SCHOOL_ID }] });

    const res = await Pause(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/pause`, {
        reason: 'Re-pausing with a new updated reason that is long.',
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );

    expect(res.status).toBe(200);

    const patch = fetchCalls.find((c) => c.init?.method === 'PATCH');
    expect(patch).toBeTruthy();
    const payload = JSON.parse(String(patch!.init!.body));
    expect(payload.is_active).toBe(false);
    expect(payload.pause_reason).toMatch(/updated reason/);
    expect(typeof payload.paused_at).toBe('string');

    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const auditDetails = logAdminAudit.mock.calls[0][4];
    expect(auditDetails.previously_active).toBe(false);
  });
});

// ── POST /resume ───────────────────────────────────────────────────

describe('POST /api/super-admin/institutions/[id]/resume', () => {
  it('200 happy path: flips is_active=true, clears paused_* fields, audits school.resumed', async () => {
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [
        {
          id: SCHOOL_ID,
          name: SCHOOL_NAME,
          is_active: false,
          paused_at: '2026-05-10T12:00:00.000Z',
          pause_reason: 'previous reason',
        },
      ],
    });
    fetchResponses.push({ ok: true, status: 200, body: [{ id: SCHOOL_ID }] });

    const res = await Resume(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/resume`, {
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, schoolId: SCHOOL_ID, name: SCHOOL_NAME });

    const patch = fetchCalls.find((c) => c.init?.method === 'PATCH');
    expect(patch).toBeTruthy();
    const payload = JSON.parse(String(patch!.init!.body));
    expect(payload.is_active).toBe(true);
    expect(payload.paused_at).toBeNull();
    expect(payload.paused_by_super_admin_id).toBeNull();
    expect(payload.pause_reason).toBeNull();

    expect(logAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      'school.resumed',
      'school',
      SCHOOL_ID,
      expect.objectContaining({
        school_name: SCHOOL_NAME,
        previous_pause_reason: 'previous reason',
        was_paused: true,
      }),
    );
  });

  it('401 when authorizeAdmin denies — no DB ops', async () => {
    const { NextResponse } = await import('next/server');
    authorizeAdmin.mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await Resume(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/resume`, {
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );
    expect(res.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('400 on name mismatch — server-side guardrail blocks the resume', async () => {
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [
        {
          id: SCHOOL_ID,
          name: SCHOOL_NAME,
          is_active: false,
          paused_at: '2026-05-10T12:00:00.000Z',
          pause_reason: 'previous reason',
        },
      ],
    });

    const res = await Resume(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/resume`, {
        expectedSchoolName: 'WRONG NAME',
      }),
      paramsFor(SCHOOL_ID),
    );
    expect(res.status).toBe(400);
    expect(fetchCalls.filter((c) => c.init?.method === 'PATCH')).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('400 when expectedSchoolName is missing', async () => {
    const res = await Resume(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/resume`, {}),
      paramsFor(SCHOOL_ID),
    );
    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it('400 on invalid UUID', async () => {
    const res = await Resume(
      makeRequest('/api/super-admin/institutions/not-a-uuid/resume', {
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor('not-a-uuid'),
    );
    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it('404 when school not found', async () => {
    fetchResponses.push({ ok: true, status: 200, body: [] });

    const res = await Resume(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/resume`, {
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );
    expect(res.status).toBe(404);
  });

  it('idempotent re-resume: succeeds + audits even when school is already active', async () => {
    // Already active. The PATCH still fires (clears any stale paused_*
    // fields if they exist) and an audit row is written. Re-resume is
    // a safe no-effect-on-state operation; the audit trail still
    // captures the operator intent.
    fetchResponses.push({
      ok: true,
      status: 200,
      body: [
        {
          id: SCHOOL_ID,
          name: SCHOOL_NAME,
          is_active: true,
          paused_at: null,
          pause_reason: null,
        },
      ],
    });
    fetchResponses.push({ ok: true, status: 200, body: [{ id: SCHOOL_ID }] });

    const res = await Resume(
      makeRequest(`/api/super-admin/institutions/${SCHOOL_ID}/resume`, {
        expectedSchoolName: SCHOOL_NAME,
      }),
      paramsFor(SCHOOL_ID),
    );

    expect(res.status).toBe(200);
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const auditDetails = logAdminAudit.mock.calls[0][4];
    expect(auditDetails.was_paused).toBe(false);
  });
});
