/**
 * Phase 5 unit tests for L8 outcome attribution.
 *
 * Covers:
 *   1. Flag OFF → reason='flag_off', no DB writes
 *   2. No eligible cycles → reason='no_cycles'
 *   3. Unknown metric → skipped with reason='unknown_metric:...'
 *   4. Already-attributed cycle → skipped with reason='already_attributed'
 *   5. Happy path: shipped cycle + matching events → inserts an outcome_metrics
 *      row with correct before/after/delta and sample sizes
 *   6. Eligible cycle within windowDays → not picked up (window incomplete)
 *   7. Significance test:
 *      - rate metric with small N → not significant
 *      - rate metric with N>=30 and |delta|>=0.05 → significant
 *      - count metric with relative change >=0.2 and N>=30 → significant
 *   8. Metric registry: each defined metric has a compute that doesn't throw
 *      on empty data
 *
 * No real Supabase. We mock with a small FakeSupabase that supports the
 * gte/lt/eq/like/not/limit/order/insert/maybeSingle operations the runtime uses.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runL8Attribution, isSignificant } from '@/../agents/runtime/layers/l8-evolution';
import { METRIC_REGISTRY, getMetricDef } from '@/../agents/runtime/metrics/registry';

// ── Fake Supabase ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type TableState = { rows: Row[]; inserts: Row[][] };

interface Filter {
  col: string;
  val: unknown;
  op: 'eq' | 'gt' | 'gte' | 'lt' | 'like' | 'not.is.null' | 'is.null';
}

function makeFakeSb(tables: Record<string, TableState>) {
  const sb = {
    _inserts: [] as Array<{ table: string; payload: Row }>,
    from(table: string) {
      const state = tables[table] ?? { rows: [], inserts: [] };
      const filters: Filter[] = [];
      let _limit = Infinity;
      const q: Record<string, unknown> = {
        select() {
          return q;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val, op: 'eq' });
          return q;
        },
        gt(col: string, val: unknown) {
          filters.push({ col, val, op: 'gt' });
          return q;
        },
        gte(col: string, val: unknown) {
          filters.push({ col, val, op: 'gte' });
          return q;
        },
        lt(col: string, val: unknown) {
          filters.push({ col, val, op: 'lt' });
          return q;
        },
        like(col: string, val: unknown) {
          filters.push({ col, val, op: 'like' });
          return q;
        },
        not(col: string, op: string, val: unknown) {
          if (op === 'is' && val === null) {
            filters.push({ col, val: null, op: 'not.is.null' });
          }
          return q;
        },
        order() {
          return q;
        },
        limit(n: number) {
          _limit = n;
          return q;
        },
        async maybeSingle() {
          const filtered = state.rows.filter(applyFilters(filters));
          return { data: filtered[0] ?? null, error: null };
        },
        async then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          const filtered = state.rows.filter(applyFilters(filters)).slice(0, _limit);
          return resolve({ data: filtered, error: null });
        },
        async insert(payload: Row) {
          state.inserts.push([payload]);
          sb._inserts.push({ table, payload });
          return { error: null };
        },
      };
      return q;
    },
  };
  return sb;
}

function applyFilters(filters: Filter[]) {
  return (r: Row) =>
    filters.every(f => {
      const v = r[f.col];
      switch (f.op) {
        case 'eq':
          return v === f.val;
        case 'gt':
          return String(v) > String(f.val);
        case 'gte':
          return String(v) >= String(f.val);
        case 'lt':
          return String(v) < String(f.val);
        case 'like': {
          const pattern = String(f.val).replace('%', '');
          return typeof v === 'string' && v.startsWith(pattern);
        }
        case 'not.is.null':
          return v !== null && v !== undefined;
        case 'is.null':
          return v === null || v === undefined;
        default:
          return true;
      }
    });
}

// ── Fixtures ──────────────────────────────────────────────────────────

const NOW = new Date('2026-05-20T12:00:00Z');

function shippedCycle(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    goal: 'Improve foxy helpful rate',
    target_metric: 'foxy_helpful_rate',
    target_delta: 0.1,
    status: 'complete',
    ended_reason: 'shipped',
    // 14 days ago — full pre+post window available.
    ended_at: new Date('2026-05-06T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function foxyCompletedEvent(args: {
  helpful: boolean | null;
  occurredAt: string;
  userId?: string;
}) {
  return {
    event_id: crypto.randomUUID(),
    actor_auth_user_id: args.userId ?? crypto.randomUUID(),
    occurred_at: args.occurredAt,
    kind: 'ai.foxy_session_completed',
    payload: {
      foxySessionId: '77777777-7777-7777-7777-777777777777',
      turnCount: 5,
      durationSec: 300,
      helpful: args.helpful,
    },
  };
}

function baseTables(): Record<string, TableState> {
  return {
    cycles: { rows: [], inserts: [] },
    outcome_metrics: { rows: [], inserts: [] },
    domain_events: { rows: [], inserts: [] },
    feature_flags: { rows: [{ flag_name: 'ff_mesh_l8_attribution_v1', is_enabled: false }], inserts: [] },
  };
}

// ── 1. Flag OFF ───────────────────────────────────────────────────────

describe('runL8Attribution', () => {
  it('returns reason=flag_off and writes nothing when flag is off', async () => {
    const sb = makeFakeSb(baseTables());
    const result = await runL8Attribution({
      sb: sb as unknown as SupabaseClient,
      isEnabled: async () => false,
      now: () => NOW,
    });
    expect(result.reason).toBe('flag_off');
    expect(result.attributed).toEqual([]);
    expect(sb._inserts).toHaveLength(0);
  });

  it('returns reason=no_cycles when nothing eligible', async () => {
    const sb = makeFakeSb(baseTables());
    const result = await runL8Attribution({
      sb: sb as unknown as SupabaseClient,
      isEnabled: async () => true,
      now: () => NOW,
    });
    expect(result.reason).toBe('no_cycles');
    expect(sb._inserts).toHaveLength(0);
  });

  it('skips cycles with unknown metric', async () => {
    const tables = baseTables();
    tables.cycles.rows = [
      shippedCycle({ target_metric: 'fictitious_metric' }),
    ];
    const sb = makeFakeSb(tables);
    const result = await runL8Attribution({
      sb: sb as unknown as SupabaseClient,
      isEnabled: async () => true,
      now: () => NOW,
    });
    expect(result.skipped).toEqual([
      { cycleId: '11111111-1111-1111-1111-111111111111', reason: 'unknown_metric:fictitious_metric' },
    ]);
    expect(sb._inserts).toHaveLength(0);
  });

  it('skips cycles already attributed for the metric', async () => {
    const tables = baseTables();
    tables.cycles.rows = [shippedCycle()];
    tables.outcome_metrics.rows = [
      { id: 'existing-row', cycle_id: '11111111-1111-1111-1111-111111111111', metric: 'foxy_helpful_rate' },
    ];
    const sb = makeFakeSb(tables);
    const result = await runL8Attribution({
      sb: sb as unknown as SupabaseClient,
      isEnabled: async () => true,
      now: () => NOW,
    });
    expect(result.skipped[0]).toEqual({
      cycleId: '11111111-1111-1111-1111-111111111111',
      reason: 'already_attributed',
    });
    expect(sb._inserts).toHaveLength(0);
  });

  it('attributes the happy path and writes an outcome_metrics row', async () => {
    const tables = baseTables();
    tables.cycles.rows = [shippedCycle()];

    // Build many events to clear the significance threshold (N>=30).
    const events: Row[] = [];
    // Before window (May 6 - 7d → April 29): low helpful rate (40%).
    for (let i = 0; i < 50; i++) {
      events.push(
        foxyCompletedEvent({
          helpful: i < 20, // 20/50 helpful = 0.40
          occurredAt: new Date(Date.parse('2026-05-06T00:00:00Z') - 3 * 24 * 3600 * 1000 + i * 1000).toISOString(),
          userId: `before-${i}`,
        }),
      );
    }
    // After window (May 6 → 13): high helpful rate (80%).
    for (let i = 0; i < 50; i++) {
      events.push(
        foxyCompletedEvent({
          helpful: i < 40, // 40/50 helpful = 0.80
          occurredAt: new Date(Date.parse('2026-05-06T00:00:00Z') + 3 * 24 * 3600 * 1000 + i * 1000).toISOString(),
          userId: `after-${i}`,
        }),
      );
    }
    tables.domain_events.rows = events;

    const sb = makeFakeSb(tables);
    const result = await runL8Attribution({
      sb: sb as unknown as SupabaseClient,
      isEnabled: async () => true,
      now: () => NOW,
    });
    expect(result.reason).toBe('ok');
    expect(result.attributed).toHaveLength(1);
    const rec = result.attributed[0];
    expect(rec.metric).toBe('foxy_helpful_rate');
    expect(rec.beforeValue).toBeCloseTo(0.4, 1);
    expect(rec.afterValue).toBeCloseTo(0.8, 1);
    expect(rec.delta).toBeCloseTo(0.4, 1);
    expect(rec.sampleSizeBefore).toBe(50);
    expect(rec.sampleSizeAfter).toBe(50);
    expect(rec.statisticallySignificant).toBe(true);

    expect(sb._inserts).toHaveLength(1);
    expect(sb._inserts[0].table).toBe('outcome_metrics');
  });

  it('does not pick up cycles within the window (post-window incomplete)', async () => {
    const tables = baseTables();
    // Shipped only 2 days ago — windowDays=7 means we wait.
    tables.cycles.rows = [
      shippedCycle({ ended_at: new Date(NOW.getTime() - 2 * 24 * 3600 * 1000).toISOString() }),
    ];
    const sb = makeFakeSb(tables);
    const result = await runL8Attribution({
      sb: sb as unknown as SupabaseClient,
      isEnabled: async () => true,
      now: () => NOW,
    });
    expect(result.reason).toBe('no_cycles');
    expect(sb._inserts).toHaveLength(0);
  });
});

// ── isSignificant ─────────────────────────────────────────────────────

describe('isSignificant', () => {
  const rateMetric = getMetricDef('foxy_helpful_rate')!;
  const countMetric = getMetricDef('quiz_completion_rate')!;

  it('is false on a rate metric with N < 30', () => {
    expect(
      isSignificant(rateMetric, { value: 0.4, sampleSize: 20 }, { value: 0.8, sampleSize: 20 }),
    ).toBe(false);
  });

  it('is true on a rate metric with N >= 30 and |delta| >= 0.05', () => {
    expect(
      isSignificant(rateMetric, { value: 0.4, sampleSize: 50 }, { value: 0.5, sampleSize: 50 }),
    ).toBe(true);
  });

  it('is false on a rate metric with N >= 30 but |delta| < 0.05', () => {
    expect(
      isSignificant(rateMetric, { value: 0.4, sampleSize: 50 }, { value: 0.43, sampleSize: 50 }),
    ).toBe(false);
  });

  it('is true on a count metric with N >= 30 and relative change >= 0.2', () => {
    expect(
      isSignificant(countMetric, { value: 5, sampleSize: 50 }, { value: 7, sampleSize: 50 }),
    ).toBe(true);
  });

  it('is false on a count metric with relative change < 0.2', () => {
    expect(
      isSignificant(countMetric, { value: 5, sampleSize: 50 }, { value: 5.5, sampleSize: 50 }),
    ).toBe(false);
  });
});

// ── Metric registry ───────────────────────────────────────────────────

describe('METRIC_REGISTRY', () => {
  it('contains the four Phase 5 metrics', () => {
    expect(METRIC_REGISTRY.has('foxy_helpful_rate')).toBe(true);
    expect(METRIC_REGISTRY.has('quiz_completion_rate')).toBe(true);
    expect(METRIC_REGISTRY.has('mastery_velocity')).toBe(true);
    expect(METRIC_REGISTRY.has('streak_retention_7d')).toBe(true);
  });

  it('every metric has the required fields', () => {
    for (const def of METRIC_REGISTRY.values()) {
      expect(def.name).toMatch(/^[a-z][a-z0-9_]{0,127}$/);
      expect(typeof def.description).toBe('string');
      expect(['rate', 'count', 'duration_sec']).toContain(def.kind);
      expect(['up', 'down', 'stable']).toContain(def.direction);
      expect(typeof def.compute).toBe('function');
    }
  });

  it('compute() returns {value:0, sampleSize:0} on empty data', async () => {
    const sb = makeFakeSb(baseTables());
    for (const def of METRIC_REGISTRY.values()) {
      const sample = await def.compute(sb as unknown as SupabaseClient, {
        startsAt: '2026-05-01T00:00:00Z',
        endsAt: '2026-05-08T00:00:00Z',
      });
      expect(sample.value).toBe(0);
      expect(sample.sampleSize).toBe(0);
    }
  });
});
