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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@alfanumrik/lib/logger', () => ({
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

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: mockDb.adminClient,
  getSupabaseAdmin: () => mockDb.adminClient,
}));

import { logger } from '@alfanumrik/lib/logger';
import {
  onRemediationAssigned,
  onRemediationRecovered,
  onRemediationEscalated,
} from '@alfanumrik/lib/notification-triggers';

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

// ════════════════════════════════════════════════════════════════════════════
// onRemediationEscalated — WhatsApp channel (Master Action Plan Phase 3, item
// 3.5). sendWhatsAppEscalation() is a private, unexported helper in
// notification-triggers.ts, so it is exercised here only THROUGH the public
// onRemediationEscalated() entry point — mirroring how it is actually invoked
// in production. Prior to this describe block NOTHING asserted the fetch call
// ever fires: every guardian fixture above omits `phone`, which makes
// sendWhatsAppEscalation's `if (!guardian.phone) return;` guard short-circuit
// before any fetch — so the WhatsApp wiring had zero real coverage.
// ════════════════════════════════════════════════════════════════════════════

describe('onRemediationEscalated — WhatsApp channel (item 3.5)', () => {
  const guardianWithPhone = (overrides: Record<string, unknown> = {}) => ({
    data: [
      {
        guardian_id: 'g-1',
        guardians: {
          id: 'g-1',
          auth_user_id: 'auth-g1',
          notification_preferences: null,
          preferred_language: 'hi',
          phone: '+919876543210',
          ...overrides,
        },
      },
    ],
    error: null,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parent guardian WITH a phone on file: POSTs to whatsapp-notify with the correct payload + Bearer auth', async () => {
    mockDb.state.guardianLinksResult = guardianWithPhone();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'parent' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/whatsapp-notify');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      type: 'remediation_escalated',
      recipient_phone: '+919876543210',
      language: 'hi', // derived from guardian.preferred_language
      data: { subject_code: 'math', chapter_number: '4' },
      user_id: 'auth-g1',
    });
    // P13: no name/email/raw-phone-adjacent PII keys beyond the phone itself
    // required to actually deliver the message.
    expect(Object.keys(body.data)).toEqual(['subject_code', 'chapter_number']);
  });

  it('guardian language defaults to "en" when preferred_language is not "hi"', async () => {
    mockDb.state.guardianLinksResult = guardianWithPhone({ preferred_language: 'en' });
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'parent' });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.language).toBe('en');
  });

  it('guardian with NO phone on file: fetch is never called (in-app row still sent)', async () => {
    mockDb.state.guardianLinksResult = {
      data: [{
        guardian_id: 'g-1',
        guardians: { id: 'g-1', auth_user_id: 'auth-g1', notification_preferences: null, preferred_language: 'en' },
      }],
      error: null,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'parent' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onlyUpsert().rows.some((r) => r.recipient_type === 'guardian')).toBe(true);
  });

  it('teacher path never invokes the WhatsApp channel (guardians are never queried)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'teacher' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a non-2xx whatsapp-notify response is logged as a warning and never throws (in-app row is the durable record)', async () => {
    mockDb.state.guardianLinksResult = guardianWithPhone();
    const fetchMock = vi.fn().mockResolvedValue(new Response('template not approved', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'parent' }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'notification_triggers: whatsapp escalation send failed',
      expect.objectContaining({ templateType: 'remediation_escalated', status: 502 }),
    );
    // The in-app notification row still went out despite the WhatsApp failure.
    expect(onlyUpsert().rows.some((r) => r.recipient_type === 'guardian')).toBe(true);
  });

  it('a network-level fetch rejection is swallowed (logged as a warning, never thrown)', async () => {
    mockDb.state.guardianLinksResult = guardianWithPhone();
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'parent' }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'notification_triggers: whatsapp escalation send error',
      expect.objectContaining({ templateType: 'remediation_escalated', error: 'ECONNRESET' }),
    );
  });

  it('missing Supabase env configuration short-circuits before any fetch (best-effort only)', async () => {
    mockDb.state.guardianLinksResult = guardianWithPhone();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      await onRemediationEscalated('stu-1', { ...CTX, escalatedTo: 'parent' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    }
  });
});
