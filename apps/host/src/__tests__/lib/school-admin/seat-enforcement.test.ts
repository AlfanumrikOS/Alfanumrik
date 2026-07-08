/**
 * Phase 3B Wave B — app-layer unit tests for the seat-enforcement wiring helpers
 * (`src/lib/school-admin/seat-enforcement.ts`). NO DB: the supabase-admin client,
 * the feature-flags reader, and the logger are mocked; the pure helpers
 * (P3B01 parsing, the 409 body builder, the capacity math, the flag gate) run
 * for real.
 *
 * Covered:
 *   - isSeatEnforcementEnabled — delegates to isFeatureEnabled(ff_school_provisioning)
 *   - parseBlockVerdict / parseBlockStatus (via enrollWithSeatCheck) — P3B01 detection
 *     + verdict parsing from error DETAIL, with a status-only fallback when DETAIL
 *     is unparseable; non-P3B01 errors map to { kind: 'error' } and never throw.
 *   - seatCapViolationResponse — 409 shape: status, projected, grace_ceiling,
 *     seats_purchased; grace_expires_at ONLY on a verdict that carries it.
 *   - remainingCapacity — grace_ceiling - current_active, clamped to >= 0; null on
 *     preview failure.
 *   - flagGraceWarn — inserts the de-duped school row + one super-admin row per
 *     ACTIVE admin_users(super_admin) auth_user_id (fan-out N→N+1); EVERY inserted
 *     row carries a non-empty `message` (notifications.message text NOT NULL — bug
 *     1 guard) and a valid-uuid `recipient_id` (notifications.recipient_id uuid
 *     NOT NULL; never the old 'super_admin' string — bug 2 guard); carries NO PII
 *     (P13: ids/counts/grace_expires_at only); never throws on failure. A negative
 *     "would FAIL against the old buggy shape" case pins these as real guards.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the feature-flag reader (gate) + logger. ────────────────────────────
const { mockIsFeatureEnabled } = vi.hoisted(() => ({ mockIsFeatureEnabled: vi.fn() }));
vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/feature-flags')>();
  return { ...actual, isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args) };
});

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Mock supabase-admin with a controllable chainable client. ────────────────
// `getSupabaseAdmin()` returns the shared `db` object below. Each test wires the
// `rpc` / `from` behaviour it needs.
const { db } = vi.hoisted(() => {
  return { db: { rpc: vi.fn(), from: vi.fn() } };
});
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => db,
  supabaseAdmin: db,
}));

import {
  isSeatEnforcementEnabled,
  enrollWithSeatCheck,
  enrollSectionWithSeatCheck,
  seatCapViolationResponse,
  remainingCapacity,
  flagGraceWarn,
  SEAT_POLICY_BLOCK_SQLSTATE,
  type SeatVerdict,
} from '@alfanumrik/lib/school-admin/seat-enforcement';
import { SCHOOL_PROVISIONING_FLAGS } from '@alfanumrik/lib/feature-flags';

const SCHOOL = '11111111-1111-1111-1111-111111111111';

function verdict(overrides: Partial<SeatVerdict> = {}): SeatVerdict {
  return {
    allowed: true,
    status: 'within_plan',
    seats_purchased: 10,
    grace_ceiling: 11,
    current_active: 5,
    projected: 6,
    grace_started_at: null,
    grace_expires_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.rpc.mockReset();
  db.from.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isSeatEnforcementEnabled — flag gate', () => {
  it('returns true when ff_school_provisioning resolves true', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    await expect(isSeatEnforcementEnabled()).resolves.toBe(true);
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(
      SCHOOL_PROVISIONING_FLAGS.V1,
      expect.any(Object),
    );
  });

  it('returns false when the flag resolves false (default OFF)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    await expect(isSeatEnforcementEnabled()).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('enrollWithSeatCheck — P3B01 detection + verdict parsing', () => {
  it('parses the verdict out of the P3B01 error DETAIL → kind:blocked', async () => {
    const v = verdict({ allowed: false, status: 'over_ceiling', current_active: 11, projected: 12 });
    db.rpc.mockResolvedValue({
      data: null,
      error: {
        code: SEAT_POLICY_BLOCK_SQLSTATE,
        message: 'seat_policy_block: over_ceiling',
        details: JSON.stringify(v),
      },
    });

    const r = await enrollWithSeatCheck(SCHOOL, [{ student_id: 's1', class_id: 'c1' }]);
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') {
      expect(r.status).toBe('over_ceiling');
      expect(r.verdict?.projected).toBe(12);
      expect(r.verdict?.grace_ceiling).toBe(11);
    }
  });

  it('falls back to the status from the message when DETAIL is unparseable', async () => {
    db.rpc.mockResolvedValue({
      data: null,
      error: {
        code: SEAT_POLICY_BLOCK_SQLSTATE,
        message: 'seat_policy_block: grace_expired',
        details: 'not-json{{{',
      },
    });
    const r = await enrollWithSeatCheck(SCHOOL, [{ student_id: 's1', class_id: 'c1' }]);
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') {
      expect(r.verdict).toBeNull();
      expect(r.status).toBe('grace_expired');
    }
  });

  it('maps a NON-P3B01 RPC error to kind:error and never throws (no SQL leak)', async () => {
    db.rpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    const r = await enrollWithSeatCheck(SCHOOL, [{ student_id: 's1', class_id: 'c1' }]);
    expect(r.kind).toBe('error');
  });

  it('returns kind:allowed with the verdict on success', async () => {
    const v = verdict({ status: 'grace_warn', allowed: true });
    db.rpc.mockResolvedValue({
      data: { success: true, enrolled: 1, requested: 1, verdict: v, usage: {} },
      error: null,
    });
    const r = await enrollWithSeatCheck(SCHOOL, [{ student_id: 's1', class_id: 'c1' }]);
    expect(r.kind).toBe('allowed');
    if (r.kind === 'allowed') {
      expect(r.enrolled).toBe(1);
      expect(r.verdict.status).toBe('grace_warn');
    }
  });

  it('rejects an empty payload without calling the RPC', async () => {
    const r = await enrollWithSeatCheck(SCHOOL, []);
    expect(r.kind).toBe('error');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('calls the class_students RPC name', async () => {
    db.rpc.mockResolvedValue({
      data: { success: true, enrolled: 1, requested: 1, verdict: verdict(), usage: {} },
      error: null,
    });
    await enrollWithSeatCheck(SCHOOL, [{ student_id: 's1', class_id: 'c1' }]);
    expect(db.rpc).toHaveBeenCalledWith(
      'enroll_students_with_seat_check',
      expect.objectContaining({ p_school_id: SCHOOL }),
    );
  });
});

describe('enrollSectionWithSeatCheck — class_enrollments path', () => {
  it('calls the SECTION RPC name and parses P3B01 identically', async () => {
    const v = verdict({ allowed: false, status: 'grace_expired' });
    db.rpc.mockResolvedValue({
      data: null,
      error: {
        code: SEAT_POLICY_BLOCK_SQLSTATE,
        message: 'seat_policy_block: grace_expired',
        details: JSON.stringify(v),
      },
    });
    const r = await enrollSectionWithSeatCheck(SCHOOL, [{ student_id: 's1', class_id: 'c1' }]);
    expect(db.rpc).toHaveBeenCalledWith(
      'enroll_section_students_with_seat_check',
      expect.objectContaining({ p_school_id: SCHOOL }),
    );
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') expect(r.status).toBe('grace_expired');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('seatCapViolationResponse — 409 body shape', () => {
  it('is HTTP 409 and echoes status/projected/grace_ceiling/seats_purchased', async () => {
    const v = verdict({ allowed: false, status: 'over_ceiling', projected: 12, grace_ceiling: 11, seats_purchased: 10 });
    const res = seatCapViolationResponse(v, v.status);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('seat_cap_violation');
    expect(body.status).toBe('over_ceiling');
    expect(body.projected).toBe(12);
    expect(body.grace_ceiling).toBe(11);
    expect(body.seats_purchased).toBe(10);
  });

  it('OMITS grace_expires_at for over_ceiling (no expiry on a hard ceiling block)', async () => {
    const v = verdict({ allowed: false, status: 'over_ceiling', grace_expires_at: null });
    const res = seatCapViolationResponse(v, v.status);
    const body = await res.json();
    expect(body).not.toHaveProperty('grace_expires_at');
  });

  it('INCLUDES grace_expires_at only when the verdict carries it (grace_expired)', async () => {
    const expires = '2026-06-30T00:00:00.000Z';
    const v = verdict({ allowed: false, status: 'grace_expired', grace_expires_at: expires });
    const res = seatCapViolationResponse(v, v.status);
    const body = await res.json();
    expect(body.status).toBe('grace_expired');
    expect(body.grace_expires_at).toBe(expires);
  });

  it('falls back to the status arg + nulls when the verdict is null', async () => {
    const res = seatCapViolationResponse(null, 'grace_expired');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe('grace_expired');
    expect(body.projected).toBeNull();
    expect(body.grace_ceiling).toBeNull();
    expect(body.seats_purchased).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('remainingCapacity — grace-ceiling math', () => {
  it('returns grace_ceiling - current_active', async () => {
    db.rpc.mockImplementation((name: string) => {
      if (name === '_count_active_school_students') return Promise.resolve({ data: 6, error: null });
      if (name === '_eval_seat_policy_unchecked') {
        return Promise.resolve({
          data: verdict({ grace_ceiling: 11, current_active: 6 }),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    db.from.mockReturnValue(makeSubChain({ seats_purchased: 10, seat_grace_started_at: null }));

    await expect(remainingCapacity(SCHOOL)).resolves.toBe(5); // 11 - 6
  });

  it('clamps to >= 0 when already over the ceiling', async () => {
    db.rpc.mockImplementation((name: string) => {
      if (name === '_count_active_school_students') return Promise.resolve({ data: 12, error: null });
      if (name === '_eval_seat_policy_unchecked') {
        return Promise.resolve({
          data: verdict({ grace_ceiling: 11, current_active: 12 }),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    db.from.mockReturnValue(makeSubChain({ seats_purchased: 10, seat_grace_started_at: null }));

    await expect(remainingCapacity(SCHOOL)).resolves.toBe(0); // max(11 - 12, 0)
  });

  it('returns null when the count read fails (caller treats as 503)', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(remainingCapacity(SCHOOL)).resolves.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REG-97 insert-shape regression guard. Two production bugs were just fixed that
// the prior mocked test could NOT catch because it never inspected the actual
// `notifications` insert payload columns:
//   BUG 1 — `notifications.message` is `text NOT NULL`. An insert that omits
//           `message` (or sets it empty) raises 23502 at runtime, only visible
//           against a live DB. Guard: assert EVERY inserted row has a non-empty
//           string `message`.
//   BUG 2 — `notifications.recipient_id` is `uuid NOT NULL`. The old super-admin
//           row inserted the literal string `'super_admin'`, which raises 22P02
//           (invalid uuid). The fix resolves real super-admins from `admin_users`
//           (admin_level='super_admin', is_active) and inserts one row per
//           `auth_user_id`. Guard: assert EVERY `recipient_id` is a valid uuid,
//           the school row uses the school uuid, each super-admin row uses one of
//           the resolved `admin_users.auth_user_id` uuids, and NO row carries
//           `recipient_id === 'super_admin'`.
// These are real regression guards: replaying the old buggy shape (omitted
// `message` / `'super_admin'` recipient_id) fails the asserts below — proven by
// the explicit "would FAIL against the old shape" test at the end of this block.

// RFC-4122-ish uuid (any version), case-insensitive. Matches the school uuid +
// the admin_users.auth_user_id uuids; rejects the bare string 'super_admin'.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Two ACTIVE super-admins resolved from admin_users.auth_user_id (real uuids).
const SUPER_ADMIN_IDS = [
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
];

describe('flagGraceWarn — de-duped, no-PII, never-throws, NOT-NULL+uuid insert shape', () => {
  it('inserts the school row (school uuid) + one row per super-admin (admin_users uuids) — fan-out N→N+1', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    db.from.mockImplementation((table: string) =>
      makeSeatNotifyRouter(table, {
        existing: [],
        superAdminIds: SUPER_ADMIN_IDS,
        inserts,
      }),
    );

    const v = verdict({
      status: 'grace_warn',
      current_active: 11,
      seats_purchased: 10,
      grace_ceiling: 11,
      grace_started_at: '2026-06-08T00:00:00.000Z',
      grace_expires_at: '2026-06-22T00:00:00.000Z',
    });
    await flagGraceWarn(SCHOOL, v);

    // Fan-out: N active super-admins → N super-admin rows + the 1 school row.
    expect(inserts.length).toBe(SUPER_ADMIN_IDS.length + 1); // 2 + 1 = 3

    const schoolRows = inserts.filter((i) => i.recipient_type === 'school');
    const superRows = inserts.filter((i) => i.recipient_type === 'super_admin');
    expect(schoolRows.length).toBe(1);
    expect(superRows.length).toBe(SUPER_ADMIN_IDS.length); // 2

    // ── BUG 1 regression guard: EVERY row carries a non-empty string `message`
    //    (notifications.message is text NOT NULL — an omitted/empty value would
    //    raise 23502 against the live DB).
    for (const row of inserts) {
      expect(typeof row.message).toBe('string');
      expect((row.message as string).length).toBeGreaterThan(0);
    }

    // ── BUG 2 regression guard: EVERY recipient_id is a valid uuid
    //    (notifications.recipient_id is uuid NOT NULL — 'super_admin' raised 22P02).
    for (const row of inserts) {
      expect(typeof row.recipient_id).toBe('string');
      expect(row.recipient_id as string).toMatch(UUID_RE);
      expect(row.recipient_id).not.toBe('super_admin'); // the exact old bug
    }

    // School row → schools.id uuid.
    expect(schoolRows[0].recipient_id).toBe(SCHOOL);
    expect(SCHOOL).toMatch(UUID_RE);

    // Each super-admin row → one of the resolved admin_users.auth_user_id uuids,
    // and every resolved super-admin got exactly one row (no dupes, full fan-out).
    const superRecipientIds = superRows.map((r) => r.recipient_id as string).sort();
    expect(superRecipientIds).toEqual([...SUPER_ADMIN_IDS].sort());
    for (const r of superRows) {
      expect(SUPER_ADMIN_IDS).toContain(r.recipient_id);
    }

    // ── No PII anywhere in the serialized payloads (P13): no email/phone/name.
    const serialized = JSON.stringify(inserts);
    expect(serialized).not.toMatch(/@/); // no email
    expect(serialized).not.toMatch(/\b\d{10}\b/); // no 10-digit phone
    // Type tag is the stable, PII-free event name on every row.
    expect(inserts.every((i) => i.type === 'seat_grace_warn')).toBe(true);
    // Payload `data` carries ids/counts/grace_expires_at only (no PII — P13).
    for (const row of inserts) {
      const data = row.data as Record<string, unknown>;
      expect(data.current_active).toBe(11);
      expect(data.seats_purchased).toBe(10);
      expect(data.grace_ceiling).toBe(11);
      expect(data.grace_expires_at).toBe('2026-06-22T00:00:00.000Z');
      // No PII keys leak into the payload.
      expect(data).not.toHaveProperty('email');
      expect(data).not.toHaveProperty('phone');
      expect(data).not.toHaveProperty('name');
    }
  });

  it('fan-out scales: 3 active super-admins → 3 super-admin rows + 1 school row, all uuid recipient_ids', async () => {
    const threeAdmins = [
      '44444444-4444-4444-4444-444444444444',
      '55555555-5555-5555-5555-555555555555',
      '66666666-6666-6666-6666-666666666666',
    ];
    const inserts: Array<Record<string, unknown>> = [];
    db.from.mockImplementation((table: string) =>
      makeSeatNotifyRouter(table, { existing: [], superAdminIds: threeAdmins, inserts }),
    );

    await flagGraceWarn(SCHOOL, verdict({ status: 'grace_warn' }));

    expect(inserts.length).toBe(threeAdmins.length + 1); // 3 + 1 = 4
    expect(inserts.filter((i) => i.recipient_type === 'super_admin').length).toBe(3);
    // Every recipient_id is a uuid; none is the old 'super_admin' sentinel.
    expect(inserts.every((i) => UUID_RE.test(i.recipient_id as string))).toBe(true);
    expect(inserts.every((i) => i.recipient_id !== 'super_admin')).toBe(true);
    // Every row still carries a non-empty message (bug 1 guard at this scale too).
    expect(inserts.every((i) => typeof i.message === 'string' && (i.message as string).length > 0)).toBe(true);
  });

  it('still inserts the school row (with message + school-uuid recipient) when there are NO super-admins', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    db.from.mockImplementation((table: string) =>
      makeSeatNotifyRouter(table, { existing: [], superAdminIds: [], inserts }),
    );

    await flagGraceWarn(SCHOOL, verdict({ status: 'grace_warn' }));

    // Only the school-facing row persists; no super-admin fan-out.
    expect(inserts.length).toBe(1);
    expect(inserts[0].recipient_type).toBe('school');
    expect(inserts[0].recipient_id).toBe(SCHOOL);
    expect(typeof inserts[0].message).toBe('string');
    expect((inserts[0].message as string).length).toBeGreaterThan(0);
  });

  it('SKIPS insertion when a grace_warn flag already exists today (idempotent de-dupe)', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    db.from.mockImplementation((table: string) =>
      makeSeatNotifyRouter(table, {
        existing: [{ id: 'already-flagged-today' }],
        superAdminIds: SUPER_ADMIN_IDS,
        inserts,
      }),
    );
    await flagGraceWarn(SCHOOL, verdict({ status: 'grace_warn' }));
    expect(inserts.length).toBe(0);
  });

  it('never throws when the notifications insert fails (must not break the soft-allow)', async () => {
    db.from.mockImplementation((table: string) =>
      makeSeatNotifyRouter(table, { existing: [], superAdminIds: SUPER_ADMIN_IDS, failInsert: true }),
    );
    await expect(flagGraceWarn(SCHOOL, verdict({ status: 'grace_warn' }))).resolves.toBeUndefined();
  });

  it('skips the super-admin fan-out (school row still persists) when the admin_users lookup errors', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    db.from.mockImplementation((table: string) =>
      makeSeatNotifyRouter(table, { existing: [], superAdminLookupError: true, inserts }),
    );
    await flagGraceWarn(SCHOOL, verdict({ status: 'grace_warn' }));
    // The school-facing flag already persisted before the lookup failed.
    expect(inserts.length).toBe(1);
    expect(inserts[0].recipient_type).toBe('school');
    expect(inserts[0].recipient_id).toBe(SCHOOL);
  });

  // PROOF this is a real regression guard, not a tautology: feed the captured
  // rows the OLD buggy shape (omitted `message`, literal 'super_admin'
  // recipient_id) and confirm the same assertions used above now FAIL.
  it('FAILS against the OLD buggy insert shape (omitted message / recipient_id "super_admin")', () => {
    const oldBuggyRows: Array<Record<string, unknown>> = [
      // school row — but with NO message (bug 1) — mirrors the pre-fix insert.
      { recipient_id: SCHOOL, recipient_type: 'school', type: 'seat_grace_warn' },
      // single super_admin row keyed by the bare string (bug 2) — the exact old bug.
      { recipient_id: 'super_admin', recipient_type: 'super_admin', type: 'seat_grace_warn', message: 'x' },
    ];

    // Bug-1 assertion must catch the missing message.
    expect(() => {
      for (const row of oldBuggyRows) {
        expect(typeof row.message).toBe('string');
        expect((row.message as string)?.length ?? 0).toBeGreaterThan(0);
      }
    }).toThrow();

    // Bug-2 assertion must catch the non-uuid 'super_admin' recipient_id.
    expect(() => {
      for (const row of oldBuggyRows) {
        expect(row.recipient_id as string).toMatch(UUID_RE);
        expect(row.recipient_id).not.toBe('super_admin');
      }
    }).toThrow();
  });
});

// ─── chainable mock builders ─────────────────────────────────────────────────

/** Chain for previewSeatPolicy's school_subscriptions read (maybeSingle). */
function makeSubChain(row: Record<string, unknown> | null) {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = vi.fn(ret);
  chain.eq = vi.fn(ret);
  chain.in = vi.fn(ret);
  chain.order = vi.fn(ret);
  chain.limit = vi.fn(ret);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: row, error: null }));
  return chain;
}

/**
 * Table-aware router for flagGraceWarn. The helper touches TWO tables:
 *   - `notifications`:
 *       • de-dupe read: .select().eq().eq().eq().gte().limit() → { data: existing }
 *       • school insert:  .insert(<object>)
 *       • super insert:   .insert(<array of rows>)   ← bulk fan-out
 *     Both insert shapes are FLATTENED into `inserts` so each captured element is
 *     a single notification row (one assertion path for school + super rows).
 *   - `admin_users`:
 *       • super-admin lookup: .select().eq().eq().not()  → { data: [{auth_user_id}], error }
 *     `.not()` is the awaited terminal (returns a thenable).
 */
function makeSeatNotifyRouter(
  table: string,
  opts: {
    existing?: Array<{ id: string }>;
    superAdminIds?: string[];
    superAdminLookupError?: boolean;
    inserts?: Array<Record<string, unknown>>;
    failInsert?: boolean;
  },
) {
  if (table === 'admin_users') {
    return makeAdminUsersChain(opts.superAdminIds ?? [], opts.superAdminLookupError ?? false);
  }
  // default: notifications
  return makeNotificationsChain({
    existing: opts.existing ?? [],
    inserts: opts.inserts,
    failInsert: opts.failInsert,
  });
}

/**
 * Chain for the `admin_users` super-admin lookup. Resolves on `.not(...)` (the
 * awaited terminal in the helper): { data: [{auth_user_id}], error }.
 */
function makeAdminUsersChain(authUserIds: string[], lookupError: boolean) {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = vi.fn(ret);
  chain.eq = vi.fn(ret);
  chain.not = vi.fn(() =>
    Promise.resolve(
      lookupError
        ? { data: null, error: { message: 'admin_users lookup failed' } }
        : { data: authUserIds.map((id) => ({ auth_user_id: id })), error: null },
    ),
  );
  return chain;
}

/**
 * Chain for the `notifications` table:
 *   - the de-dupe read: .select().eq().eq().eq().gte().limit() → { data: existing }
 *   - the inserts: .insert(rowOrRows) → FLATTENED into `inserts`
 *     (rejects if failInsert, so the helper's try/catch swallow can be exercised).
 */
function makeNotificationsChain(opts: {
  existing: Array<{ id: string }>;
  inserts?: Array<Record<string, unknown>>;
  failInsert?: boolean;
}) {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = vi.fn(ret);
  chain.eq = vi.fn(ret);
  chain.gte = vi.fn(ret);
  chain.limit = vi.fn(() => Promise.resolve({ data: opts.existing, error: null }));
  chain.insert = vi.fn((rowOrRows: Record<string, unknown> | Array<Record<string, unknown>>) => {
    if (opts.failInsert) return Promise.reject(new Error('insert failed'));
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    for (const r of rows) opts.inserts?.push(r);
    return Promise.resolve({ data: null, error: null });
  });
  return chain;
}
