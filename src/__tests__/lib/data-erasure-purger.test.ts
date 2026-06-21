import { describe, it, expect, beforeEach } from 'vitest';
import { CASCADE_ORDER, processErasureRow, runErasureTick, type ErasureRow } from '@/lib/data-erasure-purger';

const GUARDIAN_ID = '00000000-0000-0000-0000-00000000bbbb';
const STUDENT_ID = '00000000-0000-0000-0000-00000000cccc';
const SCHOOL_ID = '00000000-0000-0000-0000-00000000dddd';

type ErasureStatus = 'pending' | 'cancelled' | 'purging' | 'completed' | 'failed';
interface MockErasureRow { id: string; guardian_id: string; student_id: string; school_id: string | null; status: ErasureStatus; purge_at: string; processed_at: string | null; error_message: string | null }
interface MockState { erasure: MockErasureRow[]; rpcCalls: Array<Record<string, unknown>>; auditLogs: Array<Record<string, unknown>>; stateEvents: Array<Record<string, unknown>>; rpcError: string | null; rpcRows: Record<string, number> }

let state: MockState;
function freshState(): MockState { return { erasure: [], rpcCalls: [], auditLogs: [], stateEvents: [], rpcError: null, rpcRows: { students: 1, quiz_attempts: 3 } }; }
function seedRow(status: ErasureStatus = 'pending', id = 'req-1'): MockErasureRow { const row = { id, guardian_id: GUARDIAN_ID, student_id: STUDENT_ID, school_id: SCHOOL_ID, status, purge_at: new Date(Date.now() - 60_000).toISOString(), processed_at: null, error_message: null }; state.erasure.push(row); return row; }

function buildMockSb() {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ name, ...args });
      const row = state.erasure.find((r) => r.id === args.p_request_id);
      if (!row) return Promise.resolve({ data: null, error: { message: 'locked or absent' } });
      if (row.status === 'completed') return Promise.resolve({ data: { status: 'completed', already_completed: true, rows_deleted: {}, school_id: row.school_id }, error: null });
      if (row.status !== 'pending') return Promise.resolve({ data: null, error: { message: `not pending (status=${row.status})` } });
      if (state.rpcError) return Promise.resolve({ data: null, error: { message: state.rpcError } });
      if (args.p_dry_run === true) return Promise.resolve({ data: { status: 'dry_run', dry_run: true, rows_deleted: state.rpcRows, school_id: row.school_id }, error: null });
      row.status = 'completed'; row.processed_at = new Date().toISOString();
      return Promise.resolve({ data: { status: 'completed', rows_deleted: state.rpcRows, school_id: row.school_id }, error: null });
    },
    from(table: string) {
      if (table === 'data_erasure_requests') return { select: () => ({ eq: (_k: string, v: unknown) => ({ lte: () => ({ order: () => ({ limit: () => Promise.resolve({ data: state.erasure.filter((r) => r.status === v && new Date(r.purge_at).getTime() <= Date.now()), error: null }) }) }) }) }) };
      if (table === 'audit_logs') return { insert: (payload: Record<string, unknown>) => { state.auditLogs.push(payload); return Promise.resolve({ error: null }); } };
      if (table === 'state_events') return { insert: (payload: Record<string, unknown>) => { state.stateEvents.push(payload); return Promise.resolve({ error: null }); } };
      return { insert: () => Promise.resolve({ error: null }) };
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const stableUuid = () => '00000000-0000-0000-0000-000000000001';
const allTables = new Set(CASCADE_ORDER.map((e) => e.table));
const rowRef = (id = 'req-1'): ErasureRow => ({ id, guardian_id: GUARDIAN_ID, student_id: STUDENT_ID });

beforeEach(() => { state = freshState(); });

describe('data-erasure-purger compliance core', () => {
  it('keeps destructive cascade order documented with students last', () => {
    expect(CASCADE_ORDER.map((e) => e.table).at(-1)).toBe('students');
  });

  it('delegates purge to transaction-safe RPC and writes before/after immutable audit events', async () => {
    seedRow();
    const result = await processErasureRow(buildMockSb(), rowRef(), allTables, () => new Date(), stableUuid);
    expect(result.status).toBe('completed');
    expect(state.rpcCalls[0]).toMatchObject({ name: 'execute_data_erasure_purge', p_request_id: 'req-1', p_dry_run: false });
    expect(state.auditLogs.map((a) => a.action)).toEqual(['data_erasure.purge_started', 'data_erasure.purge_completed']);
    expect(state.stateEvents[0].kind).toBe('parent.child_erasure_completed');
  });

  it('supports dry-run mode without completing the request', async () => {
    seedRow();
    const result = await processErasureRow(buildMockSb(), rowRef(), allTables, () => new Date(), stableUuid, { dryRun: true });
    expect(result.status).toBe('dry_run');
    expect(state.erasure[0].status).toBe('pending');
    expect(state.rpcCalls[0]).toMatchObject({ p_dry_run: true });
    expect(state.auditLogs.map((a) => a.action)).toEqual(['data_erasure.dry_run_started', 'data_erasure.dry_run_completed']);
  });

  it('concurrent/already claimed invocation is classified as permanent failure by the RPC', async () => {
    seedRow('purging');
    const result = await processErasureRow(buildMockSb(), rowRef(), allTables, () => new Date(), stableUuid);
    expect(result.status).toBe('failed');
    expect(result.failure_classification).toBe('permanent');
  });

  it('already-completed request is idempotent and does not re-delete data', async () => {
    seedRow('completed');
    const result = await processErasureRow(buildMockSb(), rowRef(), allTables, () => new Date(), stableUuid);
    expect(result.status).toBe('completed');
    expect(result.rows_deleted).toEqual({});
  });

  it('failed mid-cascade is reported with orphan-risk classification when FK/orphan language appears', async () => {
    seedRow(); state.rpcError = 'foreign key violation leaves orphan risk';
    const result = await processErasureRow(buildMockSb(), rowRef(), allTables, () => new Date(), stableUuid);
    expect(result.status).toBe('failed');
    expect(result.failure_classification).toBe('orphan-risk');
    expect(state.auditLogs.at(-1)?.action).toBe('data_erasure.failed');
  });

  it('missing optional tables are represented as null counts during dry-run', async () => {
    seedRow(); state.rpcRows = { parental_consent: null as unknown as number, students: 1 };
    const result = await processErasureRow(buildMockSb(), rowRef(), allTables, () => new Date(), stableUuid, { dryRun: true });
    expect(result.rows_deleted?.parental_consent).toBeNull();
  });

  it('tick processes pending rows through the same RPC path', async () => {
    seedRow('pending', 'r1'); seedRow('completed', 'r2');
    const result = await runErasureTick(buildMockSb(), allTables, () => new Date(), stableUuid);
    expect(result.processed).toBe(1);
    expect(state.rpcCalls).toHaveLength(1);
  });
});
