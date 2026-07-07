/**
 * Notification triggers — onLevelUp, onChapterComplete, onStreakMilestone (REG-136)
 *
 * Pins:
 *   1. P7 BILINGUAL: Every notification row carries both `body` (English) and
 *      `body_hi` (Hindi). Devanagari strings must be non-empty.
 *   2. P13 PRIVACY: `data` field carries only opaque IDs, numbers, and trigger
 *      strings — never email, phone, or name.
 *   3. STUDENT ROW ALWAYS INSERTED: Even when there are no linked guardians, the
 *      student-facing notification row is always created.
 *   4. GUARDIAN FANOUT: When guardians are linked, parent_achievement /
 *      parent_digest rows are added with the correct type.
 *   5. FIRE-AND-FORGET: Functions must not throw; they catch their own errors.
 *
 * Source: src/lib/notification-triggers.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Track all insert calls to the notifications table.
interface InsertedRows {
  table: string;
  rows: unknown[];
}
const insertedRows: InsertedRows[] = [];

let guardianQueryResult: unknown[] = [];
let insertShouldError = false;

const adminClient = {
  from: (table: string) => ({
    select: (_cols: string) => ({
      eq: (_col: string, _val: unknown) => ({
        eq: (_c: string, _v: unknown) => ({
          eq: (_c2: string, _v2: unknown) => ({
            // For guardian query (guardian_student_links)
            then: (resolve: (v: unknown) => unknown) =>
              resolve({ data: guardianQueryResult, error: null }),
          }),
          in: (_c2: string, _v2: unknown) => ({
            then: (resolve: (v: unknown) => unknown) =>
              resolve({ data: guardianQueryResult, error: null }),
          }),
          // For guardian_student_links with status = 'approved'
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: guardianQueryResult, error: null }),
        }),
      }),
    }),
    insert: (rows: unknown) => ({
      then: (resolve: (v: unknown) => unknown) => {
        const rowArray = Array.isArray(rows) ? rows : [rows];
        insertedRows.push({ table, rows: rowArray });
        if (insertShouldError) {
          return resolve({ data: null, error: { message: 'insert failed' } });
        }
        return resolve({ data: null, error: null });
      },
    }),
  }),
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGuardianLink(guardianId: string, prefs: Record<string, unknown> | null = null) {
  return {
    guardian_id: guardianId,
    guardians: {
      id: guardianId,
      auth_user_id: `auth-${guardianId}`,
      notification_preferences: prefs,
      preferred_language: 'en',
    },
  };
}

// ── onLevelUp ─────────────────────────────────────────────────────────────────

describe('onLevelUp notification trigger (REG-136)', () => {
  beforeEach(() => {
    insertedRows.length = 0;
    insertShouldError = false;
    guardianQueryResult = [];
    vi.resetModules();
  });

  it('inserts a student achievement row when no guardians are linked', async () => {
    guardianQueryResult = [];
    const { onLevelUp } = await import('@alfanumrik/lib/notification-triggers');
    await onLevelUp('student-1', {
      newLevel: 2,
      levelNameEn: 'Quick Learner',
      levelNameHi: 'तेज़ सीखने वाला',
    });

    expect(insertedRows.length).toBeGreaterThanOrEqual(1);
    const notification = insertedRows[0];
    expect(notification.table).toBe('notifications');
    const rows = notification.rows as Array<Record<string, unknown>>;
    const studentRow = rows.find((r) => r.recipient_type === 'student');
    expect(studentRow).toBeDefined();
    expect(studentRow?.type).toBe('achievement');
  });

  it('student notification row has English body and Hindi body_hi (P7)', async () => {
    guardianQueryResult = [];
    const { onLevelUp } = await import('@alfanumrik/lib/notification-triggers');
    await onLevelUp('student-2', {
      newLevel: 3,
      levelNameEn: 'Rising Star',
      levelNameHi: 'उदीयमान तारा',
    });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const studentRow = rows?.find((r) => r.recipient_type === 'student');
    expect(typeof studentRow?.body).toBe('string');
    expect((studentRow?.body as string).length).toBeGreaterThan(0);
    expect(typeof studentRow?.body_hi).toBe('string');
    expect((studentRow?.body_hi as string).length).toBeGreaterThan(0);
  });

  it('student notification data carries no email, phone, or name (P13)', async () => {
    guardianQueryResult = [];
    const { onLevelUp } = await import('@alfanumrik/lib/notification-triggers');
    await onLevelUp('student-3', {
      newLevel: 2,
      levelNameEn: 'Quick Learner',
      levelNameHi: 'तेज़ सीखने वाला',
    });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const studentRow = rows?.find((r) => r.recipient_type === 'student');
    const data = studentRow?.data as Record<string, unknown>;
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('phone');
    expect(data).not.toHaveProperty('name');
    expect(data.trigger).toBe('level_up');
    expect(typeof data.new_level).toBe('number');
  });

  it('fans out a parent_achievement row to linked guardians', async () => {
    guardianQueryResult = [makeGuardianLink('guardian-abc')];
    const { onLevelUp } = await import('@alfanumrik/lib/notification-triggers');
    await onLevelUp('student-4', {
      newLevel: 2,
      levelNameEn: 'Quick Learner',
      levelNameHi: 'तेज़ सीखने वाला',
    });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const guardianRow = rows?.find((r) => r.recipient_type === 'guardian');
    expect(guardianRow).toBeDefined();
    expect(guardianRow?.type).toBe('parent_achievement');
  });

  it('does not throw when insert fails (fire-and-forget)', async () => {
    guardianQueryResult = [];
    insertShouldError = true;
    const { onLevelUp } = await import('@alfanumrik/lib/notification-triggers');
    // Must not throw
    await expect(
      onLevelUp('student-5', {
        newLevel: 2,
        levelNameEn: 'Quick Learner',
        levelNameHi: 'तेज़ सीखने वाला',
      }),
    ).resolves.toBeUndefined();
  });
});

// ── onChapterComplete ─────────────────────────────────────────────────────────

describe('onChapterComplete notification trigger (REG-136)', () => {
  beforeEach(() => {
    insertedRows.length = 0;
    insertShouldError = false;
    guardianQueryResult = [];
    vi.resetModules();
  });

  it('inserts a student achievement row for chapter completion', async () => {
    guardianQueryResult = [];
    const { onChapterComplete } = await import('@alfanumrik/lib/notification-triggers');
    await onChapterComplete('student-10', { subject: 'Physics', xpEarned: 100 });

    expect(insertedRows.length).toBeGreaterThanOrEqual(1);
    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const studentRow = rows.find((r) => r.recipient_type === 'student');
    expect(studentRow?.type).toBe('achievement');
  });

  it('includes XP amount in both English and Hindi body (P7)', async () => {
    guardianQueryResult = [];
    const { onChapterComplete } = await import('@alfanumrik/lib/notification-triggers');
    await onChapterComplete('student-11', { subject: 'Chemistry', xpEarned: 100 });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const studentRow = rows?.find((r) => r.recipient_type === 'student');
    const bodyEn = studentRow?.body as string;
    const bodyHi = studentRow?.body_hi as string;
    expect(bodyEn).toContain('100');
    expect(bodyHi).toContain('100');
    expect(bodyHi.length).toBeGreaterThan(0);
  });

  it('fans out a parent_digest row to linked guardians', async () => {
    guardianQueryResult = [makeGuardianLink('guardian-def')];
    const { onChapterComplete } = await import('@alfanumrik/lib/notification-triggers');
    await onChapterComplete('student-12', { subject: 'Maths', xpEarned: 100 });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const guardianRow = rows?.find((r) => r.recipient_type === 'guardian');
    expect(guardianRow).toBeDefined();
    expect(guardianRow?.type).toBe('parent_digest');
  });

  it('data field carries no PII (P13)', async () => {
    guardianQueryResult = [];
    const { onChapterComplete } = await import('@alfanumrik/lib/notification-triggers');
    await onChapterComplete('student-13', { subject: 'Biology', xpEarned: 100 });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const studentRow = rows?.find((r) => r.recipient_type === 'student');
    const data = studentRow?.data as Record<string, unknown>;
    expect(data.trigger).toBe('chapter_complete');
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('phone');
  });

  it('does not throw on insert failure (fire-and-forget)', async () => {
    guardianQueryResult = [];
    insertShouldError = true;
    const { onChapterComplete } = await import('@alfanumrik/lib/notification-triggers');
    await expect(
      onChapterComplete('student-14', { subject: 'History', xpEarned: 100 }),
    ).resolves.toBeUndefined();
  });
});

// ── onStreakMilestone ─────────────────────────────────────────────────────────

describe('onStreakMilestone notification trigger (REG-136)', () => {
  beforeEach(() => {
    insertedRows.length = 0;
    insertShouldError = false;
    guardianQueryResult = [];
    vi.resetModules();
  });

  it('inserts a student achievement row for streak milestone', async () => {
    guardianQueryResult = [];
    const { onStreakMilestone } = await import('@alfanumrik/lib/notification-triggers');
    await onStreakMilestone('student-20', { days: 7, coinsAwarded: 40 });

    expect(insertedRows.length).toBeGreaterThanOrEqual(1);
    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const studentRow = rows.find((r) => r.recipient_type === 'student');
    expect(studentRow?.type).toBe('achievement');
  });

  it('streak day count appears in both English and Hindi body (P7)', async () => {
    guardianQueryResult = [];
    const { onStreakMilestone } = await import('@alfanumrik/lib/notification-triggers');
    await onStreakMilestone('student-21', { days: 30, coinsAwarded: 150 });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const studentRow = rows?.find((r) => r.recipient_type === 'student');
    expect((studentRow?.body as string)).toContain('30');
    expect((studentRow?.body_hi as string)).toContain('30');
  });

  it('fans out parent_achievement to linked guardians', async () => {
    guardianQueryResult = [makeGuardianLink('guardian-ghi')];
    const { onStreakMilestone } = await import('@alfanumrik/lib/notification-triggers');
    await onStreakMilestone('student-22', { days: 7, coinsAwarded: 40 });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const guardianRow = rows?.find((r) => r.recipient_type === 'guardian');
    expect(guardianRow?.type).toBe('parent_achievement');
  });

  it('data carries streak_days as number and coins_awarded as number (P13 — no PII)', async () => {
    guardianQueryResult = [];
    const { onStreakMilestone } = await import('@alfanumrik/lib/notification-triggers');
    await onStreakMilestone('student-23', { days: 100, coinsAwarded: 500 });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const studentRow = rows?.find((r) => r.recipient_type === 'student');
    const data = studentRow?.data as Record<string, unknown>;
    expect(data.trigger).toBe('streak_milestone');
    expect(typeof data.streak_days).toBe('number');
    expect(typeof data.coins_awarded).toBe('number');
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('phone');
    expect(data).not.toHaveProperty('name');
  });

  it('does not throw on insert failure (fire-and-forget)', async () => {
    guardianQueryResult = [];
    insertShouldError = true;
    const { onStreakMilestone } = await import('@alfanumrik/lib/notification-triggers');
    await expect(
      onStreakMilestone('student-24', { days: 7, coinsAwarded: 40 }),
    ).resolves.toBeUndefined();
  });
});

// ── Notification preference filtering ────────────────────────────────────────

describe('Notification preference filtering', () => {
  beforeEach(() => {
    insertedRows.length = 0;
    insertShouldError = false;
    guardianQueryResult = [];
    vi.resetModules();
  });

  it('onLevelUp respects guardian achievement=false preference (no guardian row)', async () => {
    // Guardian with achievement notifications turned off
    guardianQueryResult = [makeGuardianLink('guardian-opt-out', { achievement: false })];
    const { onLevelUp } = await import('@alfanumrik/lib/notification-triggers');
    await onLevelUp('student-30', {
      newLevel: 2,
      levelNameEn: 'Quick Learner',
      levelNameHi: 'तेज़ सीखने वाला',
    });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const guardianRows = rows?.filter((r) => r.recipient_type === 'guardian') ?? [];
    expect(guardianRows.length).toBe(0);
  });

  it('onStreakMilestone respects guardian streak_milestone=false preference', async () => {
    guardianQueryResult = [makeGuardianLink('guardian-opt-out-2', { streak_milestone: false })];
    const { onStreakMilestone } = await import('@alfanumrik/lib/notification-triggers');
    await onStreakMilestone('student-31', { days: 7, coinsAwarded: 40 });

    const rows = insertedRows[0]?.rows as Array<Record<string, unknown>>;
    const guardianRows = rows?.filter((r) => r.recipient_type === 'guardian') ?? [];
    expect(guardianRows.length).toBe(0);
  });
});
