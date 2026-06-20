/**
 * Track A.6 — enqueueWebhook fan-out tests (`src/lib/public-api/webhook-enqueue.ts`).
 * ============================================================================
 * Covers (per the testing brief, item 6):
 *   - Fans out ONE delivery row per ACTIVE subscription matching the event_type
 *     for that school.
 *   - Tenant-scoped: the subscription lookup filters .eq('school_id', schoolId)
 *     .eq('is_active', true).contains('event_types', [eventType]); the delivery
 *     rows copy that school_id.
 *   - Idempotent by caller-supplied event_id: the same eventId stamps the same
 *     envelope.event_id on every delivery row (the dispatcher dedupes on it).
 *   - Fail-safe: never throws; lookup/insert errors return zero counts.
 *   - P13: logging carries counts + event type + school only — never payload PII.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockLoggerInfo, mockLoggerError, state } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
  state: {
    subs: [] as Array<{ id: string }>,
    subsError: null as { message: string } | null,
    insertError: null as { message: string } | null,
    capturedFilters: [] as Array<{ method: string; args: unknown[] }>,
    insertedRows: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: (...a: unknown[]) => mockLoggerInfo(...a), error: (...a: unknown[]) => mockLoggerError(...a), warn: vi.fn() },
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'webhook_subscriptions') {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = (col: string, val: unknown) => {
          state.capturedFilters.push({ method: 'eq', args: [col, val] });
          return b;
        };
        b.contains = (col: string, val: unknown) => {
          state.capturedFilters.push({ method: 'contains', args: [col, val] });
          return Promise.resolve({ data: state.subs, error: state.subsError });
        };
        return b;
      }
      if (table === 'webhook_deliveries') {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            state.insertedRows = rows;
            return Promise.resolve({
              error: state.insertError,
              count: state.insertError ? null : rows.length,
            });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { enqueueWebhook } from '@/lib/public-api/webhook-enqueue';

const SCHOOL_A = 'school-A';

beforeEach(() => {
  vi.clearAllMocks();
  state.subs = [];
  state.subsError = null;
  state.insertError = null;
  state.capturedFilters = [];
  state.insertedRows = [];
});

describe('enqueueWebhook — fan-out per active matching subscription', () => {
  it('inserts one delivery row per matching active subscription', async () => {
    state.subs = [{ id: 'sub-1' }, { id: 'sub-2' }, { id: 'sub-3' }];
    const result = await enqueueWebhook(SCHOOL_A, 'roster.import.completed', { created: 5 });
    expect(result).toEqual({ enqueued: 3, matched: 3 });
    expect(state.insertedRows).toHaveLength(3);
    expect(state.insertedRows.map((r) => r.subscription_id).sort()).toEqual(['sub-1', 'sub-2', 'sub-3']);
  });

  it('returns zero when no subscription matches', async () => {
    state.subs = [];
    const result = await enqueueWebhook(SCHOOL_A, 'roster.import.completed', {});
    expect(result).toEqual({ enqueued: 0, matched: 0 });
    expect(state.insertedRows).toHaveLength(0);
  });
});

describe('enqueueWebhook — tenant scoping', () => {
  it('filters subscriptions by school_id + is_active + event_types contains, and stamps school_id on deliveries', async () => {
    state.subs = [{ id: 'sub-1' }];
    await enqueueWebhook(SCHOOL_A, 'student.enrolled', { count: 1 });

    const eqs = state.capturedFilters.filter((f) => f.method === 'eq');
    expect(eqs).toContainEqual({ method: 'eq', args: ['school_id', SCHOOL_A] });
    expect(eqs).toContainEqual({ method: 'eq', args: ['is_active', true] });
    const contains = state.capturedFilters.find((f) => f.method === 'contains');
    expect(contains?.args).toEqual(['event_types', ['student.enrolled']]);

    // Delivery row is scoped to the same school.
    expect(state.insertedRows[0].school_id).toBe(SCHOOL_A);
  });

  it('empty schoolId / eventType is a no-op (never touches the DB)', async () => {
    const r1 = await enqueueWebhook('', 'student.enrolled', {});
    const r2 = await enqueueWebhook(SCHOOL_A, '', {});
    expect(r1).toEqual({ enqueued: 0, matched: 0 });
    expect(r2).toEqual({ enqueued: 0, matched: 0 });
    expect(state.capturedFilters).toHaveLength(0);
  });
});

describe('enqueueWebhook — idempotency by event_id', () => {
  it('stamps a caller-supplied eventId on every delivery envelope', async () => {
    state.subs = [{ id: 'sub-1' }, { id: 'sub-2' }];
    await enqueueWebhook(SCHOOL_A, 'report.generated', { report: 'x' }, { eventId: 'evt-fixed-123' });
    for (const row of state.insertedRows) {
      const env = row.payload as { event_id: string };
      expect(env.event_id).toBe('evt-fixed-123');
    }
  });

  it('generates a stable per-call event_id when none supplied (same across the fan-out)', async () => {
    state.subs = [{ id: 'sub-1' }, { id: 'sub-2' }];
    await enqueueWebhook(SCHOOL_A, 'report.generated', {});
    const ids = state.insertedRows.map((r) => (r.payload as { event_id: string }).event_id);
    expect(new Set(ids).size).toBe(1); // one event id shared across the batch
    expect(ids[0]).toBeTruthy();
  });
});

describe('enqueueWebhook — fail-safe (never throws)', () => {
  it('returns zero counts on a subscription lookup error', async () => {
    state.subsError = { message: 'db down' };
    const result = await enqueueWebhook(SCHOOL_A, 'student.enrolled', {});
    expect(result).toEqual({ enqueued: 0, matched: 0 });
  });

  it('returns enqueued:0 (matched preserved) on an insert error, never throwing', async () => {
    state.subs = [{ id: 'sub-1' }, { id: 'sub-2' }];
    state.insertError = { message: 'insert failed' };
    const result = await enqueueWebhook(SCHOOL_A, 'student.enrolled', {});
    expect(result.enqueued).toBe(0);
    expect(result.matched).toBe(2);
  });
});

describe('enqueueWebhook — P13: counts/type/school only in logs', () => {
  it('success log carries counts + event type + school, never payload PII', async () => {
    state.subs = [{ id: 'sub-1' }];
    await enqueueWebhook(SCHOOL_A, 'student.enrolled', {
      // Payload deliberately carries a student name the LOGS must not echo.
      student_name: 'Priya Nair',
      email: 'priya.nair@school.edu',
    });
    const blob = JSON.stringify(mockLoggerInfo.mock.calls);
    expect(blob).toMatch(/student\.enrolled/);
    expect(blob).toMatch(/school-A/);
    expect(blob).not.toMatch(/Priya Nair/);
    expect(blob).not.toMatch(/priya\.nair@school\.edu/);
  });

  it('error log carries event type + school only, never payload PII', async () => {
    state.subsError = { message: 'db down' };
    await enqueueWebhook(SCHOOL_A, 'student.enrolled', { student_name: 'Priya Nair' });
    const blob = JSON.stringify(mockLoggerError.mock.calls);
    expect(blob).not.toMatch(/Priya Nair/);
  });
});
