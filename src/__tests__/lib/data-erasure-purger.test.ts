/**
 * Tests for `src/lib/data-erasure-purger.ts` — the Phase D.3 cron purger
 * core. The Deno-side `supabase/functions/data-erasure-purger/index.ts`
 * mirrors this logic line-for-line.
 *
 * Coverage:
 *   1. Cascade order — DELETEs execute in CASCADE_ORDER, students last.
 *   2. Happy path — pending row + due → completed + state_event emitted.
 *   3. Idempotency — non-pending rows are skipped by the SELECT filter;
 *      a pending row that gets raced by another tick gets `skipped`.
 *   4. Failure → rollback semantics: on a mid-cascade error the row is
 *      marked `failed` + error_message + ops audit. Rows already
 *      deleted are recorded for diagnostics.
 *   5. Absent table is skipped (e.g., parental_consent on staging).
 *   6. Auth_user_id is resolved BEFORE the students DELETE so audit_logs
 *      + notifications DELETEs succeed.
 *   7. State event payload includes the rowsDeleted map.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CASCADE_ORDER,
  processErasureRow,
  runErasureTick,
  type ErasureRow,
} from '@/lib/data-erasure-purger';

// ── In-memory mock SB ─────────────────────────────────────────────────────

const GUARDIAN_ID = '00000000-0000-0000-0000-00000000bbbb';
const STUDENT_ID = '00000000-0000-0000-0000-00000000cccc';
const SCHOOL_ID = '00000000-0000-0000-0000-00000000dddd';
const AUTH_USER_ID = '00000000-0000-0000-0000-00000000ffff';

type ErasureStatus = 'pending' | 'cancelled' | 'purging' | 'completed' | 'failed';
interface MockErasureRow {
  id: string;
  guardian_id: string;
  student_id: string;
  school_id: string | null;
  status: ErasureStatus;
  purge_at: string;
  processed_at: string | null;
  error_message: string | null;
}

interface MockState {
  erasure: MockErasureRow[];
  students: Array<{ id: string; auth_user_id: string | null }>;
  // Per-table delete counts and call order.
  deletes: Array<{ table: string; filter: Record<string, unknown>; count: number }>;
  stateEvents: Array<Record<string, unknown>>;
  auditLogs: Array<Record<string, unknown>>;
  // Bag of "rows by table" so we can simulate non-zero counts and
  // a failure at a specific table.
  rowsByTable: Record<string, number>;
  failOnTable: string | null;
}

function freshState(): MockState {
  return {
    erasure: [],
    students: [{ id: STUDENT_ID, auth_user_id: AUTH_USER_ID }],
    deletes: [],
    stateEvents: [],
    auditLogs: [],
    rowsByTable: {
      audit_logs: 3,
      notifications: 2,
      foxy_chat_messages: 7,
      quiz_attempts: 12,
      quiz_sessions: 4,
      score_history: 5,
      student_learning_profiles: 1,
      student_subscriptions: 1,
      class_students: 2,
      parental_consent: 1,
      guardian_student_links: 1,
      students: 1,
    },
    failOnTable: null,
  };
}

let state: MockState;

function buildMockSb() {
  // Promise-thenable update result so a bare `.eq(...).eq(...)` awaits to
  // a no-op `{ data, error }` shape AND also supports `.select().maybeSingle()`
  // continuation. We hand-roll a thenable that resolves to the post-update
  // state.
  return {
    from(table: string) {
      if (table === 'data_erasure_requests') {
        const buildUpdateChain = (patch: Partial<MockErasureRow>, applied: () => MockErasureRow[]) => {
          const apply = () => {
            const rows = applied();
            for (const r of rows) Object.assign(r, patch);
            return rows;
          };
          // Thenable so `await` resolves on a bare .eq chain.
          let cached: MockErasureRow[] | null = null;
          const result = {
            then(resolve: (v: { data: null; error: null }) => unknown) {
              if (cached === null) cached = apply();
              resolve({ data: null, error: null });
              return Promise.resolve({ data: null, error: null });
            },
            select: () => ({
              maybeSingle: () => {
                if (cached === null) cached = apply();
                return Promise.resolve({ data: cached[0] ?? null, error: null });
              },
            }),
          };
          return result;
        };
        return {
          select: () => ({
            eq: (k1: string, v1: unknown) => ({
              lte: () => ({
                order: () => ({
                  limit: () => {
                    if (k1 === 'status' && v1 === 'pending') {
                      const rows = state.erasure
                        .filter((r) => r.status === 'pending' && new Date(r.purge_at).getTime() <= Date.now())
                        .sort((a, b) => a.purge_at.localeCompare(b.purge_at));
                      return Promise.resolve({ data: rows, error: null });
                    }
                    return Promise.resolve({ data: [], error: null });
                  },
                }),
              }),
            }),
          }),
          update: (patch: Partial<MockErasureRow>) => ({
            eq: (k1: string, v1: unknown) => ({
              eq: (k2: string, v2: unknown) =>
                buildUpdateChain(patch, () =>
                  state.erasure.filter(
                    (r) =>
                      (r as unknown as Record<string, unknown>)[k1] === v1
                      && (r as unknown as Record<string, unknown>)[k2] === v2,
                  ),
                ),
              // The final completed/failed update — a single .eq() awaited bare.
              then: (resolve: (v: { data: null; error: null }) => unknown) => {
                const rows = state.erasure.filter(
                  (r) => (r as unknown as Record<string, unknown>)[k1] === v1,
                );
                for (const r of rows) Object.assign(r, patch);
                resolve({ data: null, error: null });
                return Promise.resolve({ data: null, error: null });
              },
              select: () => ({
                maybeSingle: () => {
                  const rows = state.erasure.filter(
                    (r) => (r as unknown as Record<string, unknown>)[k1] === v1,
                  );
                  for (const r of rows) Object.assign(r, patch);
                  return Promise.resolve({ data: rows[0] ?? null, error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'students') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => {
                const row = state.students.find((s) => s.id === val);
                return Promise.resolve({ data: row ?? null, error: null });
              },
            }),
          }),
          delete: (_opts: { count: 'exact' }) => ({
            eq: (col: string, val: unknown) => {
              if (state.failOnTable === 'students') {
                return Promise.resolve({ error: { message: 'simulated students failure' }, count: 0 });
              }
              const before = state.students.length;
              state.students = state.students.filter((s) => (s as unknown as Record<string, unknown>)[col] !== val);
              const removed = before - state.students.length;
              state.deletes.push({ table: 'students', filter: { [col]: val }, count: removed });
              return Promise.resolve({ error: null, count: state.rowsByTable.students ?? 0 });
            },
          }),
        };
      }
      if (table === 'state_events') {
        return {
          insert: (payload: Record<string, unknown>) => {
            state.stateEvents.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'audit_logs') {
        return {
          insert: (payload: Record<string, unknown>) => {
            state.auditLogs.push(payload);
            return Promise.resolve({ error: null });
          },
          delete: (_opts: { count: 'exact' }) => ({
            eq: (col: string, val: unknown) => {
              if (state.failOnTable === 'audit_logs') {
                return Promise.resolve({ error: { message: 'simulated audit_logs failure' }, count: 0 });
              }
              state.deletes.push({ table: 'audit_logs', filter: { [col]: val }, count: state.rowsByTable.audit_logs ?? 0 });
              return Promise.resolve({ error: null, count: state.rowsByTable.audit_logs ?? 0 });
            },
          }),
        };
      }
      // Generic delete handler for the rest of the cascade tables.
      return {
        delete: (_opts: { count: 'exact' }) => ({
          eq: (col: string, val: unknown) => {
            if (state.failOnTable === table) {
              return Promise.resolve({ error: { message: `simulated ${table} failure` }, count: 0 });
            }
            const cnt = state.rowsByTable[table] ?? 0;
            state.deletes.push({ table, filter: { [col]: val }, count: cnt });
            return Promise.resolve({ error: null, count: cnt });
          },
        }),
      };
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const NEXT_UUID_PREFIX = '00000000-0000-0000-0000-';
let nextUuid = 0;
const stableUuid = () => `${NEXT_UUID_PREFIX}${String(++nextUuid).padStart(12, '0')}`;

beforeEach(() => {
  state = freshState();
  nextUuid = 0;
  vi.useRealTimers();
});

// ── Cascade order ────────────────────────────────────────────────────────

describe('CASCADE_ORDER', () => {
  it('matches docs/runbooks/per-school-backup-restore.md §7 order, students last', () => {
    const order = CASCADE_ORDER.map((e) => e.table);
    expect(order).toEqual([
      'audit_logs',
      'notifications',
      'foxy_chat_messages',
      'quiz_attempts',
      'quiz_sessions',
      'score_history',
      'student_learning_profiles',
      'student_subscriptions',
      'class_students',
      'parental_consent',
      'guardian_student_links',
      'students',
    ]);
    expect(order[order.length - 1]).toBe('students');
  });
});

// ── processErasureRow ────────────────────────────────────────────────────

describe('processErasureRow', () => {
  function seedPendingRow(): MockErasureRow {
    const row: MockErasureRow = {
      id: 'req-1',
      guardian_id: GUARDIAN_ID,
      student_id: STUDENT_ID,
      school_id: SCHOOL_ID,
      status: 'pending',
      purge_at: new Date(Date.now() - 60_000).toISOString(),
      processed_at: null,
      error_message: null,
    };
    state.erasure.push(row);
    return row;
  }

  const allTables = new Set(CASCADE_ORDER.map((e) => e.table));

  it('happy path: cascade executes in order; row marked completed; event emitted', async () => {
    seedPendingRow();
    const sb = buildMockSb();
    const erasureRow: ErasureRow = {
      id: 'req-1',
      guardian_id: GUARDIAN_ID,
      student_id: STUDENT_ID,
    };
    const result = await processErasureRow(sb, erasureRow, allTables, () => new Date(), stableUuid);
    expect(result.status).toBe('completed');
    expect(result.rows_deleted).toBeDefined();

    // Order assertion — students must be the LAST DELETE.
    const deleteOrder = state.deletes.map((d) => d.table);
    expect(deleteOrder[deleteOrder.length - 1]).toBe('students');
    // Cascade order respected.
    expect(deleteOrder).toEqual(CASCADE_ORDER.map((e) => e.table));

    // Row marked completed.
    expect(state.erasure[0].status).toBe('completed');
    expect(state.erasure[0].processed_at).not.toBeNull();

    // State event emitted with rowsDeleted.
    const evt = state.stateEvents.find((e) => e.kind === 'parent.child_erasure_completed');
    expect(evt).toBeDefined();
    expect(((evt as Record<string, unknown>).payload as Record<string, unknown>).rowsDeleted).toBeDefined();
  });

  it('skips when row was already claimed by another tick', async () => {
    // Seed the row already in `purging` status.
    state.erasure.push({
      id: 'req-2',
      guardian_id: GUARDIAN_ID,
      student_id: STUDENT_ID,
      school_id: SCHOOL_ID,
      status: 'purging',
      purge_at: new Date(Date.now() - 60_000).toISOString(),
      processed_at: null,
      error_message: null,
    });
    const sb = buildMockSb();
    const result = await processErasureRow(
      sb,
      { id: 'req-2', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID },
      allTables,
      () => new Date(),
      stableUuid,
    );
    expect(result.status).toBe('skipped');
    expect(state.deletes).toHaveLength(0);
  });

  it('on mid-cascade failure: marks row failed + writes error_message + ops audit', async () => {
    seedPendingRow();
    state.failOnTable = 'quiz_sessions';
    const sb = buildMockSb();
    const result = await processErasureRow(
      sb,
      { id: 'req-1', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID },
      allTables,
      () => new Date(),
      stableUuid,
    );
    expect(result.status).toBe('failed');
    expect(result.error).toContain('quiz_sessions');

    // Row marked failed.
    expect(state.erasure[0].status).toBe('failed');
    expect(state.erasure[0].error_message).toContain('quiz_sessions');

    // Successful deletes before the failure are still recorded for diagnostics.
    const completedTables = state.deletes.map((d) => d.table);
    expect(completedTables).toContain('audit_logs');
    expect(completedTables).toContain('foxy_chat_messages');
    expect(completedTables).toContain('quiz_attempts');
    expect(completedTables).not.toContain('students'); // never reached

    // Ops audit alert written.
    const alert = state.auditLogs.find((a) => a.action === 'data_erasure.failed');
    expect(alert).toBeDefined();
  });

  it('absent table is skipped (e.g., parental_consent on staging)', async () => {
    seedPendingRow();
    const presentExceptParental = new Set(
      Array.from(allTables).filter((t) => t !== 'parental_consent'),
    );
    const sb = buildMockSb();
    const result = await processErasureRow(
      sb,
      { id: 'req-1', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID },
      presentExceptParental,
      () => new Date(),
      stableUuid,
    );
    expect(result.status).toBe('completed');
    const deletedTables = state.deletes.map((d) => d.table);
    expect(deletedTables).not.toContain('parental_consent');
    expect(deletedTables).toContain('students'); // ran to completion
  });

  it('audit_logs DELETE uses auth_user_id resolved from students BEFORE students DELETE', async () => {
    seedPendingRow();
    const sb = buildMockSb();
    await processErasureRow(
      sb,
      { id: 'req-1', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID },
      allTables,
      () => new Date(),
      stableUuid,
    );
    // The audit_logs DELETE should filter on actor_auth_user_id.
    const auditDel = state.deletes.find((d) => d.table === 'audit_logs');
    expect(auditDel).toBeDefined();
    expect(auditDel!.filter.actor_auth_user_id).toBe(AUTH_USER_ID);
    // Notifications likewise.
    const notifDel = state.deletes.find((d) => d.table === 'notifications');
    expect(notifDel).toBeDefined();
    expect(notifDel!.filter.recipient_id).toBe(AUTH_USER_ID);
  });

  it('emits parent.child_erasure_completed with the correct payload shape', async () => {
    seedPendingRow();
    const sb = buildMockSb();
    await processErasureRow(
      sb,
      { id: 'req-1', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID },
      allTables,
      () => new Date(),
      stableUuid,
    );
    const evt = state.stateEvents.find((e) => e.kind === 'parent.child_erasure_completed')!;
    const payload = (evt as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload.requestId).toBe('req-1');
    expect(payload.guardianId).toBe(GUARDIAN_ID);
    expect(payload.studentId).toBe(STUDENT_ID);
    expect(payload.rowsDeleted).toBeDefined();
    expect((payload.rowsDeleted as Record<string, number>).students).toBe(1);
  });
});

// ── runErasureTick — integration ──────────────────────────────────────────

describe('runErasureTick', () => {
  const allTables = new Set(CASCADE_ORDER.map((e) => e.table));

  it('processes only pending+overdue rows', async () => {
    // Three rows: one due+pending, one future+pending, one due+completed.
    state.erasure = [
      {
        id: 'r1', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID, school_id: SCHOOL_ID,
        status: 'pending', purge_at: new Date(Date.now() - 60_000).toISOString(),
        processed_at: null, error_message: null,
      },
      {
        id: 'r2', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID, school_id: SCHOOL_ID,
        status: 'pending', purge_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        processed_at: null, error_message: null,
      },
      {
        id: 'r3', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID, school_id: SCHOOL_ID,
        status: 'completed', purge_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        processed_at: new Date().toISOString(), error_message: null,
      },
    ];
    const sb = buildMockSb();
    const result = await runErasureTick(sb, allTables, () => new Date(), stableUuid);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('per-row failure does NOT abort the batch', async () => {
    state.erasure = [
      {
        id: 'r1', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID, school_id: SCHOOL_ID,
        status: 'pending', purge_at: new Date(Date.now() - 120_000).toISOString(),
        processed_at: null, error_message: null,
      },
      {
        id: 'r2', guardian_id: GUARDIAN_ID, student_id: STUDENT_ID, school_id: SCHOOL_ID,
        status: 'pending', purge_at: new Date(Date.now() - 60_000).toISOString(),
        processed_at: null, error_message: null,
      },
    ];
    // Toggle failure ON for r1 only — we can't switch in the mock so just
    // confirm errors+processed counts add up correctly when failOnTable is
    // set globally (which makes ALL rows fail).
    state.failOnTable = 'quiz_attempts';
    const sb = buildMockSb();
    const result = await runErasureTick(sb, allTables, () => new Date(), stableUuid);
    expect(result.processed + result.errors).toBe(2);
    // The mock fails all rows when failOnTable is set, so errors=2.
    expect(result.errors).toBe(2);
  });
});
