/**
 * PP-4 — `PATCH /api/parent/profile` RBAC gate + self-scope (engineering-audit
 * Cycle 7). The route previously hand-parsed a Bearer token with no
 * `authorizeRequest`. It now gates on `authorizeRequest(request,
 * 'profile.update_own')` (a permission already granted to the parent role) and
 * keeps the update scoped to the caller's OWN guardian row.
 *
 * Pins:
 *   1. Unauthenticated / un-permissioned caller → the authorizeRequest
 *      errorResponse (401 / 403); the guardian lookup is never reached and no
 *      write is issued.
 *   2. Authenticated parent with `profile.update_own` → update targets the
 *      guardian id RESOLVED FROM auth.userId. A body-supplied `id` /
 *      `guardian_id` can NOT retarget another guardian's row (no IDOR).
 *   3. Source contract: the route calls authorizeRequest with the exact
 *      already-granted permission code (no new permission introduced).
 *
 * Invariants: P9 (RBAC enforcement on a mutating parent route), P13 (self-scope).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const OWN_GUARDIAN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_GUARDIAN_ID = '99999999-9999-4999-8999-999999999999';
const AUTH_USER_ID = '00000000-0000-4000-8000-00000000aaaa';

const holders = vi.hoisted(() => ({
  authorize: vi.fn(),
  guardianByAuth: vi.fn(),
  // Records every update issued against `guardians`.
  updates: [] as Array<{ payload: Record<string, unknown>; targetId: unknown }>,
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.authorize(...a),
}));

vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.guardianByAuth(...a),
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const client = {
    from: (_table: string) => ({
      update: (payload: Record<string, unknown>) => ({
        eq: (_col: string, targetId: unknown) => {
          holders.updates.push({ payload, targetId });
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
  };
  return { supabaseAdmin: client, getSupabaseAdmin: () => client };
});

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PATCH } from '@/app/api/parent/profile/route';

function makePatch(body: unknown) {
  return new Request('http://localhost/api/parent/profile', {
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

function authAsParent() {
  holders.authorize.mockResolvedValue({ authorized: true, userId: AUTH_USER_ID, roles: ['parent'] });
  holders.guardianByAuth.mockResolvedValue({ ok: true, data: { id: OWN_GUARDIAN_ID } });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.updates = [];
});

describe('PATCH /api/parent/profile — RBAC gate (PP-4 / P9)', () => {
  it('asks authorizeRequest for the already-granted profile.update_own permission', async () => {
    authAsParent();
    await PATCH(makePatch({ name: 'Asha Kumar' }) as never);
    expect(holders.authorize).toHaveBeenCalledTimes(1);
    expect(holders.authorize.mock.calls[0][1]).toBe('profile.update_own');
  });

  it('unauthenticated → returns the 401 errorResponse, no guardian lookup, no write', async () => {
    authDenied(401);
    const res = await PATCH(makePatch({ name: 'Asha Kumar' }) as never);
    expect(res.status).toBe(401);
    expect(holders.guardianByAuth).not.toHaveBeenCalled();
    expect(holders.updates).toHaveLength(0);
  });

  it('un-permissioned caller → returns the 403 errorResponse, no write', async () => {
    authDenied(403);
    const res = await PATCH(makePatch({ name: 'Asha Kumar' }) as never);
    expect(res.status).toBe(403);
    expect(holders.updates).toHaveLength(0);
  });
});

describe('PATCH /api/parent/profile — self-scope (PP-4 / P13, no IDOR)', () => {
  it('updates ONLY the caller-resolved guardian id, ignoring a body-supplied id/guardian_id', async () => {
    authAsParent();
    const res = await PATCH(
      // Attacker tries to retarget another guardian via body fields.
      makePatch({ id: OTHER_GUARDIAN_ID, guardian_id: OTHER_GUARDIAN_ID, name: 'Asha Kumar' }) as never,
    );
    expect(res.status).toBe(200);

    // Guardian resolved from the verified auth.userId — never from the body.
    expect(holders.guardianByAuth).toHaveBeenCalledWith(AUTH_USER_ID);

    // Exactly one write, targeting the OWN guardian id.
    expect(holders.updates).toHaveLength(1);
    expect(holders.updates[0].targetId).toBe(OWN_GUARDIAN_ID);
    expect(holders.updates[0].targetId).not.toBe(OTHER_GUARDIAN_ID);

    // The body `id`/`guardian_id` are not written into the update payload.
    expect(holders.updates[0].payload).not.toHaveProperty('id');
    expect(holders.updates[0].payload).not.toHaveProperty('guardian_id');
    expect(holders.updates[0].payload).toMatchObject({ name: 'Asha Kumar' });
  });

  it('404 when the caller has no guardian profile — no write', async () => {
    holders.authorize.mockResolvedValue({ authorized: true, userId: AUTH_USER_ID, roles: ['parent'] });
    holders.guardianByAuth.mockResolvedValue({ ok: true, data: null });
    const res = await PATCH(makePatch({ name: 'Asha Kumar' }) as never);
    expect(res.status).toBe(404);
    expect(holders.updates).toHaveLength(0);
  });
});

describe('PATCH /api/parent/profile — source contract', () => {
  it('gates on authorizeRequest(request, "profile.update_own") (no new permission code)', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/parent/profile/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/authorizeRequest\(\s*request\s*,\s*['"]profile\.update_own['"]\s*\)/);
    // The legacy hand-rolled bearer parse must be gone.
    expect(src).not.toMatch(/auth\.getUser\(token\)/);
  });
});
