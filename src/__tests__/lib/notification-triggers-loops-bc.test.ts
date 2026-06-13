/**
 * Phase A Loops B & C — adaptive-loop notification trigger shapes.
 *
 * Companion to notification-triggers-remediation.test.ts (Loop A). The
 * /api/cron/adaptive-remediation route MOCKS these six functions, so the route
 * tests pin only that the route CALLS them — not their internal contract. This
 * file pins the contract of the producers themselves (src/lib/notification-
 * triggers.ts):
 *
 *   1. HOUSE SHAPE: top-level `message` (NOT NULL in prod) + `body` carry
 *      English; Hindi lives in data.title_hi / data.body_hi / data.message_hi
 *      (P7 — the prod notifications table has NO top-level body_hi column; this
 *      is the daily-cron / Loop A convention).
 *
 *   2. IDEMPOTENCY: a deterministic idempotency_key per intervention cycle
 *      (`<verb>_<interventionId>_<recipient>`) upserted on
 *      (recipient_id, type, idempotency_key) with ignoreDuplicates — cron
 *      retries never duplicate rows. Nudge vs at-expiry escalation carry
 *      DISTINCT keys (Decision B4) so a returning student's day-0 nudge and a
 *      later escalation never collide.
 *
 *   3. RECIPIENTS / ROUTING:
 *      - nudge / returned / resolved → the student (Loop B nudge ALSO alerts
 *        guardians — supportive day-0 touch);
 *      - inactivity-escalated → student ALWAYS + guardians ONLY on the 'parent'
 *        path, NEVER a teacher (Decision B4); null path → student-only;
 *      - concentration-escalated → student ALWAYS + guardian only on 'parent';
 *        the 'teacher' path is student-only here (teacher rides the Phase 3A
 *        assignment row, not a notification);
 *      - concentration-reescalated → parent follow-up ONLY (guardian rows, no
 *        student row); the teacher/null path sends NOTHING (re-flag rides the
 *        assignment row).
 *      Guardian fetch is dual-status (approved | active) and preference-aware.
 *
 *   4. P13: payloads carry opaque ids + academic codes only — never
 *      name/email/phone.
 *
 *   5. FIRE-AND-FORGET: a DB failure never throws to the caller.
 *
 * Style mirrors notification-triggers-remediation.test.ts exactly (same
 * vi.hoisted supabase-admin mock so the SUT can be imported statically).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── supabase-admin mock (hoisted to dodge the static-import TDZ) ──────────────

const mockDb = vi.hoisted(() => {
  const state = {
    guardianLinksResult: { data: [] as unknown, error: null as unknown },
    upsertResult: { error: null as unknown },
    upsertCalls: [] as Array<{ table: string; rows: Record<string, unknown>[]; opts: Record<string, unknown> }>,
    tablesQueried: [] as string[],
  };
  const adminClient = {
    from(table: string) {
      state.tablesQueried.push(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => Promise.resolve(state.guardianLinksResult);
      chain.upsert = (rows: Record<string, unknown>[], opts: Record<string, unknown>) => {
        state.upsertCalls.push({ table, rows, opts });
        return Promise.resolve(state.upsertResult);
      };
      return chain;
    },
  };
  return { state, adminClient };
});

const { upsertCalls, tablesQueried } = mockDb.state;

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: mockDb.adminClient,
  getSupabaseAdmin: () => mockDb.adminClient,
}));

import {
  onReEngagementNudge,
  onReEngagementReturned,
  onInactivityEscalated,
  onConcentrationEscalated,
  onConcentrationResolved,
  onConcentrationReescalated,
} from '@/lib/notification-triggers';

const IV = '00000000-0000-0000-0000-00000000cc01';
const HINDI_RE = /[ऀ-ॿ]/; // Devanagari block — P7 pin

/** Two linked guardians: g-1 prefs ON (null defaults ON), g-2 opted out. */
function twoGuardians(prefType: string) {
  return {
    data: [
      {
        guardian_id: 'g-1',
        guardians: { id: 'g-1', auth_user_id: 'auth-g1', notification_preferences: null, preferred_language: 'hi' },
      },
      {
        guardian_id: 'g-2',
        guardians: { id: 'g-2', auth_user_id: 'auth-g2', notification_preferences: { [prefType]: false }, preferred_language: 'en' },
      },
    ],
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  upsertCalls.length = 0;
  tablesQueried.length = 0;
  mockDb.state.guardianLinksResult = { data: [], error: null };
  mockDb.state.upsertResult = { error: null };
});

function onlyUpsert() {
  expect(upsertCalls).toHaveLength(1);
  return upsertCalls[0];
}

/** Every adaptive-loop row obeys the prod-table house shape + P13. */
function expectHouseShape(row: Record<string, unknown>) {
  expect(typeof row.message).toBe('string');
  expect((row.message as string).length).toBeGreaterThan(0);
  expect(row.body).toBe(row.message); // body mirrors message
  expect(typeof row.title).toBe('string');
  const data = row.data as Record<string, unknown>;
  expect(String(data.title_hi)).toMatch(HINDI_RE);
  expect(String(data.body_hi)).toMatch(HINDI_RE);
  expect(String(data.message_hi)).toMatch(HINDI_RE);
  // No top-level body_hi column exists in prod.
  expect('body_hi' in row).toBe(false);
  // P13: no PII keys anywhere in the row payload.
  expect(JSON.stringify(row)).not.toMatch(/"(name|email|phone)"/i);
  expect(row.is_read).toBe(false);
}

function expectIdempotentUpsert(opts: Record<string, unknown>) {
  expect(opts).toMatchObject({
    onConflict: 'recipient_id,type,idempotency_key',
    ignoreDuplicates: true,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP B — onReEngagementNudge (day-0 supportive touch: student + guardians)
// ════════════════════════════════════════════════════════════════════════════

describe('onReEngagementNudge', () => {
  it('student row: house shape + deterministic _student idempotency key', async () => {
    await onReEngagementNudge('stu-1', { interventionId: IV });
    const { table, rows, opts } = onlyUpsert();
    expect(table).toBe('notifications');
    expectIdempotentUpsert(opts);
    const studentRow = rows.find((r) => r.recipient_type === 'student')!;
    expect(studentRow).toMatchObject({
      recipient_id: 'stu-1',
      type: 'reengagement_nudge',
      idempotency_key: `engagement_nudge_${IV}_student`,
    });
    expectHouseShape(studentRow);
    expect((studentRow.data as Record<string, unknown>).intervention_id).toBe(IV);
  });

  it('parent path: student + one row per preference-enabled guardian (opted-out skipped)', async () => {
    mockDb.state.guardianLinksResult = twoGuardians('reengagement_nudge');
    await onReEngagementNudge('stu-1', { interventionId: IV });
    expect(tablesQueried).toContain('guardian_student_links');
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(2); // student + g-1 only
    const guardianRow = rows.find((r) => r.recipient_type === 'guardian')!;
    expect(guardianRow).toMatchObject({
      recipient_id: 'g-1',
      type: 'reengagement_nudge',
      idempotency_key: `engagement_nudge_${IV}_g-1`,
    });
    expectHouseShape(guardianRow);
  });

  it('never throws when the upsert fails (fire-and-forget)', async () => {
    mockDb.state.upsertResult = { error: { message: 'db down' } };
    await expect(onReEngagementNudge('stu-1', { interventionId: IV })).resolves.toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP B — onReEngagementReturned (student-only celebration)
// ════════════════════════════════════════════════════════════════════════════

describe('onReEngagementReturned', () => {
  it('student-only row with a distinct _returned key; guardians not queried', async () => {
    await onReEngagementReturned('stu-1', { interventionId: IV });
    const { rows, opts } = onlyUpsert();
    expectIdempotentUpsert(opts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_type: 'student',
      recipient_id: 'stu-1',
      type: 'reengagement_returned',
      idempotency_key: `engagement_returned_${IV}_student`,
    });
    expectHouseShape(rows[0]);
    expect(tablesQueried).not.toContain('guardian_student_links');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP B — onInactivityEscalated (student always; guardian only on parent; never teacher)
// ════════════════════════════════════════════════════════════════════════════

describe('onInactivityEscalated', () => {
  it("parent path: student + guardian rows; key distinct from the day-0 nudge (B4)", async () => {
    mockDb.state.guardianLinksResult = twoGuardians('reengagement_escalated');
    await onInactivityEscalated('stu-1', { interventionId: IV, escalatedTo: 'parent' });
    expect(tablesQueried).toContain('guardian_student_links');
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(2);
    const studentRow = rows.find((r) => r.recipient_type === 'student')!;
    const guardianRow = rows.find((r) => r.recipient_type === 'guardian')!;
    expect(studentRow.idempotency_key).toBe(`engagement_escalated_${IV}_student`);
    // Distinct namespace from the nudge so a returning student never collides.
    expect(studentRow.idempotency_key).not.toBe(`engagement_nudge_${IV}_student`);
    expect(guardianRow).toMatchObject({
      recipient_id: 'g-1',
      idempotency_key: `engagement_escalated_${IV}_g-1`,
    });
    expect((studentRow.data as Record<string, unknown>).escalated_to).toBe('parent');
    expectHouseShape(studentRow);
    expectHouseShape(guardianRow);
  });

  it('null path (no guardian): student-only, escalated_to=null, guardians never queried', async () => {
    await onInactivityEscalated('stu-1', { interventionId: IV, escalatedTo: null });
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_type).toBe('student');
    expect((rows[0].data as Record<string, unknown>).escalated_to).toBeNull();
    // Decision B4: NEVER a teacher; the null path doesn't even fetch guardians.
    expect(tablesQueried).not.toContain('guardian_student_links');
    expectHouseShape(rows[0]);
  });

  it('never throws when the guardian fetch fails (student row still sent)', async () => {
    mockDb.state.guardianLinksResult = { data: null, error: { message: 'rls boom' } };
    await expect(
      onInactivityEscalated('stu-1', { interventionId: IV, escalatedTo: 'parent' }),
    ).resolves.toBeUndefined();
    expect(onlyUpsert().rows.some((r) => r.recipient_type === 'student')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP C — onConcentrationEscalated (student always; guardian only on parent; teacher rides assignment)
// ════════════════════════════════════════════════════════════════════════════

const CCTX = { subjectCode: 'math', interventionId: IV, atRiskChapterCount: 5 };

describe('onConcentrationEscalated', () => {
  it('teacher path: student row ONLY — guardians not queried (teacher rides the Phase 3A assignment)', async () => {
    await onConcentrationEscalated('stu-1', { ...CCTX, escalatedTo: 'teacher' });
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_type: 'student',
      type: 'concentration_escalated',
      idempotency_key: `concentration_escalated_${IV}_student`,
    });
    expect((rows[0].data as Record<string, unknown>).escalated_to).toBe('teacher');
    expect((rows[0].data as Record<string, unknown>).subject_code).toBe('math');
    expectHouseShape(rows[0]);
    expect(tablesQueried).not.toContain('guardian_student_links');
  });

  it('parent path: student + preference-enabled guardian rows', async () => {
    mockDb.state.guardianLinksResult = twoGuardians('concentration_escalated');
    await onConcentrationEscalated('stu-1', { ...CCTX, escalatedTo: 'parent' });
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.recipient_type === 'guardian')).toMatchObject({
      recipient_id: 'g-1',
      idempotency_key: `concentration_escalated_${IV}_g-1`,
    });
    rows.forEach((r) => expectHouseShape(r));
  });

  it('null path: student-only, escalated_to=null', async () => {
    await onConcentrationEscalated('stu-1', { ...CCTX, escalatedTo: null });
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(1);
    expect((rows[0].data as Record<string, unknown>).escalated_to).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP C — onConcentrationResolved (student-only celebration)
// ════════════════════════════════════════════════════════════════════════════

describe('onConcentrationResolved', () => {
  it('student-only row with a _student idempotency key; guardians not queried', async () => {
    await onConcentrationResolved('stu-1', CCTX);
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_type: 'student',
      type: 'concentration_resolved',
      idempotency_key: `concentration_resolved_${IV}_student`,
    });
    expectHouseShape(rows[0]);
    expect(tablesQueried).not.toContain('guardian_student_links');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP C — onConcentrationReescalated (parent follow-up ONLY; teacher/null sends nothing)
// ════════════════════════════════════════════════════════════════════════════

describe('onConcentrationReescalated', () => {
  it('parent path: guardian follow-up rows only (NO student row), distinct _reescalated key', async () => {
    mockDb.state.guardianLinksResult = twoGuardians('concentration_escalated');
    await onConcentrationReescalated('stu-1', { ...CCTX, escalatedTo: 'parent' });
    expect(tablesQueried).toContain('guardian_student_links');
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(1); // g-1 only; no student row on the re-notify
    expect(rows[0]).toMatchObject({
      recipient_type: 'guardian',
      recipient_id: 'g-1',
      idempotency_key: `concentration_reescalated_${IV}_g-1`,
    });
    expectHouseShape(rows[0]);
  });

  it('teacher path: NOTHING sent (re-flag rides the assignment row); no upsert, no guardian fetch', async () => {
    await onConcentrationReescalated('stu-1', { ...CCTX, escalatedTo: 'teacher' });
    expect(upsertCalls).toHaveLength(0);
    expect(tablesQueried).not.toContain('guardian_student_links');
  });

  it('null path: NOTHING sent (ops event only)', async () => {
    await onConcentrationReescalated('stu-1', { ...CCTX, escalatedTo: null });
    expect(upsertCalls).toHaveLength(0);
  });

  it('never throws when the guardian fetch fails (fire-and-forget)', async () => {
    mockDb.state.guardianLinksResult = { data: null, error: { message: 'rls boom' } };
    await expect(
      onConcentrationReescalated('stu-1', { ...CCTX, escalatedTo: 'parent' }),
    ).resolves.toBeUndefined();
  });
});
