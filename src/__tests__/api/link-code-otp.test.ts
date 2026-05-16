/**
 * /api/parent/link-code/request-otp + /redeem — Phase D.4 contract tests.
 *
 * What these tests pin:
 *
 *   request-otp:
 *     1. Returns 200 + otp_sent:true for a valid code (happy path).
 *     2. Returns 200 + otp_sent:true even when the link code matches no
 *        student — no enumeration channel.
 *     3. Returns 429 once the per-IP limit is exceeded.
 *     4. Audits every outcome to auth_audit_log.
 *     5. 401 when the caller has no session.
 *
 *   redeem:
 *     6. Happy path: correct OTP → success:true, deletes the challenge,
 *        invokes link_guardian_to_student_via_code.
 *     7. Wrong OTP increments attempt_count and returns 401 + remaining.
 *     8. 5th wrong OTP locks the row for 1 hour and returns 423 next call.
 *     9. Expired challenge → 401 with an expired-specific event.
 *    10. Locked challenge → 423 even with the correct OTP.
 *    11. No challenge for caller → 401 (NOT 200 — there's nothing to leak
 *        because the user is already authenticated).
 *    12. Audits every attempt regardless of outcome.
 *
 * All Supabase interactions are intercepted. We model the
 * link_code_otp_challenges + auth_audit_log + students + guardians tables
 * as in-memory objects and replay them through a chainable mock client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashOtp } from '@/lib/link-code-otp';

// ── Mock fixtures ─────────────────────────────────────────────────────────
const AUTH_USER_ID = '00000000-0000-0000-0000-00000000aaaa';
const STUDENT_ID = '00000000-0000-0000-0000-00000000bbbb';
const GUARDIAN_ID = '00000000-0000-0000-0000-00000000cccc';
const LINK_CODE = 'ABC123';

// Holders for the mocks. vi.mock factories run before any top-level code in
// this file, so `state` must be created via vi.hoisted() to be in scope.
const holders = vi.hoisted(() => ({
  // Mutable DB state.
  state: {
    challenges: [] as Array<{
      id: string;
      link_code: string;
      auth_user_id: string;
      student_id: string | null;
      otp_hash: string;
      expires_at: string;
      attempt_count: number;
      locked_until: string | null;
      created_at: string;
    }>,
    students: [] as Array<{
      id: string;
      name: string;
      invite_code: string;
      link_code: string | null;
      is_active: boolean;
    }>,
    guardians: [] as Array<{ id: string; auth_user_id: string }>,
    auditLog: [] as Array<Record<string, unknown>>,
    // Auth state.
    session: null as { id: string; email: string } | null,
    // RPC behaviour.
    rpcResult: { data: { success: true, student_name: 'Aanya', student_grade: '8' } as unknown, error: null as { message: string } | null },
  },
  // Rate-limit mock state: per key, count of calls.
  rateLimit: {
    counts: new Map<string, number>(),
    // When set, the next call to checkApiRateLimit returns allowed:false
    // regardless of count. Used to simulate the limit being hit.
    forceDeny: false,
  },
  // Email-delivery spy.
  emailCalls: [] as Array<{ template: string; to: string; params: Record<string, unknown> }>,
}));

// ── Mock supabase admin ───────────────────────────────────────────────────
vi.mock('@/lib/supabase-admin', () => {
  const chain = {
    from(table: string) {
      const state = holders.state;
      if (table === 'students') {
        return {
          select: () => ({
            or: (filter: string) => ({
              eq: (_col: string, _val: unknown) => ({
                maybeSingle: () => {
                  // filter looks like `invite_code.eq.ABC123,link_code.eq.ABC123`
                  const m = filter.match(/invite_code\.eq\.([^,]+)/);
                  const codeWanted = m ? m[1] : '';
                  const found = state.students.find(
                    (s) =>
                      (s.invite_code === codeWanted || s.link_code === codeWanted) && s.is_active,
                  );
                  return Promise.resolve({ data: found ?? null, error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'guardians') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: state.guardians.find((g) => g.auth_user_id === val) ?? null,
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'link_code_otp_challenges') {
        return {
          insert: (row: Record<string, unknown>) => {
            const id = `chal-${state.challenges.length + 1}`;
            const inserted = {
              id,
              link_code: row.link_code as string,
              auth_user_id: row.auth_user_id as string,
              student_id: (row.student_id as string | null) ?? null,
              otp_hash: row.otp_hash as string,
              expires_at: row.expires_at as string,
              attempt_count: (row.attempt_count as number | undefined) ?? 0,
              locked_until: (row.locked_until as string | null | undefined) ?? null,
              created_at: new Date().toISOString(),
            };
            state.challenges.push(inserted);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id }, error: null }),
              }),
            };
          },
          select: () => ({
            eq: (_c1: string, v1: string) => ({
              eq: (_c2: string, v2: string) => ({
                gte: (_c3: string, _v3: string) => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: () => {
                        // request-otp cooldown check: link_code + auth_user_id + created_at >= cooldownIso
                        const found = state.challenges
                          .filter((c) => c.link_code === v1 && c.auth_user_id === v2)
                          .slice(-1)[0];
                        return Promise.resolve({ data: found ?? null, error: null });
                      },
                    }),
                  }),
                }),
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => {
                      // redeem lookup: link_code + auth_user_id, most recent
                      const found = state.challenges
                        .filter((c) => c.link_code === v1 && c.auth_user_id === v2)
                        .slice(-1)[0];
                      return Promise.resolve({ data: found ?? null, error: null });
                    },
                  }),
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              const target = state.challenges.find((c) => c.id === id);
              if (target) Object.assign(target, patch);
              return Promise.resolve({ data: null, error: null });
            },
          }),
          delete: () => ({
            eq: (_col: string, id: string) => {
              state.challenges = state.challenges.filter((c) => c.id !== id);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === 'auth_audit_log') {
        return {
          insert: (row: Record<string, unknown>) => {
            state.auditLog.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unmocked table: ${table}`);
    },
    rpc: (name: string, _args: Record<string, unknown>) => {
      if (name === 'link_guardian_to_student_via_code') {
        return Promise.resolve(holders.state.rpcResult);
      }
      throw new Error(`unmocked rpc: ${name}`);
    },
  };
  return { supabaseAdmin: chain, getSupabaseAdmin: () => chain };
});

// ── Mock supabase server (session) ────────────────────────────────────────
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      auth: {
        getUser: () => {
          const s = holders.state.session;
          return Promise.resolve({
            data: { user: s ? { id: s.id, email: s.email } : null },
            error: s ? null : { message: 'no session' },
          });
        },
      },
    }),
}));

// ── Mock rate limiter ──────────────────────────────────────────────────────
vi.mock('@/lib/api-rate-limit', () => ({
  checkApiRateLimit: (key: string, limit: number, _windowMs: number) => {
    if (holders.rateLimit.forceDeny) {
      return Promise.resolve({ allowed: false, remaining: 0, resetAt: Math.floor(Date.now() / 1000) + 60 });
    }
    const next = (holders.rateLimit.counts.get(key) ?? 0) + 1;
    holders.rateLimit.counts.set(key, next);
    return Promise.resolve({
      allowed: next <= limit,
      remaining: Math.max(0, limit - next),
      resetAt: Math.floor(Date.now() / 1000) + 60,
    });
  },
}));

// ── Mock email delivery ────────────────────────────────────────────────────
vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: (input: { template: string; to: string; params: Record<string, unknown> }) => {
    holders.emailCalls.push(input);
    return Promise.resolve({ sent: true, id: `msg-${holders.emailCalls.length}` });
  },
  pickLocaleFromAcceptLanguage: () => 'en',
}));

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Import routes AFTER mocks ──────────────────────────────────────────────
import { POST as requestOtpRoute } from '@/app/api/parent/link-code/request-otp/route';
import { POST as redeemRoute } from '@/app/api/parent/link-code/redeem/route';
import type { NextRequest } from 'next/server';

// ── Helpers ────────────────────────────────────────────────────────────────
function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/parent/link-code/x', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.5',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function signIn() {
  holders.state.session = { id: AUTH_USER_ID, email: 'parent@example.com' };
}

function seedStudent() {
  holders.state.students.push({
    id: STUDENT_ID,
    name: 'Aanya',
    invite_code: LINK_CODE,
    link_code: null,
    is_active: true,
  });
}

function seedGuardian() {
  holders.state.guardians.push({ id: GUARDIAN_ID, auth_user_id: AUTH_USER_ID });
}

function lastAuditEvent(): string {
  const last = holders.state.auditLog.slice(-1)[0];
  return (last?.event_type as string) ?? '';
}

beforeEach(() => {
  holders.state.challenges = [];
  holders.state.students = [];
  holders.state.guardians = [];
  holders.state.auditLog = [];
  holders.state.session = null;
  holders.state.rpcResult = {
    data: { success: true, student_name: 'Aanya', student_grade: '8' } as unknown,
    error: null,
  };
  holders.rateLimit.counts.clear();
  holders.rateLimit.forceDeny = false;
  holders.emailCalls = [];
});

// ─────────────────────────────────────────────────────────────────────────
//   request-otp
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/parent/link-code/request-otp', () => {
  it('returns 401 when there is no session', async () => {
    const res = await requestOtpRoute(makeReq({ link_code: LINK_CODE }));
    expect(res.status).toBe(401);
  });

  it('happy path: returns 200 + otp_sent, creates a challenge, sends an email', async () => {
    signIn();
    seedStudent();
    const res = await requestOtpRoute(makeReq({ link_code: LINK_CODE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.otp_sent).toBe(true);
    expect(holders.state.challenges).toHaveLength(1);
    expect(holders.emailCalls).toHaveLength(1);
    expect(holders.emailCalls[0].template).toBe('parent-link-code-otp');
    expect(holders.emailCalls[0].to).toBe('parent@example.com');
    expect(lastAuditEvent()).toBe('link_code_otp_request_success');
  });

  it('returns 200 + otp_sent even when the link code matches no student (no enumeration)', async () => {
    signIn();
    // No seedStudent() — code resolves to nothing.
    const res = await requestOtpRoute(makeReq({ link_code: 'ZZZ999' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.otp_sent).toBe(true);
    // No challenge inserted, no email sent.
    expect(holders.state.challenges).toHaveLength(0);
    expect(holders.emailCalls).toHaveLength(0);
    // BUT we still audited the attempt so operators can detect brute-force.
    expect(lastAuditEvent()).toBe('link_code_otp_request_no_match');
  });

  it('returns 429 when the per-IP rate limit is exceeded', async () => {
    signIn();
    seedStudent();
    holders.rateLimit.forceDeny = true;
    const res = await requestOtpRoute(makeReq({ link_code: LINK_CODE }));
    expect(res.status).toBe(429);
    expect(lastAuditEvent()).toBe('link_code_otp_request_rate_limited');
  });

  it('returns 400 when the body is missing link_code', async () => {
    signIn();
    const res = await requestOtpRoute(makeReq({}));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//   redeem
// ─────────────────────────────────────────────────────────────────────────
describe('POST /api/parent/link-code/redeem', () => {
  function insertChallenge(opts: {
    otp: string;
    attempt_count?: number;
    expires_at?: string;
    locked_until?: string | null;
  }) {
    const id = `chal-1`;
    holders.state.challenges.push({
      id,
      link_code: LINK_CODE,
      auth_user_id: AUTH_USER_ID,
      student_id: STUDENT_ID,
      otp_hash: hashOtp(opts.otp, id),
      expires_at: opts.expires_at ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      attempt_count: opts.attempt_count ?? 0,
      locked_until: opts.locked_until ?? null,
      created_at: new Date().toISOString(),
    });
    return id;
  }

  it('returns 401 when there is no session', async () => {
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '123456' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when the otp body is malformed', async () => {
    signIn();
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: 'abc' }));
    expect(res.status).toBe(400);
  });

  it('happy path: correct OTP -> 200, deletes the challenge, invokes the RPC, audits success', async () => {
    signIn();
    seedGuardian();
    insertChallenge({ otp: '654321' });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.linked).toBe(true);
    expect(body.student_name).toBe('Aanya');
    // Challenge was deleted.
    expect(holders.state.challenges).toHaveLength(0);
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_success');
  });

  it('wrong OTP increments attempt_count and returns 401 with remaining attempts', async () => {
    signIn();
    seedGuardian();
    insertChallenge({ otp: '654321' });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '111111' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.remaining_attempts).toBe(4);
    expect(holders.state.challenges[0].attempt_count).toBe(1);
    expect(holders.state.challenges[0].locked_until).toBeNull();
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_wrong');
  });

  it('5th wrong OTP locks the challenge for 1 hour and returns 423', async () => {
    signIn();
    seedGuardian();
    insertChallenge({ otp: '654321', attempt_count: 4 });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '000000' }));
    expect(res.status).toBe(423);
    const body = await res.json();
    expect(body.locked_until).toBeTruthy();
    expect(holders.state.challenges[0].attempt_count).toBe(5);
    expect(holders.state.challenges[0].locked_until).toBeTruthy();
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_locked_now');
  });

  it('subsequent attempts against a locked challenge return 423 without burning an attempt', async () => {
    signIn();
    seedGuardian();
    const lockUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    insertChallenge({ otp: '654321', attempt_count: 5, locked_until: lockUntil });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' })); // even correct
    expect(res.status).toBe(423);
    // attempt_count did NOT increment beyond 5.
    expect(holders.state.challenges[0].attempt_count).toBe(5);
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_locked');
  });

  it('expired challenge returns 401 with the expired event and cleans up', async () => {
    signIn();
    seedGuardian();
    insertChallenge({
      otp: '654321',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(res.status).toBe(401);
    expect(holders.state.challenges).toHaveLength(0); // cleaned up
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_expired');
  });

  it('returns 401 when no challenge exists for the caller', async () => {
    signIn();
    seedGuardian();
    // no insertChallenge()
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(res.status).toBe(401);
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_no_challenge');
  });

  it('returns 429 when the per-IP rate limit is exceeded', async () => {
    signIn();
    seedGuardian();
    insertChallenge({ otp: '654321' });
    holders.rateLimit.forceDeny = true;
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(res.status).toBe(429);
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_rate_limited');
  });

  it('returns 403 when the caller has no guardian profile', async () => {
    signIn();
    // no seedGuardian()
    insertChallenge({ otp: '654321' });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(res.status).toBe(403);
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_no_guardian_profile');
  });

  it('surfaces an RPC-rejected error as 409 without deleting the challenge', async () => {
    signIn();
    seedGuardian();
    insertChallenge({ otp: '654321' });
    holders.state.rpcResult = {
      data: { error: 'Already linked to Aanya' } as unknown,
      error: null,
    };
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(res.status).toBe(409);
    // Challenge preserved so a retry without re-issuing OTP is possible.
    expect(holders.state.challenges).toHaveLength(1);
    expect(lastAuditEvent()).toBe('link_code_otp_redeem_rpc_rejected');
  });
});

// ─────────────────────────────────────────────────────────────────────────
//   audit-trail coverage assertion
// ─────────────────────────────────────────────────────────────────────────
describe('audit trail', () => {
  it('writes an auth_audit_log row for every redemption outcome we exercise', async () => {
    signIn();
    seedGuardian();
    // happy path
    holders.state.challenges.push({
      id: 'chal-A', link_code: LINK_CODE, auth_user_id: AUTH_USER_ID, student_id: STUDENT_ID,
      otp_hash: hashOtp('111111', 'chal-A'),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      attempt_count: 0, locked_until: null, created_at: new Date().toISOString(),
    });
    await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '111111' }));
    // wrong-OTP path
    holders.state.challenges.push({
      id: 'chal-B', link_code: LINK_CODE, auth_user_id: AUTH_USER_ID, student_id: STUDENT_ID,
      otp_hash: hashOtp('222222', 'chal-B'),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      attempt_count: 0, locked_until: null, created_at: new Date().toISOString(),
    });
    await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '333333' }));

    const events = holders.state.auditLog.map((r) => r.event_type);
    expect(events).toContain('link_code_otp_redeem_success');
    expect(events).toContain('link_code_otp_redeem_wrong');
    // ip_address is always populated
    for (const row of holders.state.auditLog) {
      expect(row.ip_address).toBe('203.0.113.5');
    }
  });
});
