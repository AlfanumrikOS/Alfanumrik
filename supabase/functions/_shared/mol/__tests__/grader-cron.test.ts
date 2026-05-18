// supabase/functions/_shared/mol/__tests__/grader-cron.test.ts
//
// C4.2b-i (2026-05-19) — gradeMolShadowPairs driver unit tests.
//
// Verifies:
//   1. Cost cap: when sum(inr_cost) WHERE shadow_role='shadow' AND today
//      exceeds the cap, the cron FLIPS the shadow flag's kill_switch and
//      EXITS BEFORE calling the grader.
//   2. Sampling: per-task-type rates from GRADER_SAMPLING_RATES are
//      applied via graderSampleBucket. Rows whose task_type has rate 0
//      (or is not in the map) are skipped.
//   3. Skip-no-text scaffold mode: until C4.2b-ii lands response text
//      capture, every sampled pair takes the skipped_no_text branch and
//      the grader is NEVER called.
//   4. Failure isolation: a flag-read error or update-RPC error does not
//      throw out of the driver.
//
// Mocking strategy: we build a minimal in-memory supabase mock that
// supports the (.from()).select().eq().is().gte() chain the driver uses.
// No real Supabase client is constructed.

// @ts-ignore — stub Deno before imports
globalThis.Deno = { env: { get: (_k: string) => '' } };

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gradeMolShadowPairs } from '../grader-cron.ts';
import type { GraderResult } from '../grader.ts';

// ─── Minimal supabase mock ───────────────────────────────────────────────────
//
// Supports the exact chain the driver invokes:
//   from('mol_request_logs').select(...).eq('shadow_role','shadow').gte('created_at',iso)
//   from('mol_request_logs').select(...).eq('shadow_role','shadow').is('shadow_grader_score',null).gte('created_at',iso)
//   from('mol_request_logs').update({...}).eq('request_id',id).eq('shadow_role','shadow')
//   from('feature_flags').select('metadata').eq('flag_name','...').maybeSingle()
//   from('feature_flags').update({...}).eq('flag_name','...')
//
// Each builder returns `this` for chaining, then resolves a final shape on
// `await` (which translates to `.then`/`.catch` for the supabase-js
// idiom).

interface SupabaseTableState {
  rows: Array<Record<string, unknown>>;
  updates: Array<{ patch: Record<string, unknown>; predicates: Record<string, unknown> }>;
  selects: Array<{ predicates: Record<string, unknown> }>;
}

function makeSupabase(tables: Record<string, SupabaseTableState>) {
  const flagUpdateSpy = vi.fn();
  const rowUpdateSpy = vi.fn();

  function from(table: string) {
    const state = tables[table] ?? { rows: [], updates: [], selects: [] };
    const ctx: Record<string, unknown> = {};

    const builder: Record<string, unknown> = {};

    // Common matcher reducer.
    const filterRows = (predicates: Record<string, unknown>) =>
      state.rows.filter((r) =>
        Object.entries(predicates).every(([k, v]) => {
          if (v === '__IS_NULL__') return r[k] === null || r[k] === undefined;
          if (Array.isArray(v) && v[0] === '__GTE__') {
            const cmp = v[1] as string;
            return typeof r[k] === 'string' && (r[k] as string) >= cmp;
          }
          return r[k] === v;
        }),
      );

    builder.select = (_cols: string, _opts?: Record<string, unknown>) => {
      ctx.predicates = {} as Record<string, unknown>;
      return builder;
    };
    builder.update = (patch: Record<string, unknown>) => {
      ctx.patch = patch;
      ctx.predicates = {} as Record<string, unknown>;
      ctx.kind = 'update';
      return builder;
    };
    builder.eq = (k: string, v: unknown) => {
      (ctx.predicates as Record<string, unknown>)[k] = v;
      return builder;
    };
    builder.is = (k: string, v: unknown) => {
      if (v === null) {
        (ctx.predicates as Record<string, unknown>)[k] = '__IS_NULL__';
      } else {
        (ctx.predicates as Record<string, unknown>)[k] = v;
      }
      return builder;
    };
    builder.gte = (k: string, v: string) => {
      (ctx.predicates as Record<string, unknown>)[k] = ['__GTE__', v];
      return builder;
    };
    builder.maybeSingle = async () => {
      const predicates = (ctx.predicates ?? {}) as Record<string, unknown>;
      const matches = filterRows(predicates);
      return { data: matches[0] ?? null, error: null };
    };
    // The supabase-js promise contract: every builder is thenable so an
    // `await` collapses the chain. We support that via Symbol.toPrimitive-
    // free duck typing: provide a `.then` method.
    builder.then = (onFulfilled: (v: { data: unknown; error: unknown }) => void) => {
      const predicates = (ctx.predicates ?? {}) as Record<string, unknown>;
      const matches = filterRows(predicates);
      if (ctx.kind === 'update') {
        state.updates.push({ patch: ctx.patch as Record<string, unknown>, predicates });
        if (table === 'feature_flags') flagUpdateSpy(ctx.patch, predicates);
        else if (table === 'mol_request_logs') rowUpdateSpy(ctx.patch, predicates);
        // Mutate matching rows in place to mirror supabase-js's UPDATE
        // semantics (the new row state is then visible to subsequent
        // SELECTs in the same test).
        for (const row of matches) Object.assign(row, ctx.patch);
        return onFulfilled({ data: matches, error: null });
      }
      state.selects.push({ predicates });
      return onFulfilled({ data: matches, error: null });
    };

    return builder;
  }

  return { from: from as unknown as (t: string) => unknown, flagUpdateSpy, rowUpdateSpy, tables };
}

// ─── Test helpers ────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-05-19T10:00:00.000Z');

function makeShadowRow(args: {
  request_id: string;
  task_type: string;
  inr_cost?: number;
  created_at?: string;
  shadow_grader_score?: number | null;
}) {
  return {
    request_id: args.request_id,
    shadow_of_request_id: `baseline-of-${args.request_id}`,
    task_type: args.task_type,
    shadow_role: 'shadow',
    inr_cost: args.inr_cost ?? 0.5,
    // Default to a timestamp INSIDE the day window the driver computes
    // from FIXED_NOW (start = 2026-05-19T00:00:00Z), so the cost rollup
    // and ungraded fetch both pick the row up. Tests that want to land
    // outside the window override created_at explicitly.
    created_at: args.created_at ?? '2026-05-19T05:00:00.000Z',
    shadow_grader_score: args.shadow_grader_score ?? null,
  };
}

const okGrader = async (_args: {
  question: string;
  baseline_text: string;
  shadow_text: string;
}): Promise<GraderResult | null> => ({
  baseline: {
    ncert_alignment: 0.9,
    factual_correctness: 0.9,
    age_appropriateness: 0.8,
    helpfulness: 0.85,
    citation_accuracy: 0.7,
    overall: 0.86,
  },
  shadow: {
    ncert_alignment: 0.7,
    factual_correctness: 0.8,
    age_appropriateness: 0.85,
    helpfulness: 0.8,
    citation_accuracy: 0.6,
    overall: 0.755,
  },
  agreement: 0.9,
  winner: 'baseline',
  notes: 'NCERT alignment edge.',
  rubric_version: 'mol-grader-v1',
  model: 'claude-sonnet-4-6-20251022',
  prompt_tokens: 320,
  completion_tokens: 280,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── Cost-cap kill switch ────────────────────────────────────────────────────

describe('gradeMolShadowPairs — cost cap kill switch', () => {
  it('flips kill_switch and exits early when today\'s shadow cost > cap', async () => {
    // Two shadow rows that together exceed a tight ₹1.50 cap.
    const tables = {
      mol_request_logs: {
        rows: [
          makeShadowRow({ request_id: 'r1', task_type: 'doubt_solving', inr_cost: 1.0 }),
          makeShadowRow({ request_id: 'r2', task_type: 'doubt_solving', inr_cost: 1.0 }),
        ],
        updates: [],
        selects: [],
      },
      feature_flags: {
        rows: [
          {
            flag_name: 'ff_grounded_answer_mol_shadow_v1',
            metadata: { enabled: true, kill_switch: false, task_types: ['doubt_solving'], rollout_pct: 50 },
          },
        ],
        updates: [],
        selects: [],
      },
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      costCapInr: 1.5, // tight cap to force the trip
    });

    expect(out.cost_cap_triggered).toBe(true);
    expect(out.killed).toBe(true);
    expect(out.graded).toBe(0);
    // Sonnet was NEVER called because we tripped the cap before sampling.
    expect(graderSpy).not.toHaveBeenCalled();

    // The feature_flags row's metadata was updated with kill_switch=true.
    expect(sb.flagUpdateSpy).toHaveBeenCalledTimes(1);
    const flagPatch = sb.flagUpdateSpy.mock.calls[0][0] as { metadata: { kill_switch: boolean } };
    expect(flagPatch.metadata.kill_switch).toBe(true);
  });

  it('does NOT flip kill_switch when daily cost is below cap', async () => {
    const tables = {
      mol_request_logs: {
        rows: [makeShadowRow({ request_id: 'r1', task_type: 'doubt_solving', inr_cost: 0.10 })],
        updates: [],
        selects: [],
      },
      feature_flags: {
        rows: [
          {
            flag_name: 'ff_grounded_answer_mol_shadow_v1',
            metadata: { enabled: true, kill_switch: false, task_types: ['doubt_solving'], rollout_pct: 100 },
          },
        ],
        updates: [],
        selects: [],
      },
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      costCapInr: 1.0,
    });

    expect(out.cost_cap_triggered).toBe(false);
    expect(out.killed).toBe(false);
    expect(sb.flagUpdateSpy).not.toHaveBeenCalled();
  });

  it('continues past cost rollup error (does not throw)', async () => {
    // Build a supabase whose initial select throws so the cost-cap check
    // takes its swallowing branch but the driver continues to the
    // ungraded-row fetch (which we leave empty).
    const sb = {
      from: vi.fn((table: string) => {
        if (table === 'mol_request_logs') {
          // First call (cost rollup): throw. Subsequent calls return empty.
          let callCount = 0;
          return {
            select: () => ({
              eq: () => ({
                gte: () => ({
                  then: (resolve: (v: { data: null; error: { message: string } }) => unknown) => {
                    callCount += 1;
                    if (callCount === 1) {
                      return resolve({ data: null, error: { message: 'rollup boom' } });
                    }
                    return resolve({ data: null, error: { message: 'noop' } });
                  },
                }),
                is: () => ({
                  gte: () => ({
                    then: (resolve: (v: { data: never[]; error: null }) => unknown) =>
                      resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }),
    };

    await expect(
      gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
        now: () => FIXED_NOW,
        grader: vi.fn(okGrader),
      }),
    ).resolves.toEqual(
      expect.objectContaining({ cost_cap_triggered: false, killed: false, graded: 0 }),
    );
  });
});

// ─── Sampling logic ──────────────────────────────────────────────────────────

describe('gradeMolShadowPairs — sampling', () => {
  it('skips rows whose task_type has rate 0 (or missing from rates map)', async () => {
    const tables = {
      mol_request_logs: {
        rows: [
          // grounding_check has no entry in GRADER_SAMPLING_RATES → 0%
          makeShadowRow({ request_id: 'r-gc-1', task_type: 'grounding_check', inr_cost: 0 }),
          makeShadowRow({ request_id: 'r-gc-2', task_type: 'grounding_check', inr_cost: 0 }),
          // quiz_generation also excluded
          makeShadowRow({ request_id: 'r-qg-1', task_type: 'quiz_generation', inr_cost: 0 }),
        ],
        updates: [],
        selects: [],
      },
      feature_flags: { rows: [], updates: [], selects: [] },
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
    });

    expect(out.skipped_unsampled).toBe(3);
    expect(out.graded).toBe(0);
    expect(graderSpy).not.toHaveBeenCalled();
  });

  it('applies the per-task-type rates: 100% rate samples every row', async () => {
    // Override rates so every doubt_solving row is sampled. With the
    // scaffold-mode resolveTexts() returning null, every sampled row
    // takes the skipped_no_text branch — that's the point of the assert.
    const tables = {
      mol_request_logs: {
        rows: [
          makeShadowRow({ request_id: 'r-d-1', task_type: 'doubt_solving', inr_cost: 0 }),
          makeShadowRow({ request_id: 'r-d-2', task_type: 'doubt_solving', inr_cost: 0 }),
          makeShadowRow({ request_id: 'r-d-3', task_type: 'doubt_solving', inr_cost: 0 }),
        ],
        updates: [],
        selects: [],
      },
      feature_flags: { rows: [], updates: [], selects: [] },
    };
    const sb = makeSupabase(tables);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: vi.fn(okGrader),
      samplingRates: { doubt_solving: 100 },
    });

    // All three are sampled, none unsampled.
    expect(out.skipped_unsampled).toBe(0);
    // SCAFFOLD MODE: every sampled pair → skipped_no_text because text
    // capture is not yet implemented.
    expect(out.skipped_no_text).toBe(3);
    expect(out.graded).toBe(0);
  });

  it('with 0% rate, every row is unsampled', async () => {
    const tables = {
      mol_request_logs: {
        rows: [
          makeShadowRow({ request_id: 'r-x-1', task_type: 'explanation', inr_cost: 0 }),
          makeShadowRow({ request_id: 'r-x-2', task_type: 'explanation', inr_cost: 0 }),
        ],
        updates: [],
        selects: [],
      },
      feature_flags: { rows: [], updates: [], selects: [] },
    };
    const sb = makeSupabase(tables);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: vi.fn(okGrader),
      samplingRates: { explanation: 0 },
    });

    expect(out.skipped_unsampled).toBe(2);
    expect(out.skipped_no_text).toBe(0);
    expect(out.graded).toBe(0);
  });
});

// ─── Scaffold mode (text-not-available) ──────────────────────────────────────

describe('gradeMolShadowPairs — scaffold mode (skipped_no_text)', () => {
  it('every sampled pair takes the skipped_no_text branch in scaffold mode', async () => {
    const tables = {
      mol_request_logs: {
        rows: [
          makeShadowRow({ request_id: 'r-1', task_type: 'doubt_solving' }),
          makeShadowRow({ request_id: 'r-2', task_type: 'doubt_solving' }),
        ],
        updates: [],
        selects: [],
      },
      feature_flags: { rows: [], updates: [], selects: [] },
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      samplingRates: { doubt_solving: 100 },
    });

    expect(out.skipped_no_text).toBeGreaterThan(0);
    // Grader NEVER called because resolveTexts() returns null in scaffold mode.
    expect(graderSpy).not.toHaveBeenCalled();
    // No shadow_grader_score writes either.
    expect(sb.rowUpdateSpy).not.toHaveBeenCalled();
  });
});

// ─── Empty / no-op paths ─────────────────────────────────────────────────────

describe('gradeMolShadowPairs — no-op paths', () => {
  it('returns zeros when there are no ungraded shadow rows', async () => {
    const tables = {
      mol_request_logs: { rows: [], updates: [], selects: [] },
      feature_flags: { rows: [], updates: [], selects: [] },
    };
    const sb = makeSupabase(tables);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: vi.fn(okGrader),
    });

    expect(out).toEqual(
      expect.objectContaining({
        graded: 0,
        skipped_no_text: 0,
        skipped_unsampled: 0,
        cost_cap_triggered: false,
        killed: false,
      }),
    );
  });
});
