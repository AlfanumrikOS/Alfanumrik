/**
 * processLinkBinding — shared LINK-<otp> binding core (Phase 2).
 *
 * Pins the ACTUAL behavior of
 * apps/host/src/app/api/whatsapp/_lib/link-binding.ts:
 *   - non-conforming code (not 4-8 digits) → 'invalid' with ZERO DB I/O
 *   - zero OTP matches → 'invalid' (no attempt_count writes — the intended
 *     challenge is unknowable)
 *   - 2+ live matches → 'ambiguous', FAIL CLOSED (no delete, no bind)
 *   - attempt_count >= OTP_MAX_ATTEMPTS → 'locked' via computeLockoutUntil
 *   - SINGLE-USE PIN: the challenge DELETE happens BEFORE the identity
 *     insert/update (call-order asserted) — a crash between the two costs a
 *     re-request, never a replayable OTP
 *   - ≤ MAX_LIVE_STUDENT_BINDINGS_PER_PHONE (4) live student bindings per
 *     phone → 'limit' (guardians uncapped); the cap COUNT is a read that runs
 *     BEFORE the challenge DELETE, so a 'limit' outcome leaves the challenge
 *     intact (the OTP is NOT burned on a capped phone)
 *   - existing live phone+subject binding → RE-VERIFY (update), not duplicate
 *   - 23505 insert race → treated as re-verify
 *   - consent event { event:'opt_in', source:'whatsapp_link' }
 *   - whatsapp_sessions upsert with active_student_id (null for guardians)
 *   - P13: logOpsEvent context uses the `phone_redacted` key with
 *     redactPhone() output — never the raw phone; the OTP code is never logged
 *   - cron path (phoneE164=null): recovers the raw phone from an existing
 *     live identity; none → 'phone_unavailable' WITHOUT consuming the
 *     challenge (the user can resend LINK to the live webhook)
 *   - never throws → 'error'
 *
 * link-code-otp is REAL: challenge fixtures carry hashOtp(code, rowId) so the
 * verify path exercises the actual constant-time crypto.
 *
 * Owner: testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const loggerCalls: Array<{ level: string; msg: string; meta?: unknown }> = [];
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'warn', msg, meta }),
    error: (msg: string, meta?: unknown) => loggerCalls.push({ level: 'error', msg, meta }),
    debug: vi.fn(),
  },
}));

const opsEvents: Array<Record<string, any>> = [];
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: vi.fn(async (input: Record<string, any>) => {
    opsEvents.push(input);
  }),
}));

import {
  processLinkBinding,
  MAX_LIVE_STUDENT_BINDINGS_PER_PHONE,
} from '@/app/api/whatsapp/_lib/link-binding';
import { hashOtp, OTP_MAX_ATTEMPTS, OTP_LOCKOUT_MS } from '@alfanumrik/lib/link-code-otp';
import { redactPhone } from '@alfanumrik/lib/whatsapp/phone';

// ─── Fixtures ───────────────────────────────────────────────────────────────

// NOTE: the code must NOT be a substring of the phone digits, or the P13
// "code never logged" assertions would false-positive on the phone.
const CODE = '111222';
const PHONE = '+919876543210';
const PHONE_HASH = 'a'.repeat(64);

interface ChallengeOverrides {
  id?: string;
  auth_user_id?: string;
  student_id?: string | null;
  guardian_id?: string | null;
  role?: 'student' | 'guardian';
  otp_hash?: string;
  attempt_count?: number;
}

function challengeRow(over: ChallengeOverrides = {}) {
  const id = over.id ?? 'chal-1';
  return {
    id,
    auth_user_id: 'user-1',
    student_id: 'stu-1',
    guardian_id: null,
    role: 'student' as const,
    otp_hash: hashOtp(CODE, id),
    attempt_count: 0,
    ...over,
  };
}

// ─── Recording admin mock ───────────────────────────────────────────────────

type FilterCall = [string, ...unknown[]];

/** Global write-op order log — the single-use ordering pin reads this. */
const seq: string[] = [];

const st = {
  candidates: [] as any[],
  scanError: null as { message: string } | null,
  lockUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
  deleteCalls: [] as FilterCall[][],
  deleteError: null as { message: string } | null,
  phoneRecoveryRow: null as { phone_e164: string } | null,
  phoneRecoveryError: null as { message: string } | null,
  /** FIFO for select('id')…maybeSingle lookups (existing check, 23505 re-fetch). */
  identityLookups: [] as Array<{ data: { id: string } | null; error: unknown }>,
  identityLookupFilters: [] as FilterCall[][],
  liveStudentCount: 0 as number | null,
  countError: null as { message: string } | null,
  identityInserts: [] as Array<Record<string, unknown>>,
  insertResult: () =>
    ({ data: { id: 'ident-new' }, error: null }) as { data: any; error: any },
  identityUpdates: [] as Array<{ update: Record<string, unknown>; filters: FilterCall[] }>,
  consentInserts: [] as Array<Record<string, unknown>>,
  consentError: null as { message: string } | null,
  sessionUpserts: [] as Array<{ row: Record<string, unknown>; opts: Record<string, unknown> }>,
  sessionError: null as { message: string } | null,
  // whatsapp_check_link_attempt RPC (migration 20260815000006) — the
  // per-sender-phone OTP-guess throttle. Default 'allowed' so every
  // pre-existing test below (none of which exercise the throttle) is
  // unaffected; the dedicated describe block flips these.
  throttleCalls: [] as Array<Record<string, unknown>>,
  throttleAllowed: true,
  throttleLockedUntil: null as string | null,
  throttleError: null as { message: string } | null,
};

function resetState() {
  seq.length = 0;
  st.candidates = [];
  st.scanError = null;
  st.lockUpdates.length = 0;
  st.deleteCalls.length = 0;
  st.deleteError = null;
  st.phoneRecoveryRow = null;
  st.phoneRecoveryError = null;
  st.identityLookups.length = 0;
  st.identityLookupFilters.length = 0;
  st.liveStudentCount = 0;
  st.countError = null;
  st.identityInserts.length = 0;
  st.insertResult = () => ({ data: { id: 'ident-new' }, error: null });
  st.identityUpdates.length = 0;
  st.consentInserts.length = 0;
  st.consentError = null;
  st.sessionUpserts.length = 0;
  st.sessionError = null;
  st.throttleCalls.length = 0;
  st.throttleAllowed = true;
  st.throttleLockedUntil = null;
  st.throttleError = null;
}

const fromCalls: string[] = [];

function buildMockAdmin() {
  return {
    from(table: string) {
      fromCalls.push(table);
      switch (table) {
        case 'whatsapp_link_challenges':
          return {
            select: () => {
              const c: any = {
                gt: () => c,
                or: () => c,
                order: () => c,
                limit: () => c,
                then: (res: any, rej: any) =>
                  Promise.resolve({ data: st.candidates, error: st.scanError }).then(res, rej),
              };
              return c;
            },
            update: (update: Record<string, unknown>) => {
              seq.push('challenges.update');
              const rec = { update, filters: [] as FilterCall[] };
              st.lockUpdates.push(rec);
              return {
                eq: (...a: unknown[]) => {
                  rec.filters.push(['eq', ...a]);
                  return Promise.resolve({ error: null });
                },
              };
            },
            delete: () => {
              seq.push('challenges.delete');
              const filters: FilterCall[] = [];
              st.deleteCalls.push(filters);
              return {
                eq: (...a: unknown[]) => {
                  filters.push(['eq', ...a]);
                  return Promise.resolve({ error: st.deleteError });
                },
              };
            },
          };
        case 'whatsapp_identities':
          return {
            select: (cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.count) {
                seq.push('identities.count');
                const c: any = {
                  eq: () => c,
                  is: () => c,
                  not: () => c,
                  then: (res: any, rej: any) =>
                    Promise.resolve({ count: st.liveStudentCount, error: st.countError }).then(
                      res,
                      rej,
                    ),
                };
                return c;
              }
              if (cols === 'phone_e164') {
                seq.push('identities.phoneRecovery');
                const c: any = {
                  eq: () => c,
                  is: () => c,
                  limit: () => c,
                  maybeSingle: async () => ({
                    data: st.phoneRecoveryRow,
                    error: st.phoneRecoveryError,
                  }),
                };
                return c;
              }
              seq.push('identities.lookup');
              const filters: FilterCall[] = [];
              st.identityLookupFilters.push(filters);
              const c: any = {
                eq: (...a: unknown[]) => {
                  filters.push(['eq', ...a]);
                  return c;
                },
                is: (...a: unknown[]) => {
                  filters.push(['is', ...a]);
                  return c;
                },
                limit: () => c,
                maybeSingle: async () =>
                  st.identityLookups.length
                    ? st.identityLookups.shift()!
                    : { data: null, error: null },
              };
              return c;
            },
            insert: (row: Record<string, unknown>) => {
              seq.push('identities.insert');
              st.identityInserts.push(row);
              return { select: () => ({ single: async () => st.insertResult() }) };
            },
            update: (update: Record<string, unknown>) => {
              seq.push('identities.update');
              const rec = { update, filters: [] as FilterCall[] };
              st.identityUpdates.push(rec);
              return {
                eq: (...a: unknown[]) => {
                  rec.filters.push(['eq', ...a]);
                  return Promise.resolve({ error: null });
                },
              };
            },
          };
        case 'whatsapp_consent_events':
          return {
            insert: (row: Record<string, unknown>) => {
              seq.push('consent.insert');
              st.consentInserts.push(row);
              return Promise.resolve({ error: st.consentError });
            },
          };
        case 'whatsapp_sessions':
          return {
            upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
              seq.push('sessions.upsert');
              st.sessionUpserts.push({ row, opts });
              return Promise.resolve({ error: st.sessionError });
            },
          };
        default:
          throw new Error(`unexpected from(${table})`);
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'whatsapp_check_link_attempt') {
        seq.push('rpc.whatsapp_check_link_attempt');
        st.throttleCalls.push(args);
        if (st.throttleError) return Promise.resolve({ data: null, error: st.throttleError });
        return Promise.resolve({
          data: [{ allowed: st.throttleAllowed, locked_until: st.throttleLockedUntil, attempts_remaining: st.throttleAllowed ? 4 : 0 }],
          error: null,
        });
      }
      throw new Error(`unexpected rpc(${name})`);
    },
  };
}

function webhookInput(over: Partial<Parameters<typeof processLinkBinding>[0]> = {}) {
  return {
    code: CODE,
    phoneHash: PHONE_HASH,
    phoneE164: PHONE,
    source: 'whatsapp/webhook',
    ...over,
  };
}

beforeEach(() => {
  resetState();
  fromCalls.length = 0;
  loggerCalls.length = 0;
  opsEvents.length = 0;
  mockAdminImpl = buildMockAdmin();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('code validation short-circuit', () => {
  it.each(['abc123', '123', '123456789', '', 'LINK'])(
    'non-conforming code %j → invalid with ZERO DB I/O',
    async (bad) => {
      const result = await processLinkBinding(webhookInput({ code: bad }));
      expect(result.outcome).toBe('invalid');
      expect(fromCalls).toEqual([]);
    },
  );

  it('trims surrounding whitespace before validating', async () => {
    st.candidates = [challengeRow()];
    const result = await processLinkBinding(webhookInput({ code: `  ${CODE}  ` }));
    expect(result.outcome).toBe('bound');
  });
});

describe('per-sender-phone attempt throttle (whatsapp_check_link_attempt RPC)', () => {
  it('runs BEFORE the candidate scan, keyed on phoneHash', async () => {
    st.candidates = [challengeRow()];
    await processLinkBinding(webhookInput());
    expect(st.throttleCalls).toEqual([{ p_phone_hash: PHONE_HASH }]);
    expect(seq[0]).toBe('rpc.whatsapp_check_link_attempt');
  });

  it('allowed=false → rate_limited, candidate scan never runs', async () => {
    st.throttleAllowed = false;
    st.candidates = [challengeRow()]; // would otherwise match
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('rate_limited');
    expect(fromCalls).toEqual([]); // no whatsapp_link_challenges scan
  });

  it('RPC error → error outcome, fails closed (no candidate scan)', async () => {
    st.throttleError = { message: 'db down' };
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('error');
    expect(fromCalls).toEqual([]);
  });

  it('allowed=true still proceeds to a normal bind', async () => {
    st.throttleAllowed = true;
    st.candidates = [challengeRow()];
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');
  });
});

describe('OTP matching against the candidate scan', () => {
  it('zero matches → invalid, and NO per-CHALLENGE attempt_count / lockout write is issued', async () => {
    st.candidates = [challengeRow({ otp_hash: hashOtp('999888', 'chal-1') })];
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('invalid');
    // The per-sender-phone throttle RPC (whatsapp_check_link_attempt) DOES
    // run — that is the deliberate fix (a non-matching guess is unattributable
    // to any specific challenge row, but IS attributable to the sender's own
    // phone_hash, which this RPC rate-limits). What must stay absent is any
    // per-CHALLENGE write (update/delete/insert on whatsapp_link_challenges
    // or whatsapp_identities) — the intended challenge is still unknowable.
    expect(seq).toEqual(['rpc.whatsapp_check_link_attempt']);
  });

  it('2+ matches → ambiguous, FAIL CLOSED (no delete, no bind, no consent)', async () => {
    st.candidates = [
      challengeRow({ id: 'chal-1' }),
      challengeRow({ id: 'chal-2', student_id: 'stu-2' }),
    ];
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('ambiguous');
    expect(st.deleteCalls).toHaveLength(0);
    expect(st.identityInserts).toHaveLength(0);
    expect(st.identityUpdates).toHaveLength(0);
    expect(st.consentInserts).toHaveLength(0);
  });

  it('scan error → error outcome', async () => {
    st.scanError = { message: 'db down' };
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('error');
  });
});

describe('attempt-exhaustion lockout', () => {
  it('attempt_count >= OTP_MAX_ATTEMPTS → locked, row stamped with computeLockoutUntil', async () => {
    st.candidates = [challengeRow({ attempt_count: OTP_MAX_ATTEMPTS })];
    const before = Date.now();
    const result = await processLinkBinding(webhookInput());
    const after = Date.now();
    expect(result.outcome).toBe('locked');

    expect(st.lockUpdates).toHaveLength(1);
    const upd = st.lockUpdates[0];
    expect(upd.filters).toContainEqual(['eq', 'id', 'chal-1']);
    const lockedUntil = new Date(upd.update.locked_until as string).getTime();
    expect(lockedUntil).toBeGreaterThanOrEqual(before + OTP_LOCKOUT_MS);
    expect(lockedUntil).toBeLessThanOrEqual(after + OTP_LOCKOUT_MS);

    // Locked ≠ consumed and never binds.
    expect(st.deleteCalls).toHaveLength(0);
    expect(st.identityInserts).toHaveLength(0);
  });

  it('attempt_count just below the ceiling still binds', async () => {
    st.candidates = [challengeRow({ attempt_count: OTP_MAX_ATTEMPTS - 1 })];
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');
  });
});

describe('single-use ordering pin + fresh bind', () => {
  it('SINGLE-USE: the challenge DELETE happens BEFORE the identity insert', async () => {
    st.candidates = [challengeRow()];
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');

    expect(st.deleteCalls).toHaveLength(1);
    expect(st.deleteCalls[0]).toContainEqual(['eq', 'id', 'chal-1']);
    const deleteIdx = seq.indexOf('challenges.delete');
    const insertIdx = seq.indexOf('identities.insert');
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(insertIdx);
  });

  it('challenge delete failure → error, and the identity is NEVER written', async () => {
    st.candidates = [challengeRow()];
    st.deleteError = { message: 'delete failed' };
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('error');
    expect(st.identityInserts).toHaveLength(0);
    expect(st.identityUpdates).toHaveLength(0);
  });

  it('fresh bind inserts the full identity row (student) with verified fields', async () => {
    st.candidates = [challengeRow()];
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');

    expect(st.identityInserts).toHaveLength(1);
    const row = st.identityInserts[0];
    expect(row.phone_e164).toBe(PHONE);
    expect(row.phone_hash).toBe(PHONE_HASH);
    expect(row.student_id).toBe('stu-1');
    expect(row.guardian_id).toBeNull();
    expect(row.role).toBe('student');
    expect(row.auth_user_id).toBe('user-1');
    expect(row.verified_via).toBe('web_deeplink_otp');
    expect(row.opt_in_status).toBe('opted_in');
    expect(typeof row.verified_at).toBe('string');
    expect(typeof row.opted_in_at).toBe('string');
  });
});

describe('shared-phone cap (≤4 live student bindings)', () => {
  it(`count at MAX (${MAX_LIVE_STUDENT_BINDINGS_PER_PHONE}) → limit, no insert, challenge NOT consumed`, async () => {
    st.candidates = [challengeRow()];
    st.liveStudentCount = MAX_LIVE_STUDENT_BINDINGS_PER_PHONE;
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('limit');
    expect(st.identityInserts).toHaveLength(0);
    // The cap COUNT is a read that runs BEFORE the challenge DELETE: a
    // student on a maxed phone keeps their OTP and does not have to
    // re-request from the app.
    expect(st.deleteCalls).toHaveLength(0);
  });

  it('count just below MAX → binds', async () => {
    st.candidates = [challengeRow()];
    st.liveStudentCount = MAX_LIVE_STUDENT_BINDINGS_PER_PHONE - 1;
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');
  });

  it('guardian bindings are NOT capped (no count query on the guardian path)', async () => {
    st.candidates = [
      challengeRow({ role: 'guardian', student_id: null, guardian_id: 'g-1' }),
    ];
    st.liveStudentCount = 99; // would trip the cap if consulted
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');
    expect(seq).not.toContain('identities.count');
    const row = st.identityInserts[0];
    expect(row.guardian_id).toBe('g-1');
    expect(row.student_id).toBeNull();
  });
});

describe('re-verify paths', () => {
  it('existing live phone+subject binding → UPDATE (re-verify), never a duplicate insert', async () => {
    st.candidates = [challengeRow()];
    st.identityLookups = [{ data: { id: 'ident-exist' }, error: null }];
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');

    expect(st.identityInserts).toHaveLength(0);
    expect(st.identityUpdates).toHaveLength(1);
    const upd = st.identityUpdates[0];
    expect(upd.filters).toContainEqual(['eq', 'id', 'ident-exist']);
    expect(upd.update.verified_via).toBe('web_deeplink_otp');
    expect(upd.update.opt_in_status).toBe('opted_in');

    // Single-use ordering holds on the re-verify path too.
    expect(seq.indexOf('challenges.delete')).toBeLessThan(seq.indexOf('identities.update'));

    // Ops event marks it a re-verify.
    expect(opsEvents).toHaveLength(1);
    expect(opsEvents[0].context.reverified).toBe(true);
  });

  it('23505 insert race → treated as re-verify against the winning live row', async () => {
    st.candidates = [challengeRow()];
    st.identityLookups = [
      { data: null, error: null }, // pre-insert existing check: nothing
      { data: { id: 'ident-raced' }, error: null }, // post-23505 re-fetch
    ];
    st.insertResult = () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');
    expect(
      st.identityUpdates.some((u) =>
        u.filters.some((f) => f[0] === 'eq' && f[2] === 'ident-raced'),
      ),
    ).toBe(true);
    expect(opsEvents[0].context.reverified).toBe(true);
  });

  it('23505 with no live row recoverable → error', async () => {
    st.candidates = [challengeRow()];
    st.identityLookups = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    st.insertResult = () => ({ data: null, error: { code: '23505', message: 'dup' } });
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('error');
  });

  it('non-23505 insert error → error', async () => {
    st.candidates = [challengeRow()];
    st.insertResult = () => ({ data: null, error: { code: '42P01', message: 'boom' } });
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('error');
  });
});

describe('post-bind side effects (best-effort)', () => {
  it('appends the DPDP consent event { opt_in, whatsapp_link } for the bound identity', async () => {
    st.candidates = [challengeRow()];
    await processLinkBinding(webhookInput());
    expect(st.consentInserts).toEqual([
      { identity_id: 'ident-new', event: 'opt_in', source: 'whatsapp_link' },
    ]);
  });

  it('upserts the session row with active_student_id (student) on UNIQUE(identity_id)', async () => {
    st.candidates = [challengeRow()];
    await processLinkBinding(webhookInput());
    expect(st.sessionUpserts).toHaveLength(1);
    expect(st.sessionUpserts[0].row).toEqual({
      identity_id: 'ident-new',
      state: 'idle',
      active_student_id: 'stu-1',
    });
    expect(st.sessionUpserts[0].opts).toEqual({ onConflict: 'identity_id' });
  });

  it('guardian bind → session active_student_id is null', async () => {
    st.candidates = [
      challengeRow({ role: 'guardian', student_id: null, guardian_id: 'g-1' }),
    ];
    await processLinkBinding(webhookInput());
    expect(st.sessionUpserts[0].row.active_student_id).toBeNull();
  });

  it('consent-event failure does NOT convert a durable bind into an error', async () => {
    st.candidates = [challengeRow()];
    st.consentError = { message: 'consent table down' };
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');
  });

  it('session-upsert failure does NOT convert a durable bind into an error', async () => {
    st.candidates = [challengeRow()];
    st.sessionError = { message: 'sessions table down' };
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('bound');
  });
});

describe('P13 — ops event + logs', () => {
  it('logOpsEvent context carries phone_redacted = redactPhone(phone), NEVER the raw phone', async () => {
    st.candidates = [challengeRow()];
    await processLinkBinding(webhookInput());

    expect(opsEvents).toHaveLength(1);
    const evt = opsEvents[0];
    expect(evt.category).toBe('whatsapp');
    expect(evt.message).toBe('identity_bound');
    expect(evt.subjectType).toBe('student');
    expect(evt.subjectId).toBe('stu-1');
    expect(evt.context.phone_redacted).toBe(redactPhone(PHONE));
    // Raw phone digits never appear anywhere in the ops payload.
    expect(JSON.stringify(evt)).not.toContain('987654');
  });

  it('the OTP code never reaches the logger or ops events on any exercised path', async () => {
    // Exercise several logging paths: ambiguous (warn), lock (update), bind.
    st.candidates = [challengeRow({ id: 'c1' }), challengeRow({ id: 'c2' })];
    await processLinkBinding(webhookInput());
    resetState();
    mockAdminImpl = buildMockAdmin();
    st.candidates = [challengeRow({ attempt_count: OTP_MAX_ATTEMPTS })];
    await processLinkBinding(webhookInput());
    resetState();
    mockAdminImpl = buildMockAdmin();
    st.candidates = [challengeRow()];
    await processLinkBinding(webhookInput());

    const allOutput = JSON.stringify({ loggerCalls, opsEvents });
    expect(allOutput).not.toContain(CODE);
    expect(allOutput).not.toContain('987654'); // raw phone digits
  });
});

describe('cron path — phoneE164 = null (P13: raw phone never in event rows)', () => {
  it('recovers the raw phone from an existing live identity on the same phone_hash', async () => {
    st.candidates = [challengeRow()];
    st.phoneRecoveryRow = { phone_e164: PHONE };
    const result = await processLinkBinding(
      webhookInput({ phoneE164: null, source: 'cron/whatsapp-drain' }),
    );
    expect(result.outcome).toBe('bound');
    expect(st.identityInserts[0].phone_e164).toBe(PHONE);
  });

  it('no live identity to recover from → phone_unavailable, challenge NOT consumed', async () => {
    st.candidates = [challengeRow()];
    st.phoneRecoveryRow = null;
    const result = await processLinkBinding(
      webhookInput({ phoneE164: null, source: 'cron/whatsapp-drain' }),
    );
    expect(result.outcome).toBe('phone_unavailable');
    // PINNED ACTUAL: recovery runs BEFORE the delete, so the challenge stays
    // live and the user can resend LINK to the webhook.
    expect(st.deleteCalls).toHaveLength(0);
    expect(st.identityInserts).toHaveLength(0);
  });

  it('webhook path never consults phone recovery (live inbound carries the phone)', async () => {
    st.candidates = [challengeRow()];
    await processLinkBinding(webhookInput());
    expect(seq).not.toContain('identities.phoneRecovery');
  });
});

describe('never throws', () => {
  it('a total DB outage (from() throws) → error outcome, not an exception', async () => {
    mockAdminImpl = {
      from() {
        throw new Error('connection refused');
      },
    };
    const result = await processLinkBinding(webhookInput());
    expect(result.outcome).toBe('error');
  });
});
