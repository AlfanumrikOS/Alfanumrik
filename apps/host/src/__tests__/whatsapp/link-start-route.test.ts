/**
 * POST /api/whatsapp/link/start — OTP challenge issuance (Phase 2).
 *
 * Pins the route contract from the WhatsApp bot plan
 * (plan-alfanumrik-whatsapp-bot-mighty-frost.md, "Identity binding" +
 * LOCKED decision #1):
 *   - 503 when WHATSAPP_BUSINESS_NUMBER is unset (before anything else)
 *   - 401 unauthenticated (cookie-auth via createSupabaseServerClient)
 *   - 404 { error:'not_found' } when ff_whatsapp_bot_v1 is OFF
 *   - DPDP MINOR GATE (LOCKED): student age < 18 OR NULL date_of_birth
 *     (fail-closed — K-12 population) without a live parental_consent row
 *     (revoked_at IS NULL) → 403 { error:'parental_consent_required' };
 *     adult students SKIP the consent lookup entirely; guardians skip it too
 *   - 429 { error:'rate_limited', retry_after_ms } within RESEND_COOLDOWN_MS
 *     of the newest whatsapp_link_challenges row for this auth user; a
 *     FUTURE-DATED newest row (clock skew) FAILS CLOSED into the same 429
 *     with retry_after_ms = RESEND_COOLDOWN_MS
 *   - success → EXACTLY ONE INSERT into whatsapp_link_challenges with
 *     id = crypto.randomUUID() and otp_hash = hashOtp(otp, rowId) (no
 *     placeholder-then-UPDATE window), and a response
 *     { otp, deep_link (wa.me + 'LINK%20<otp>'), expires_at }
 *   - P13: the OTP value is NEVER passed to the logger on any path
 *
 * House pattern: supabaseAdmin via lazy Proxy, feature flags + logger mocked
 * at module boundary (see webhook-route.test.ts). link-code-otp is REAL —
 * the otp_hash assertion uses the actual hashOtp so a crypto drift fails here.
 *
 * Owner: testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── Module-boundary mocks ──────────────────────────────────────────────────

let mockAdminImpl: any;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: new Proxy({} as any, {
    get(_target, prop) {
      if (!mockAdminImpl) return undefined;
      const value = mockAdminImpl[prop];
      return typeof value === 'function' ? value.bind(mockAdminImpl) : value;
    },
  }),
}));

let mockServerImpl: any;
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => mockServerImpl),
}));

const flagValues: Record<string, boolean> = {};
const flagQueries: string[] = [];
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (name: string) => {
    flagQueries.push(name);
    return flagValues[name] ?? false;
  }),
}));

const loggerCalls: Array<{ level: string; msg: string; meta?: unknown }> = [];
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'error', msg, meta }),
    debug: vi.fn(),
  },
}));

import { POST } from '@/app/api/whatsapp/link/start/route';
import {
  hashOtp,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
} from '@alfanumrik/lib/link-code-otp';

// ─── Server (cookie) client state ───────────────────────────────────────────

const serverState = {
  user: { id: 'user-1' } as { id: string } | null,
  userError: null as { message: string } | null,
  studentRow: null as { id: string; date_of_birth: string | null } | null,
  studentError: null as { message: string } | null,
};

function buildServerClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: serverState.user },
        error: serverState.userError,
      }),
    },
    from(table: string) {
      if (table !== 'students') throw new Error(`unexpected server from(${table})`);
      const c: any = {
        select: () => c,
        eq: () => c,
        maybeSingle: async () => ({
          data: serverState.studentRow,
          error: serverState.studentError,
        }),
      };
      return c;
    },
  };
}

// ─── Admin client state ─────────────────────────────────────────────────────

const adminState = {
  fromCalls: [] as string[],
  consentRow: null as { id: string } | null,
  consentError: null as { message: string } | null,
  guardianRow: null as { id: string } | null,
  guardianError: null as { message: string } | null,
  latestChallenge: null as { created_at: string } | null,
  rateLimitError: null as { message: string } | null,
  challengeInserts: [] as Array<Record<string, unknown>>,
  challengeInsertError: null as { message: string } | null,
};

function buildMockAdmin() {
  return {
    from(table: string) {
      adminState.fromCalls.push(table);
      switch (table) {
        case 'parental_consent': {
          const c: any = {
            select: () => c,
            eq: () => c,
            is: () => c,
            limit: () => c,
            maybeSingle: async () => ({
              data: adminState.consentRow,
              error: adminState.consentError,
            }),
          };
          return c;
        }
        case 'guardians': {
          const c: any = {
            select: () => c,
            eq: () => c,
            maybeSingle: async () => ({
              data: adminState.guardianRow,
              error: adminState.guardianError,
            }),
          };
          return c;
        }
        case 'whatsapp_link_challenges':
          return {
            select: () => {
              const c: any = {
                eq: () => c,
                order: () => c,
                limit: () => c,
                maybeSingle: async () => ({
                  data: adminState.latestChallenge,
                  error: adminState.rateLimitError,
                }),
              };
              return c;
            },
            insert: (row: Record<string, unknown>) => {
              adminState.challengeInserts.push(row);
              return Promise.resolve({ error: adminState.challengeInsertError });
            },
          };
        default:
          throw new Error(`unexpected admin from(${table})`);
      }
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ADULT_DOB = '1990-05-05';

/** A DOB exactly ~10 years back — unambiguously a minor. */
function minorDob(): string {
  const d = new Date();
  return `${d.getUTCFullYear() - 10}-01-01`;
}

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/whatsapp/link/start', {
    method: 'POST',
    ...(body !== undefined
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

beforeEach(() => {
  process.env.WHATSAPP_BUSINESS_NUMBER = '+91 90000 11111';
  serverState.user = { id: 'user-1' };
  serverState.userError = null;
  serverState.studentRow = { id: 'stu-1', date_of_birth: ADULT_DOB };
  serverState.studentError = null;
  adminState.fromCalls.length = 0;
  adminState.consentRow = null;
  adminState.consentError = null;
  adminState.guardianRow = null;
  adminState.guardianError = null;
  adminState.latestChallenge = null;
  adminState.rateLimitError = null;
  adminState.challengeInserts.length = 0;
  adminState.challengeInsertError = null;
  loggerCalls.length = 0;
  flagQueries.length = 0;
  for (const k of Object.keys(flagValues)) delete flagValues[k];
  flagValues.ff_whatsapp_bot_v1 = true;
  mockAdminImpl = buildMockAdmin();
  mockServerImpl = buildServerClient();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('env + auth + flag gates', () => {
  it('returns 503 not_configured when WHATSAPP_BUSINESS_NUMBER is unset', async () => {
    delete process.env.WHATSAPP_BUSINESS_NUMBER;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
    expect(adminState.fromCalls).toEqual([]);
  });

  it('returns 401 unauthenticated when there is no cookie session', async () => {
    serverState.user = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
    expect(adminState.challengeInserts).toHaveLength(0);
  });

  it('returns 401 when auth.getUser errors', async () => {
    serverState.userError = { message: 'jwt expired' };
    serverState.user = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 404 not_found when ff_whatsapp_bot_v1 is OFF (authed user)', async () => {
    flagValues.ff_whatsapp_bot_v1 = false;
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(flagQueries).toContain('ff_whatsapp_bot_v1');
    expect(adminState.challengeInserts).toHaveLength(0);
  });

  it('returns 400 invalid_role for a role outside student|guardian', async () => {
    const res = await POST(makeRequest({ role: 'teacher' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_role' });
  });

  it('returns 404 no_student_profile when the student row is missing', async () => {
    serverState.studentRow = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_student_profile' });
  });
});

describe('DPDP minor gate (LOCKED decision #1)', () => {
  it('minor (age < 18) with NO live parental_consent → 403 parental_consent_required, no challenge insert', async () => {
    serverState.studentRow = { id: 'stu-1', date_of_birth: minorDob() };
    adminState.consentRow = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'parental_consent_required' });
    expect(adminState.fromCalls).toContain('parental_consent');
    expect(adminState.challengeInserts).toHaveLength(0);
  });

  it('NULL date_of_birth is FAIL-CLOSED into the minor gate (K-12 population)', async () => {
    serverState.studentRow = { id: 'stu-1', date_of_birth: null };
    adminState.consentRow = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'parental_consent_required' });
    expect(adminState.fromCalls).toContain('parental_consent');
  });

  it('unparseable date_of_birth is also fail-closed (computeAgeYears → 0)', async () => {
    serverState.studentRow = { id: 'stu-1', date_of_birth: 'not-a-date' };
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it('minor WITH a live parental_consent row (revoked_at IS NULL) proceeds to a challenge', async () => {
    serverState.studentRow = { id: 'stu-1', date_of_birth: minorDob() };
    adminState.consentRow = { id: 'consent-1' };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(adminState.challengeInserts).toHaveLength(1);
  });

  it('ADULT student (age >= 18) skips the consent lookup entirely', async () => {
    serverState.studentRow = { id: 'stu-1', date_of_birth: ADULT_DOB };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(adminState.fromCalls).not.toContain('parental_consent');
  });

  it('guardian role skips the DPDP gate (no parental_consent query)', async () => {
    adminState.guardianRow = { id: 'g-1' };
    const res = await POST(makeRequest({ role: 'guardian' }));
    expect(res.status).toBe(200);
    expect(adminState.fromCalls).not.toContain('parental_consent');
    const row = adminState.challengeInserts[0];
    expect(row.role).toBe('guardian');
    expect(row.guardian_id).toBe('g-1');
    expect(row.student_id).toBeNull();
  });

  it('guardian role without a guardians row → 404 no_guardian_profile', async () => {
    adminState.guardianRow = null;
    const res = await POST(makeRequest({ role: 'guardian' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_guardian_profile' });
  });
});

describe('rate limit — RESEND_COOLDOWN_MS against the newest challenge', () => {
  it('within the cooldown → 429 rate_limited with a sane retry_after_ms, and NO insert', async () => {
    adminState.latestChallenge = {
      created_at: new Date(Date.now() - 1_000).toISOString(),
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
    expect(body.retry_after_ms).toBeGreaterThan(0);
    expect(body.retry_after_ms).toBeLessThanOrEqual(RESEND_COOLDOWN_MS);
    // ~1s elapsed, so retry_after should be close to the full cooldown.
    expect(body.retry_after_ms).toBeGreaterThan(RESEND_COOLDOWN_MS - 10_000);
    expect(adminState.challengeInserts).toHaveLength(0);
  });

  it('cooldown elapsed → challenge is issued', async () => {
    adminState.latestChallenge = {
      created_at: new Date(Date.now() - RESEND_COOLDOWN_MS - 1_000).toISOString(),
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(adminState.challengeInserts).toHaveLength(1);
  });

  it('a future-dated newest challenge (clock skew) FAILS CLOSED → 429 with the full cooldown', async () => {
    // elapsedMs < 0 means state we can't reason about — treated as
    // within-cooldown (fail closed), never a bypass of the 429.
    adminState.latestChallenge = {
      created_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
    expect(body.retry_after_ms).toBe(RESEND_COOLDOWN_MS);
    expect(adminState.challengeInserts).toHaveLength(0);
  });
});

describe('success path — challenge insert + response contract', () => {
  it('issues exactly ONE insert with id=UUID and otp_hash=hashOtp(otp, rowId)', async () => {
    const before = Date.now();
    const res = await POST(makeRequest());
    const after = Date.now();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Response shape.
    expect(body.otp).toMatch(/^\d{6}$/);
    expect(typeof body.deep_link).toBe('string');
    expect(typeof body.expires_at).toBe('string');

    // Deep link: wa.me + prefilled `LINK <otp>` (URL-encoded space).
    expect(body.deep_link).toContain('wa.me');
    expect(body.deep_link).toContain('LINK%20');
    expect(body.deep_link).toBe(
      `https://wa.me/919000011111?text=LINK%20${body.otp}`,
    );

    // Exactly one insert — no placeholder-then-UPDATE window.
    expect(adminState.challengeInserts).toHaveLength(1);
    const row = adminState.challengeInserts[0];
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(row.auth_user_id).toBe('user-1');
    expect(row.student_id).toBe('stu-1');
    expect(row.guardian_id).toBeNull();
    expect(row.role).toBe('student');

    // The stored hash is hashOtp(otp, rowId) — REAL crypto, not a mock.
    expect(row.otp_hash).toBe(hashOtp(body.otp as string, row.id as string));
    // The plaintext OTP is never persisted.
    expect(row).not.toHaveProperty('otp');

    // expires_at ≈ now + OTP_TTL_MS, and response mirrors the row.
    const exp = new Date(row.expires_at as string).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + OTP_TTL_MS);
    expect(exp).toBeLessThanOrEqual(after + OTP_TTL_MS);
    expect(body.expires_at).toBe(row.expires_at);
  });

  it('P13: the OTP value never reaches the logger on the success path', async () => {
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(JSON.stringify(loggerCalls)).not.toContain(body.otp);
  });

  it('P13: insert failure → 500 internal_error and the log line carries NO OTP', async () => {
    adminState.challengeInsertError = { message: 'insert exploded' };
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    const errLog = loggerCalls.find((l) => l.level === 'error');
    expect(errLog).toBeTruthy();
    // The OTP is unknowable to the test here (it never left the route), so
    // pin the absence of ANY 6-digit token in the error log payload.
    expect(JSON.stringify(errLog)).not.toMatch(/\b\d{6}\b/);
  });

  it('an empty (non-JSON) body defaults to role=student', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(adminState.challengeInserts[0].role).toBe('student');
  });
});
