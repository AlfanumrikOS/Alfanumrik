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

const OTHER_GUARDIAN_ID = '99999999-9999-4999-8999-999999999999';
const AUTH_USER_ID = '00000000-0000-4000-8000-00000000aaaa';

const holders = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpcResult: { success: true } as { success: boolean; status?: number; error?: string },
  rpcCalls: [] as Array<{ name: string; params: Record<string, unknown> }>,
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.authorize(...a),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ getAll: () => [] })),
}));

vi.mock('@supabase/ssr', () => {
  const client = {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      holders.rpcCalls.push({ name, params });
      return { data: holders.rpcResult, error: null };
    }),
  };
  return { createServerClient: vi.fn(() => client) };
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
  holders.rpcResult = { success: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.rpcResult = { success: true };
  holders.rpcCalls = [];
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
    expect(holders.rpcCalls).toHaveLength(0);
  });

  it('un-permissioned caller → returns the 403 errorResponse, no write', async () => {
    authDenied(403);
    const res = await PATCH(makePatch({ name: 'Asha Kumar' }) as never);
    expect(res.status).toBe(403);
    expect(holders.rpcCalls).toHaveLength(0);
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

    // Exactly one scoped RPC call. The DB helper resolves auth.uid(); body ids are ignored.
    expect(holders.rpcCalls).toHaveLength(1);
    expect(holders.rpcCalls[0].name).toBe('parent_update_own_profile');
    expect(holders.rpcCalls[0].params).toMatchObject({
      p_name: 'Asha Kumar',
      p_phone: null,
      p_update_name: true,
      p_update_phone: false,
    });

    // The body `id`/`guardian_id` are not written into the update payload.
    expect(holders.rpcCalls[0].params).not.toHaveProperty('id');
    expect(holders.rpcCalls[0].params).not.toHaveProperty('guardian_id');
    expect(JSON.stringify(holders.rpcCalls[0].params)).not.toContain(OTHER_GUARDIAN_ID);
  });

  it('404 when the caller has no guardian profile — no write', async () => {
    holders.authorize.mockResolvedValue({ authorized: true, userId: AUTH_USER_ID, roles: ['parent'] });
    holders.rpcResult = { success: false, status: 404, error: 'Guardian account not found' };
    const res = await PATCH(makePatch({ name: 'Asha Kumar' }) as never);
    expect(res.status).toBe(404);
    expect(holders.rpcCalls).toHaveLength(1);
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

  it('updates through a scoped parent profile RPC instead of route-level service-role writes', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/app/api/parent/profile/route.ts'),
      'utf8',
    );
    expect(src).toContain('createServerClient');
    expect(src).toContain('parent_update_own_profile');
    expect(src).not.toContain('@alfanumrik/lib/supabase-admin');
    expect(src).not.toMatch(/\.from\(['"]guardians['"]\)/);
    expect(src).not.toContain('getGuardianByAuthUserId');
  });
});
