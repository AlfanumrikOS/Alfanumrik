/**
 * Phase A Loop A — adaptive-remediation notification trigger shapes.
 *
 * Pins for onRemediationAssigned / onRemediationRecovered /
 * onRemediationEscalated (src/lib/notification-triggers.ts):
 *
 *   1. WORKING column shape: top-level `message` (NOT NULL in prod) + `body`
 *      carry English; Hindi lives in data.title_hi / data.body_hi /
 *      data.message_hi (P7 — the prod notifications table has NO top-level
 *      body_hi column; this is the daily-cron / goal-daily-plan-reminder
 *      convention).
 *
 *   2. IDEMPOTENCY: deterministic idempotency_key per intervention cycle and
 *      upsert on (recipient_id, type, idempotency_key) with ignoreDuplicates
 *      (migration 20260505100100) — cron retries never duplicate rows.
 *
 *   3. RECIPIENTS: assigned/recovered → the student. escalated → always the
 *      student; guardians ONLY on the 'parent' path, dual-status link filter,
 *      respecting each guardian's notification preferences.
 *
 *   4. P13: payloads carry opaque ids + academic codes only — never
 *      name/email/phone.
 *
 *   5. FIRE-AND-FORGET: a DB failure never throws to the caller.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── supabase-admin mock ──────────────────────────────────────────────────────
// vi.mock factories are hoisted above top-level consts, and this file imports
// the module-under-test STATICALLY — so all mutable mock state must live in
// vi.hoisted() to avoid the TDZ ("cannot access before initialization").

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
  onRemediationAssigned,
  onRemediationRecovered,
  onRemediationEscalated,
} from '@/lib/notification-triggers';

const CTX = {
  subjectCode: 'math',
  chapterNumber: 4,
  interventionId: '00000000-0000-0000-0000-00000000cc01',
};
const HINDI_RE = /[ऀ-ॿ]/; // Devanagari block — P7 pin

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

function expectHouseShape(row: Record<string, unknown>) {
  // English copy on the working NOT NULL columns.
  expect(typeof row.message).toBe('string');
  expect((row.message as string).length).toBeGreaterThan(0);
  expect(row.body).toBe(row.message);
  expect(typeof row.title).toBe('string');
  // Hindi copy in the data jsonb (P7) — actual Devanagari, not transliteration.
  const data = row.data as Record<string, unknown>;
  expect(String(data.title_hi)).toMatch(HINDI_RE);
  expect(String(data.body_hi)).toMatch(HINDI_RE);
  expect(String(data.message_hi)).toMatch(HINDI_RE);
  // There is NO top-level body_hi column in prod — must not be present.
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

describe('onRemediationAssigned', () => {
  it('inserts one student row with the house shape + deterministic idempotency key', async () => {
    await onRemediationAssigned('stu-1', CTX);
    const { table, rows, opts } = onlyUpsert();
    expect(table).toBe('notifications');
    expectIdempotentUpsert(opts);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      recipient_type: 'student',
      recipient_id: 'stu-1',
      type: 'remediation_assigned',
      idempotency_key: `remediation_assigned_${CTX.interventionId}`,
    });
    expectHouseShape(row);
    const data = row.data as Record<string, unknown>;
    expect(data).toMatchObject({
      subject_code: 'math',
      chapter_number: 4,
      intervention_id: CTX.interventionId,
    });
  });

  it('never throws when the upsert fails (fire-and-forget)', async () => {
    mockDb.state.upsertResult = { error: { message: 'db down' } };
    await expect(onRemediationAssigned('stu-1', CTX)).resolves.toBeUndefined();
  });
});

describe('onRemediationRecovered', () => {
  it('inserts one student row with the house shape + deterministic idempotency key', async () => {
    await onRemediationRecovered('stu-1', CTX);
    const { rows, opts } = onlyUpsert();
    expectIdempotentUpsert(opts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_type: 'student',
      recipient_id: 'stu-1',
      type: 'remediation_recovered',
      idempotency_key: `remediation_recovered_${CTX.interventionId}`,
    });
    expectHouseShape(rows[0]);
  });
});

describe('onRemediationEscalated', () => {
  it("teacher path: student row only — guardians are NOT queried (teacher rides the Phase 3A assignment)", async () => {
    await onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'teacher' });
    const { rows, opts } = onlyUpsert();
    expectIdempotentUpsert(opts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_type: 'student',
      recipient_id: 'stu-1',
      type: 'remediation_escalated',
      idempotency_key: `remediation_escalated_${CTX.interventionId}_student`,
    });
    expectHouseShape(rows[0]);
    expect((rows[0].data as Record<string, unknown>).escalated_to).toBe('teacher');
    expect(tablesQueried).not.toContain('guardian_student_links');
  });

  it('parent path: student row + one row per preference-enabled guardian (preference-disabled skipped)', async () => {
    mockDb.state.guardianLinksResult = {
      data: [
        {
          guardian_id: 'g-1',
          guardians: {
            id: 'g-1',
            auth_user_id: 'auth-g1',
            notification_preferences: null, // defaults ON
            preferred_language: 'hi',
          },
        },
        {
          guardian_id: 'g-2',
          guardians: {
            id: 'g-2',
            auth_user_id: 'auth-g2',
            notification_preferences: { remediation_escalated: false }, // opted out
            preferred_language: 'en',
          },
        },
      ],
      error: null,
    };
    await onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'parent' });
    expect(tablesQueried).toContain('guardian_student_links');
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(2); // student + g-1 (g-2 opted out)

    const studentRow = rows.find((r) => r.recipient_type === 'student');
    const guardianRow = rows.find((r) => r.recipient_type === 'guardian');
    expect(studentRow).toBeDefined();
    expect(guardianRow).toMatchObject({
      recipient_id: 'g-1',
      type: 'remediation_escalated',
      idempotency_key: `remediation_escalated_${CTX.interventionId}_g-1`,
    });
    expectHouseShape(guardianRow!);
    expectHouseShape(studentRow!);
  });

  it('no-recipient path (escalatedTo null): student row only, supportive copy', async () => {
    await onRemediationEscalated('stu-1', { ...CTX, escalatedTo: null });
    const { rows } = onlyUpsert();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_type).toBe('student');
    expect((rows[0].data as Record<string, unknown>).escalated_to).toBeNull();
    expectHouseShape(rows[0]);
  });

  it('never throws when the guardian fetch fails (fire-and-forget; student row still sent)', async () => {
    mockDb.state.guardianLinksResult = { data: null, error: { message: 'rls boom' } };
    await expect(
      onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'parent' }),
    ).resolves.toBeUndefined();
    // Student row still goes out even when the guardian read failed.
    const { rows } = onlyUpsert();
    expect(rows.some((r) => r.recipient_type === 'student')).toBe(true);
  });
});
