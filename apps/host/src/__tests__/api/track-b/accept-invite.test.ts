/**
 * Track B, Feature 1 — POST /api/parent/accept-invite
 *
 * Contract under test:
 *   1. A valid link_code redeemed by a signed-in guardian ACTIVATES the
 *      guardian↔student link via the auth.uid()-anchored parent_accept_invite_code
 *      RPC, retires the NULL-guardian pending placeholder, and returns 200.
 *   2. Re-accept (already linked) → 200 (RPC ON CONFLICT converges) — no error.
 *   3. Invalid / unknown / expired code → generic 409 error with NO existence
 *      leak (the same generic message regardless of why).
 *   4. Auth required — no Supabase session → 401.
 *   5. No guardian profile → 403.
 *   6. P13 — the link_code never appears in clear in any logger call (truncated
 *      only); no guardian/student PII logged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Logger mock — capture every call for the P13 scan ────────────────────────
const loggerCalls: unknown[][] = [];
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (...a: unknown[]) => loggerCalls.push(['info', ...a]),
    warn: (...a: unknown[]) => loggerCalls.push(['warn', ...a]),
    error: (...a: unknown[]) => loggerCalls.push(['error', ...a]),
  },
}));

// ── createSupabaseServerClient — controls the cookie session + scoped RPC ────
const { mockAuthGetUser, mockRpc } = vi.hoisted(() => ({
  mockAuthGetUser: vi.fn(),
  mockRpc: vi.fn(),
}));
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: (...a: unknown[]) => mockAuthGetUser(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));

// ── scoped RPC state ─────────────────────────────────────────────────────────
const G_AUTH = '00000000-aaaa-4000-8000-000000000001';
const VALID_CODE = 'ABCD1234';

// ── Import route under test ──────────────────────────────────────────────────
import { POST } from '@/app/api/parent/accept-invite/route';

function authedAs(authUserId: string | null) {
  mockAuthGetUser.mockResolvedValue({
    data: { user: authUserId ? { id: authUserId } : null },
    error: null,
  });
}

function makePost(body: unknown) {
  return new Request('http://localhost/api/parent/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function scopedRpcResult(data: Record<string, unknown>, error: { message: string } | null = null) {
  mockRpc.mockResolvedValue({ data, error });
}

function allLogText(): string {
  return JSON.stringify(loggerCalls, (_k, v) => (v instanceof Error ? v.message : v));
}

beforeEach(() => {
  vi.clearAllMocks();
  loggerCalls.length = 0;
  scopedRpcResult({ success: true, link_id: 'link-9', student_name: 'Asha' });
});

describe('POST /api/parent/accept-invite — service-role migration guard', () => {
  it('does not import the service-role admin client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/parent/accept-invite/route.ts'),
      'utf8'
    );

    expect(source).not.toContain('@alfanumrik/lib/supabase-admin');
    expect(source).toContain("rpc('parent_accept_invite_code'");
  });

  it('ships an auth.uid()-anchored invite-acceptance RPC migration', () => {
    const migrationPath = join(
      process.cwd(),
      '../../supabase/migrations/20260710160000_xc3_parent_accept_invite_rpc.sql'
    );
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.parent_accept_invite_code/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).not.toMatch(/p_guardian_auth_id/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.parent_accept_invite_code/i);
  });
});

describe('POST /api/parent/accept-invite', () => {
  it('valid link_code activates the guardian↔student link and retires the pending placeholder (200)', async () => {
    authedAs(G_AUTH);
    const res = await POST(makePost({ link_code: VALID_CODE }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.linked).toBe(true);
    expect(json.data.studentName).toBe('Asha');

    expect(mockRpc).toHaveBeenCalledWith('parent_accept_invite_code', {
      p_invite_code: VALID_CODE,
    });
  });

  it('re-accept (already linked) still returns 200 — the RPC ON CONFLICT path converges', async () => {
    authedAs(G_AUTH);
    // RPC reports success on re-accept (ON CONFLICT → approved).
    scopedRpcResult({ success: true, link_id: 'link-9', student_name: 'Asha' });

    await POST(makePost({ link_code: VALID_CODE }) as never);
    const res = await POST(makePost({ link_code: VALID_CODE }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.linked).toBe(true);
  });

  it('invalid/unknown/expired code → generic 409, no existence leak', async () => {
    authedAs(G_AUTH);
    // RPC domain-rejects (invalid/expired/self-link) → success !== true.
    scopedRpcResult({ success: false, error_code: 'invalid_or_expired', error: 'Invalid or expired invite code' });

    const res = await POST(makePost({ link_code: 'ZZZZ9999' }) as never);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    // Generic message — does not reveal whether the code exists for some other
    // guardian/student. (We don't assert exact copy, only that it 409s uniformly.)
    expect(typeof json.error).toBe('string');
  });

  it('returns 401 when there is no Supabase session', async () => {
    authedAs(null);
    const res = await POST(makePost({ link_code: VALID_CODE }) as never);
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no guardian profile', async () => {
    authedAs(G_AUTH);
    scopedRpcResult({ success: false, error_code: 'no_guardian' });
    const res = await POST(makePost({ link_code: VALID_CODE }) as never);
    expect(res.status).toBe(403);
    expect(mockRpc).toHaveBeenCalledWith('parent_accept_invite_code', {
      p_invite_code: VALID_CODE,
    });
  });

  it('returns 400 when link_code is missing/blank', async () => {
    authedAs(G_AUTH);
    const res = await POST(makePost({ link_code: '   ' }) as never);
    expect(res.status).toBe(400);
  });

  // ── P13 — link_code never logged in clear ──────────────────────────────────
  it('P13: the full link_code never appears in clear in any logger call (truncated only)', async () => {
    authedAs(G_AUTH);
    await POST(makePost({ link_code: VALID_CODE }) as never);

    const text = allLogText();
    // The success log fires (codeTruncated only).
    expect(text).toContain('accept_invite_linked');
    // The full code must never appear; the truncated form (ABCD****) may.
    expect(text).not.toContain(VALID_CODE);
    expect(text).toContain('ABCD****');
  });
});
