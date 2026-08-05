import { describe, it, expect } from 'vitest';
import { runErasureTick } from '@alfanumrik/lib/data-erasure-purger';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Foxy North-Star Phase 1 — scope-aware ROUTING on the erasure worker.
 *
 * Student-initiated scoped memory erasures (/api/learner/memory DELETE) write
 * `scope` JSONB rows into data_erasure_requests. As of migration
 * 20260806000700 the SQL worker `execute_data_erasure_purge` is SCOPE-AWARE:
 * it reads the request row's scope itself and, when scope IS NOT NULL, purges
 * ONLY the mapped memory-layer tables (an unknown layer fails closed inside
 * the RPC — never the full-account cascade). The tick therefore ROUTES scoped
 * rows into the same RPC path as full-account rows (the previous behavior —
 * skipping scoped rows — is retired).
 *
 * Pins:
 *  1. Scoped rows are routed to execute_data_erasure_purge (not skipped) and
 *     full rows keep flowing.
 *  2. Scoped completion emits NO parent.child_erasure_completed state event
 *     (that event is exclusively for the parent-initiated full-account flow);
 *     full-account completion still emits it.
 *  3. Backward compatibility: when the `scope` column doesn't exist yet
 *     (pre-migration deploy), the tick falls back to the legacy projection and
 *     keeps processing full-account rows.
 */

interface Call {
  rpc: string;
  args: Record<string, unknown>;
}

function makeFakeSb(opts: {
  rows: Array<Record<string, unknown>>;
  scopeColumnExists: boolean;
}): { sb: SupabaseClient; rpcCalls: Call[]; stateEventInserts: Array<Record<string, unknown>> } {
  const rpcCalls: Call[] = [];
  const stateEventInserts: Array<Record<string, unknown>> = [];
  const makeSelectChain = (cols: string) => {
    const failScope = !opts.scopeColumnExists && cols.includes('scope');
    const result = failScope
      ? { data: null, error: { message: 'column data_erasure_requests.scope does not exist' } }
      : {
          data: opts.rows.map((r) => {
            if (!cols.includes('scope')) {
              const { scope: _scope, ...rest } = r;
              return rest;
            }
            return r;
          }),
          error: null,
        };
    const chain: Record<string, unknown> = {};
    for (const m of ['eq', 'lte', 'order']) chain[m] = () => chain;
    chain.limit = () => Promise.resolve(result);
    return chain;
  };
  const sb = {
    from: (table: string) => {
      if (table === 'data_erasure_requests') {
        return { select: (cols: string) => makeSelectChain(cols) };
      }
      if (table === 'state_events') {
        return {
          insert: (row: Record<string, unknown>) => {
            stateEventInserts.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      // audit_logs best-effort writes.
      return { insert: () => Promise.resolve({ data: null, error: null }) };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ rpc: name, args });
      return Promise.resolve({
        data: { status: 'completed', rows_deleted: { students: 1 }, dry_run: false },
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  return { sb, rpcCalls, stateEventInserts };
}

const FULL_ROW = { id: 'req-full', guardian_id: 'g-1', student_id: 's-1', scope: null };
const SCOPED_ROW = {
  id: 'req-scoped',
  guardian_id: null,
  student_id: 's-2',
  scope: { layer: 'long_memory' },
};

describe('runErasureTick — scope-aware routing', () => {
  it('ROUTES scoped rows into execute_data_erasure_purge alongside full rows', async () => {
    const { sb, rpcCalls } = makeFakeSb({ rows: [FULL_ROW, SCOPED_ROW], scopeColumnExists: true });
    const result = await runErasureTick(sb, new Set());

    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    const purgeCalls = rpcCalls.filter((c) => c.rpc === 'execute_data_erasure_purge');
    expect(purgeCalls).toHaveLength(2);
    expect(purgeCalls.map((c) => c.args.p_request_id).sort()).toEqual(['req-full', 'req-scoped']);
  });

  it('emits parent.child_erasure_completed ONLY for full-account rows, never scoped ones', async () => {
    const { sb, stateEventInserts } = makeFakeSb({ rows: [FULL_ROW, SCOPED_ROW], scopeColumnExists: true });
    await runErasureTick(sb, new Set());

    const parentEvents = stateEventInserts.filter((e) => e.kind === 'parent.child_erasure_completed');
    expect(parentEvents).toHaveLength(1);
    const payload = parentEvents[0].payload as Record<string, unknown>;
    expect(payload.requestId).toBe('req-full');
  });

  it('falls back to the legacy projection when the scope column does not exist yet', async () => {
    const { sb, rpcCalls } = makeFakeSb({ rows: [FULL_ROW], scopeColumnExists: false });
    const result = await runErasureTick(sb, new Set());
    expect(result.processed).toBe(1);
    expect(rpcCalls.filter((c) => c.rpc === 'execute_data_erasure_purge')).toHaveLength(1);
  });
});
