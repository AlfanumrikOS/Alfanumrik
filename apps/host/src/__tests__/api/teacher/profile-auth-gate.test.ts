/**
 * T5 (teacher-dashboard deep RCA) — `PATCH /api/teacher/profile` RBAC gate +
 * self-scope. The route previously hand-parsed a Bearer token via
 * `supabaseAdmin.auth.getUser(token)` with NO `authorizeRequest` call at all —
 * every sibling teacher route (`class.manage`, `class.assign_remediation`)
 * goes through the standard RBAC layer. It now gates on
 * `authorizeRequest(request, 'profile.update_own')` — the SAME already-granted
 * permission code the sibling `parent`/`student` profile routes use (granted
 * to the teacher role in 20260612123200_rbac_matrix_conformance.sql) — so no
 * new permission code or migration was introduced.
 *
 * Pins:
 *   1. Unauthenticated caller → the authorizeRequest 401 errorResponse; the
 *      teacher lookup is never reached and no write is issued.
 *   2. Authenticated non-teacher caller (any role without a `teachers` row,
 *      e.g. student/parent) → getTeacherByAuthUserId resolves no row → 404,
 *      no write. (This mirrors the sibling parent-profile "account not found"
 *      contract exactly — see profile-auth-gate.test.ts for parent — rather
 *      than inventing a new 403-for-role-mismatch behavior that no sibling
 *      profile route implements.)
 *   3. Authenticated teacher → update targets the teacher id RESOLVED FROM
 *      auth.userId. A body-supplied id can NOT retarget another teacher's row
 *      (no IDOR).
 *   4. Source contract: the route calls authorizeRequest with the exact
 *      already-granted permission code (no new permission introduced), and the
 *      legacy hand-rolled bearer parse is gone.
 *
 * Invariants: P9 (RBAC enforcement on a mutating teacher route), P13 (self-scope).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const OTHER_TEACHER_ID = '99999999-9999-4999-8999-999999999999';
const TEACHER_ID = '11111111-1111-4111-8111-111111111111';
const AUTH_USER_ID = '00000000-0000-4000-8000-00000000aaaa';

const holders = vi.hoisted(() => ({
  authorize: vi.fn(),
  getTeacherByAuthUserId: vi.fn(),
  updateEq: vi.fn(),
  updateCalls: [] as Array<{ payload: Record<string, unknown> }>,
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.authorize(...a),
}));

vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getTeacherByAuthUserId: (...a: unknown[]) => holders.getTeacherByAuthUserId(...a),
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      update: vi.fn((payload: Record<string, unknown>) => {
        holders.updateCalls.push({ payload });
        return { eq: holders.updateEq };
      }),
    })),
  },
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PATCH } from '@/app/api/teacher/profile/route';

function makePatch(body: unknown) {
  return new Request('http://localhost/api/teacher/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authDenied(status: number) {
  holders.authorize.mockResolvedValue({
    authorized: false,
    userId: null,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: status === 401 ? 'Unauthorized' : 'Forbidden' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

function authAsTeacher() {
  holders.authorize.mockResolvedValue({ authorized: true, userId: AUTH_USER_ID, roles: ['teacher'] });
  holders.getTeacherByAuthUserId.mockResolvedValue({ ok: true, data: { id: TEACHER_ID } });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.updateCalls = [];
  holders.updateEq.mockResolvedValue({ error: null });
});

describe('PATCH /api/teacher/profile — RBAC gate (P9)', () => {
  it('asks authorizeRequest for the already-granted profile.update_own permission', async () => {
    authAsTeacher();
    await PATCH(makePatch({ name: 'Anita Rao' }) as never);
    expect(holders.authorize).toHaveBeenCalledTimes(1);
    expect(holders.authorize.mock.calls[0][1]).toBe('profile.update_own');
  });

  it('unauthenticated → returns the 401 errorResponse, no teacher lookup, no write', async () => {
    authDenied(401);
    const res = await PATCH(makePatch({ name: 'Anita Rao' }) as never);
    expect(res.status).toBe(401);
    expect(holders.getTeacherByAuthUserId).not.toHaveBeenCalled();
    expect(holders.updateCalls).toHaveLength(0);
  });

  it('un-permissioned caller → returns the 403 errorResponse, no write', async () => {
    authDenied(403);
    const res = await PATCH(makePatch({ name: 'Anita Rao' }) as never);
    expect(res.status).toBe(403);
    expect(holders.updateCalls).toHaveLength(0);
  });

  it('authenticated caller with no teacher profile (non-teacher role) → 404, no write', async () => {
    holders.authorize.mockResolvedValue({ authorized: true, userId: AUTH_USER_ID, roles: ['student'] });
    holders.getTeacherByAuthUserId.mockResolvedValue({ ok: true, data: null });
    const res = await PATCH(makePatch({ name: 'Anita Rao' }) as never);
    expect(res.status).toBe(404);
    expect(holders.updateCalls).toHaveLength(0);
  });
});

describe('PATCH /api/teacher/profile — self-scope (P13, no IDOR)', () => {
  it('updates ONLY the caller-resolved teacher id, ignoring a body-supplied id', async () => {
    authAsTeacher();
    const res = await PATCH(
      // Attacker tries to retarget another teacher via body fields.
      makePatch({ id: OTHER_TEACHER_ID, teacher_id: OTHER_TEACHER_ID, name: 'Anita Rao' }) as never,
    );
    expect(res.status).toBe(200);

    expect(holders.updateCalls).toHaveLength(1);
    expect(holders.updateCalls[0].payload).toEqual({ name: 'Anita Rao' });
    expect(holders.updateEq).toHaveBeenCalledWith('id', TEACHER_ID);
    expect(holders.updateEq).not.toHaveBeenCalledWith('id', OTHER_TEACHER_ID);
  });

  it('updates school_name when provided', async () => {
    authAsTeacher();
    const res = await PATCH(makePatch({ school_name: 'Delhi Public School' }) as never);
    expect(res.status).toBe(200);
    expect(holders.updateCalls[0].payload).toEqual({ school_name: 'Delhi Public School' });
  });
});

describe('PATCH /api/teacher/profile — source contract', () => {
  it('gates on authorizeRequest(request, "profile.update_own") (no new permission code)', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/teacher/profile/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/authorizeRequest\(\s*request\s*,\s*['"]profile\.update_own['"]\s*\)/);
    // The legacy hand-rolled bearer parse must be gone.
    expect(src).not.toMatch(/auth\.getUser\(token\)/);
  });
});
