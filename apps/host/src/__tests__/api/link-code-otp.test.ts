/**
 * /api/parent/link-code/request-otp + /redeem — scoped RPC contract tests.
 *
 * These routes must not import the service-role admin client. Request OTP keeps
 * local OTP generation/email delivery, but code resolution, cooldown,
 * challenge insertion, and audit writes live in parent_request_link_code_otp.
 * Redeem lives in parent_redeem_link_code_otp so challenge hashes never leave
 * the database boundary.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const AUTH_USER_ID = '00000000-0000-4000-8000-00000000aaaa';
const LINK_CODE = 'ABC123';

const holders = vi.hoisted(() => ({
  session: null as { id: string; email: string } | null,
  rpc: vi.fn(),
  rateLimitAllowed: true,
  emailCalls: [] as Array<{ template: string; to: string; params: Record<string, unknown> }>,
}));

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: holders.session ? { id: holders.session.id, email: holders.session.email } : null },
        error: holders.session ? null : { message: 'no session' },
      }),
    },
    rpc: (...a: unknown[]) => holders.rpc(...a),
  }),
}));

vi.mock('@alfanumrik/lib/api-rate-limit', () => ({
  checkApiRateLimit: async () => ({
    allowed: holders.rateLimitAllowed,
    remaining: holders.rateLimitAllowed ? 1 : 0,
    resetAt: Math.floor(Date.now() / 1000) + 60,
  }),
}));

vi.mock('@alfanumrik/lib/email-delivery', () => ({
  deliverEmail: (input: { template: string; to: string; params: Record<string, unknown> }) => {
    holders.emailCalls.push(input);
    return Promise.resolve({ sent: true, id: `msg-${holders.emailCalls.length}` });
  },
  pickLocaleFromAcceptLanguage: () => 'en',
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST as requestOtpRoute } from '@/app/api/parent/link-code/request-otp/route';
import { POST as redeemRoute } from '@/app/api/parent/link-code/redeem/route';
import type { NextRequest } from 'next/server';

function makeReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/parent/link-code/x', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.5',
      'user-agent': 'vitest',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function signIn(email = 'parent@example.com') {
  holders.session = { id: AUTH_USER_ID, email };
}

function rpcResult(data: Record<string, unknown>, error: { message: string } | null = null) {
  holders.rpc.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.session = null;
  holders.rateLimitAllowed = true;
  holders.emailCalls = [];
  rpcResult({ success: true, should_send_email: true, challenge_id: 'chal-1', student_name: 'Aanya' });
});

describe('link-code OTP service-role migration guard', () => {
  it('routes do not import the service-role admin client', () => {
    for (const rel of [
      'src/app/api/parent/link-code/request-otp/route.ts',
      'src/app/api/parent/link-code/redeem/route.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(source).not.toContain('@alfanumrik/lib/supabase-admin');
    }
  });

  it('ships auth.uid()-anchored request/redeem RPC migrations', () => {
    const migrationPath = join(
      process.cwd(),
      '../../supabase/migrations/20260710170000_xc3_parent_link_code_otp_rpcs.sql'
    );
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.parent_request_link_code_otp/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.parent_redeem_link_code_otp/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).toMatch(/digest\(/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.parent_request_link_code_otp/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.parent_redeem_link_code_otp/i);
  });
});

describe('POST /api/parent/link-code/request-otp', () => {
  it('returns 401 when there is no session', async () => {
    const res = await requestOtpRoute(makeReq({ link_code: LINK_CODE }));
    expect(res.status).toBe(401);
    expect(holders.rpc).not.toHaveBeenCalled();
  });

  it('happy path: returns 200 + otp_sent, asks the scoped RPC to create the challenge, sends an email', async () => {
    signIn();
    const res = await requestOtpRoute(makeReq({ link_code: LINK_CODE }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.otp_sent).toBe(true);
    expect(holders.rpc).toHaveBeenCalledWith('parent_request_link_code_otp', expect.objectContaining({
      p_link_code: LINK_CODE,
      p_ip_address: '203.0.113.5',
      p_user_agent: 'vitest',
    }));
    expect(holders.rpc.mock.calls[0][1].p_challenge_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(holders.emailCalls).toHaveLength(1);
    expect(holders.emailCalls[0].template).toBe('parent-link-code-otp');
    expect(holders.emailCalls[0].to).toBe('parent@example.com');
  });

  it('returns 200 + otp_sent without email when the scoped RPC reports no match', async () => {
    signIn();
    rpcResult({ success: true, should_send_email: false, outcome: 'no_match' });
    const res = await requestOtpRoute(makeReq({ link_code: 'ZZZ999' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, otp_sent: true });
    expect(holders.emailCalls).toHaveLength(0);
  });

  it('returns 429 when the per-IP rate limit is exceeded before touching auth RPCs', async () => {
    signIn();
    holders.rateLimitAllowed = false;
    const res = await requestOtpRoute(makeReq({ link_code: LINK_CODE }));
    expect(res.status).toBe(429);
    expect(holders.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is missing link_code', async () => {
    signIn();
    const res = await requestOtpRoute(makeReq({}));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/parent/link-code/redeem', () => {
  it('returns 401 when there is no session', async () => {
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '123456' }));
    expect(res.status).toBe(401);
    expect(holders.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the otp body is malformed', async () => {
    signIn();
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: 'abc' }));
    expect(res.status).toBe(400);
  });

  it('happy path: correct OTP -> 200 and delegates linking to the scoped RPC', async () => {
    signIn();
    rpcResult({ success: true, linked: true, student_name: 'Aanya', student_grade: '8' });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, linked: true, student_name: 'Aanya' });
    expect(holders.rpc).toHaveBeenCalledWith('parent_redeem_link_code_otp', {
      p_link_code: LINK_CODE,
      p_otp: '654321',
      p_ip_address: '203.0.113.5',
      p_user_agent: 'vitest',
    });
  });

  it('maps wrong OTP to 401 with remaining attempts', async () => {
    signIn();
    rpcResult({ success: false, error_code: 'wrong_otp', error: 'Incorrect code.', remaining_attempts: 4 });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '111111' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.remaining_attempts).toBe(4);
  });

  it('maps locked challenges to 423 with Retry-After', async () => {
    signIn();
    const lockedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    rpcResult({
      success: false,
      error_code: 'locked',
      error: 'Too many incorrect attempts. Try again later.',
      locked_until: lockedUntil,
      retry_after_seconds: 3600,
    });
    const res = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(res.status).toBe(423);
    expect(res.headers.get('Retry-After')).toBe('3600');
    const body = await res.json();
    expect(body.locked_until).toBe(lockedUntil);
  });

  it('maps expired and no-challenge outcomes to 401', async () => {
    signIn();
    rpcResult({ success: false, error_code: 'expired', error: 'OTP has expired. Request a new code.' });
    const expired = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(expired.status).toBe(401);

    rpcResult({ success: false, error_code: 'no_challenge', error: 'No active OTP. Request a new code.' });
    const missing = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(missing.status).toBe(401);
  });

  it('maps no guardian to 403 and domain rejection to 409', async () => {
    signIn();
    rpcResult({ success: false, error_code: 'no_guardian', error: 'No guardian profile. Complete signup first.' });
    const noGuardian = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(noGuardian.status).toBe(403);

    rpcResult({ success: false, error_code: 'domain_rejected', error: 'Already linked to Aanya' });
    const rejected = await redeemRoute(makeReq({ link_code: LINK_CODE, otp: '654321' }));
    expect(rejected.status).toBe(409);
  });
});
