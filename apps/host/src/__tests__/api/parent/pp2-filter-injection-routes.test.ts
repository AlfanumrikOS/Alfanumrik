/**
 * PP-2 (route-level) — an injection-shaped `link_code` is rejected by the
 * `isValidLinkCode` guard BEFORE it can reach the PostgREST `.or()` filter, in
 * the two Next.js call sites (engineering-audit Cycle 7):
 *
 *   - request-otp  → enumeration-safe silentSuccess (200), no student lookup,
 *                    no challenge, audited as `link_code_otp_request_invalid_format`.
 *   - accept-invite → generic 409, the redeem RPC is NOT invoked and the
 *                     `.from('students').or(...)` lookup is NEVER reached with
 *                     the raw payload.
 *
 * These pin that the raw, attacker-controlled string never reaches a query
 * (P8 RLS boundary / P13 — a widened filter could match another family's child).
 * The validator itself (charset + parity) is unit-pinned in
 * security/parent-link-code-injection.test.ts.
 *
 * Mocking follows the established parent-route pattern (api/link-code-otp.test.ts
 * + api/track-b/accept-invite.test.ts): supabase-server controls the session,
 * supabase-admin is a tiny in-memory client that RECORDS every `.from(table)`
 * and `.rpc()` so we can prove the DB was (not) reached. `@alfanumrik/lib/sanitize` is NOT
 * mocked — the real validator runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const AUTH_USER_ID = '00000000-0000-4000-8000-00000000aaaa';

const holders = vi.hoisted(() => ({
  session: null as { id: string; email: string } | null,
  tablesTouched: [] as string[],
  orFiltersSeen: [] as string[],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  auditEvents: [] as string[],
  challengesInserted: 0,
  guardians: [{ id: 'g-1', auth_user_id: '00000000-0000-4000-8000-00000000aaaa' }],
}));

// ── supabase-server (cookie session) ───────────────────────────────────────
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: holders.session ? { id: holders.session.id, email: holders.session.email } : null },
        error: holders.session ? null : { message: 'no session' },
      }),
    },
  }),
}));

// ── supabase-admin — records table access + rpc, never widens on injection ──
vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function makeChain(table: string) {
    holders.tablesTouched.push(table);
    const chain: Record<string, unknown> = {
      select: () => chain,
      or: (expr: string) => {
        holders.orFiltersSeen.push(expr);
        return chain;
      },
      eq: () => chain,
      is: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (table === 'guardians') {
          return { data: holders.guardians[0] ?? null, error: null };
        }
        return { data: null, error: null }; // students lookup: no match
      },
      insert: (row: Record<string, unknown>) => {
        if (table === 'auth_audit_log') {
          holders.auditEvents.push(String(row.event_type));
          return Promise.resolve({ data: null, error: null });
        }
        if (table === 'link_code_otp_challenges') {
          holders.challengesInserted += 1;
          return {
            select: () => ({ single: async () => ({ data: { id: 'chal-1' }, error: null }) }),
          };
        }
        return Promise.resolve({ data: null, error: null });
      },
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
      then: (onF: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onF),
    };
    return chain;
  }
  const client = {
    from: (t: string) => makeChain(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      holders.rpcCalls.push({ name, args });
      return Promise.resolve({ data: { success: true, link_id: 'l-1' }, error: null });
    },
  };
  return { supabaseAdmin: client, getSupabaseAdmin: () => client };
});

vi.mock('@alfanumrik/lib/api-rate-limit', () => ({
  checkApiRateLimit: async () => ({ allowed: true, remaining: 4, resetAt: Math.floor(Date.now() / 1000) + 60 }),
}));

vi.mock('@alfanumrik/lib/email-delivery', () => ({
  deliverEmail: async () => ({ sent: true, id: 'm1' }),
  pickLocaleFromAcceptLanguage: () => 'en',
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST as requestOtp } from '@/app/api/parent/link-code/request-otp/route';
import { POST as acceptInvite } from '@/app/api/parent/accept-invite/route';

function makeReq(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

const INJECTION = 'A,deleted_at.is.null';

beforeEach(() => {
  vi.clearAllMocks();
  holders.session = { id: AUTH_USER_ID, email: 'parent@example.com' };
  holders.tablesTouched = [];
  holders.orFiltersSeen = [];
  holders.rpcCalls = [];
  holders.auditEvents = [];
  holders.challengesInserted = 0;
  holders.guardians = [{ id: 'g-1', auth_user_id: AUTH_USER_ID }];
});

describe('PP-2 request-otp — injection code is rejected before the .or() lookup', () => {
  it('returns the enumeration-safe silentSuccess (200), never queries students, inserts no challenge', async () => {
    const res = await requestOtp(
      makeReq('http://localhost/api/parent/link-code/request-otp', { link_code: INJECTION }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Indistinguishable from a valid-but-unknown code (no enumeration channel).
    expect(body).toMatchObject({ success: true, otp_sent: true });

    // THE PIN: the raw payload never reached the students table or any .or() filter.
    expect(holders.tablesTouched).not.toContain('students');
    expect(holders.orFiltersSeen).toHaveLength(0);
    expect(holders.challengesInserted).toBe(0);

    // It IS audited with the dedicated invalid-format event (operators can spot probes).
    expect(holders.auditEvents).toContain('link_code_otp_request_invalid_format');
  });

  it('a valid-format code DOES reach the students .or() lookup (guard is not over-broad)', async () => {
    const res = await requestOtp(
      makeReq('http://localhost/api/parent/link-code/request-otp', { link_code: 'ABC123' }) as never,
    );
    expect(res.status).toBe(200);
    expect(holders.tablesTouched).toContain('students');
    expect(holders.orFiltersSeen[0]).toBe('invite_code.eq.ABC123,link_code.eq.ABC123');
  });
});

describe('PP-2 accept-invite — injection code is rejected before RPC + students lookup', () => {
  it('returns generic 409, does NOT invoke the redeem RPC, never reaches the students .or()', async () => {
    const res = await acceptInvite(
      makeReq('http://localhost/api/parent/accept-invite', { link_code: INJECTION }) as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string'); // generic — no leak about which check failed
    // The full injection payload is not echoed back.
    expect(JSON.stringify(body)).not.toContain('deleted_at');

    // THE PIN: no RPC, no students lookup, no `.or()` with the raw payload.
    expect(holders.rpcCalls).toHaveLength(0);
    expect(holders.tablesTouched).not.toContain('students');
    expect(holders.orFiltersSeen).toHaveLength(0);
  });

  it('a valid-format code DOES flow through to the redeem RPC (guard is not over-broad)', async () => {
    const res = await acceptInvite(
      makeReq('http://localhost/api/parent/accept-invite', { link_code: 'ABCD1234' }) as never,
    );
    expect(res.status).toBe(200);
    expect(holders.rpcCalls.map((c) => c.name)).toContain('link_guardian_via_invite_code');
    expect(holders.rpcCalls[0].args).toMatchObject({ p_invite_code: 'ABCD1234' });
  });
});
