/**
 * Unified Student Memory — DPDP erasure guard unit tests (GenAI arch Phase 2).
 *
 * Pins the ONE genuinely new behavior gated by `ff_unified_memory_v1`:
 * `isErasurePending` reads `public.data_erasure_requests` on the SERVICE-ROLE
 * admin client and trips (returns true) when the student has an in-flight
 * erasure row (status pending|purging). It is FAIL-CLOSED — any query error or
 * thrown exception also trips the guard, because a privacy guard must never
 * fail open (an errored check that returned false would leak a mid-erasure
 * student's learner-state into an AI prompt).
 *
 * Terminal statuses (cancelled|completed|failed) do NOT trip.
 *
 * Hermetic: a fake Supabase query builder captures the .from/.eq/.in shape and
 * returns a canned { data, error }. No network, no live DB.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isErasurePending,
  ERASURE_IN_FLIGHT_STATUSES,
} from '@alfanumrik/lib/memory/erasure-guard';

// ─── Fake service-role client ────────────────────────────────────────────────
// Mirrors the exact chain the guard uses:
//   sb.from('data_erasure_requests').select('id')
//     .eq('student_id', id).in('status', [...]).limit(1)  → { data, error }
type QueryResult = { data: Array<{ id: string }> | null; error: { message: string } | null };

interface Calls {
  from: string[];
  select: string[];
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown]>;
  limit: number[];
}

function makeSb(result: QueryResult, opts: { throwOnFrom?: boolean } = {}): {
  sb: SupabaseClient;
  calls: Calls;
} {
  const calls: Calls = { from: [], select: [], eq: [], in: [], limit: [] };
  const builder: Record<string, unknown> = {
    select(cols: string) {
      calls.select.push(cols);
      return builder;
    },
    eq(k: string, v: unknown) {
      calls.eq.push([k, v]);
      return builder;
    },
    in(k: string, v: unknown) {
      calls.in.push([k, v]);
      return builder;
    },
    limit(n: number) {
      calls.limit.push(n);
      return Promise.resolve(result);
    },
  };
  const sb = {
    from(table: string) {
      calls.from.push(table);
      if (opts.throwOnFrom) throw new Error('boom: client exploded');
      return builder;
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const STUDENT_ID = 'student-abc';

describe('isErasurePending — in-flight statuses trip (true)', () => {
  it('returns true when a pending erasure row exists', async () => {
    const { sb } = makeSb({ data: [{ id: 'req-1' }], error: null });
    await expect(isErasurePending(STUDENT_ID, sb)).resolves.toBe(true);
  });

  it('returns true when a purging erasure row exists', async () => {
    // The status filter is applied by the query; a returned row means the DB
    // matched pending|purging. This asserts a non-empty result → trip.
    const { sb } = makeSb({ data: [{ id: 'req-2' }], error: null });
    await expect(isErasurePending(STUDENT_ID, sb)).resolves.toBe(true);
  });

  it('pending and purging are the only in-flight statuses', () => {
    expect(ERASURE_IN_FLIGHT_STATUSES).toEqual(['pending', 'purging']);
    expect(ERASURE_IN_FLIGHT_STATUSES).not.toContain('cancelled');
    expect(ERASURE_IN_FLIGHT_STATUSES).not.toContain('completed');
    expect(ERASURE_IN_FLIGHT_STATUSES).not.toContain('failed');
  });
});

describe('isErasurePending — terminal / absent statuses do NOT trip (false)', () => {
  it('returns false when zero rows match (no in-flight request)', async () => {
    // cancelled|completed|failed are terminal → they never satisfy the
    // status IN ('pending','purging') filter, so the DB returns zero rows.
    const { sb } = makeSb({ data: [], error: null });
    await expect(isErasurePending(STUDENT_ID, sb)).resolves.toBe(false);
  });

  it('returns false when data is null (no rows)', async () => {
    const { sb } = makeSb({ data: null, error: null });
    await expect(isErasurePending(STUDENT_ID, sb)).resolves.toBe(false);
  });
});

describe('isErasurePending — FAIL-CLOSED', () => {
  it('returns true (fail-closed) when the query returns an error', async () => {
    const { sb } = makeSb({ data: null, error: { message: 'permission denied' } });
    await expect(isErasurePending(STUDENT_ID, sb)).resolves.toBe(true);
  });

  it('returns true (fail-closed) when the client throws', async () => {
    const { sb } = makeSb({ data: null, error: null }, { throwOnFrom: true });
    await expect(isErasurePending(STUDENT_ID, sb)).resolves.toBe(true);
  });

  it('returns true (fail-closed) when limit() rejects', async () => {
    const calls: Calls = { from: [], select: [], eq: [], in: [], limit: [] };
    const builder: Record<string, unknown> = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      in() {
        return builder;
      },
      limit() {
        return Promise.reject(new Error('network down'));
      },
    };
    const sb = {
      from(t: string) {
        calls.from.push(t);
        return builder;
      },
    } as unknown as SupabaseClient;
    await expect(isErasurePending(STUDENT_ID, sb)).resolves.toBe(true);
  });
});

describe('isErasurePending — query shape', () => {
  it('queries data_erasure_requests filtered by student_id and the in-flight status set', async () => {
    const { sb, calls } = makeSb({ data: [], error: null });
    await isErasurePending(STUDENT_ID, sb);

    expect(calls.from).toEqual(['data_erasure_requests']);
    expect(calls.eq).toContainEqual(['student_id', STUDENT_ID]);
    // status IN ('pending','purging')
    const inStatus = calls.in.find(([k]) => k === 'status');
    expect(inStatus).toBeDefined();
    expect(inStatus?.[1]).toEqual([...ERASURE_IN_FLIGHT_STATUSES]);
    // bounded read
    expect(calls.limit).toEqual([1]);
  });
});
