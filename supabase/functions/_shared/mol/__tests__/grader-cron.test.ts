// supabase/functions/_shared/mol/__tests__/grader-cron.test.ts
//
// C4.2b-i (2026-05-19) — gradeMolShadowPairs driver unit tests.
// C4.2b-i review fixes (2026-05-19): added coverage for B5 (Promise.allSettled
// batching), B6 (grader Sonnet cap aborts remaining batches without flipping
// kill switch), and B1 (audit_logs row written on kill switch flip).
//
// Verifies:
//   1. Cost cap: when sum(inr_cost) WHERE shadow_role='shadow' AND today
//      exceeds the cap, the cron FLIPS the shadow flag's kill_switch and
//      EXITS BEFORE calling the grader. The flip also writes one audit_logs
//      row with actor_type='cron'.
//   2. Sampling: per-task-type rates from GRADER_SAMPLING_RATES are
//      applied via graderSampleBucket. Rows whose task_type has rate 0
//      (or is not in the map) are skipped.
//   3. Skip-no-text scaffold mode: until C4.2b-ii lands response text
//      capture, every sampled pair takes the skipped_no_text branch and
//      the grader is NEVER called.
//   4. Failure isolation: a flag-read error or update-RPC error does not
//      throw out of the driver.
//   5. B5: per-pair grader calls fan out via Promise.allSettled.
//   6. B6: grader Sonnet cap aborts remaining batches but does NOT flip
//      kill_switch.
//   7. B1: audit_logs receives a row when kill_switch flips.
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

interface SupabaseTableState {
  rows: Array<Record<string, unknown>>;
  updates: Array<{ patch: Record<string, unknown>; predicates: Record<string, unknown> }>;
  selects: Array<{ predicates: Record<string, unknown> }>;
  inserts: Array<Record<string, unknown>>;
  deletes: Array<{ predicates: Record<string, unknown> }>;
}

function makeTableState(rows: Array<Record<string, unknown>> = []): SupabaseTableState {
  return { rows, updates: [], selects: [], inserts: [], deletes: [] };
}

function makeSupabase(tables: Record<string, SupabaseTableState>) {
  const flagUpdateSpy = vi.fn();
  const rowUpdateSpy = vi.fn();
  const auditInsertSpy = vi.fn();
  const telemetryInsertSpy = vi.fn();
  const textBufferDeleteSpy = vi.fn();

  function from(table: string) {
    const state = tables[table] ?? makeTableState();
    if (!tables[table]) tables[table] = state;
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
    builder.delete = () => {
      ctx.predicates = {} as Record<string, unknown>;
      ctx.kind = 'delete';
      return builder;
    };
    builder.insert = async (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
      const rowsToInsert = Array.isArray(row) ? row : [row];
      for (const r of rowsToInsert) {
        state.inserts.push(r);
        state.rows.push(r);
        if (table === 'audit_logs') auditInsertSpy(r);
        if (table === 'mol_request_logs') telemetryInsertSpy(r);
      }
      return { data: rowsToInsert, error: null };
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
    // C4.2b-ii: resolveTexts uses .limit(1).maybeSingle() to read the
    // single buffer row matched by shadow_request_id. The mock is a no-op
    // — maybeSingle already returns matches[0] so the limit is implicit.
    builder.limit = (_n: number) => builder;
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
      if (ctx.kind === 'delete') {
        state.deletes.push({ predicates });
        if (table === 'mol_shadow_text_buffer') textBufferDeleteSpy(predicates);
        // Actually remove matched rows from state so subsequent reads
        // observe the deletion (mirrors supabase-js DELETE semantics).
        for (const row of matches) {
          const idx = state.rows.indexOf(row);
          if (idx >= 0) state.rows.splice(idx, 1);
        }
        return onFulfilled({ data: matches, error: null });
      }
      state.selects.push({ predicates });
      return onFulfilled({ data: matches, error: null });
    };

    return builder;
  }

  return {
    from: from as unknown as (t: string) => unknown,
    flagUpdateSpy,
    rowUpdateSpy,
    auditInsertSpy,
    telemetryInsertSpy,
    textBufferDeleteSpy,
    tables,
  };
}

/**
 * C4.2b-ii: build a mol_shadow_text_buffer row keyed by `shadow_request_id`.
 * Used by tests that want resolveTexts() to return a usable text triple.
 */
function makeTextBufferRow(args: {
  shadow_request_id: string;
  question?: string;
  baseline_response?: string;
  shadow_response?: string;
  baseline_system_prompt?: string;
  shadow_system_prompt?: string | null;
  redaction_applied?: string[];
}) {
  return {
    id: `buf-${args.shadow_request_id}`,
    baseline_request_id: args.shadow_request_id,
    shadow_request_id: args.shadow_request_id,
    question_text: args.question ?? 'What is photosynthesis?',
    baseline_system_prompt:
      args.baseline_system_prompt ?? 'You are Foxy, a CBSE tutor for Class 8 Science.',
    shadow_system_prompt: args.shadow_system_prompt ?? null,
    baseline_response_text:
      args.baseline_response ?? 'Photosynthesis is the process by which plants make food.',
    shadow_response_text:
      args.shadow_response ?? 'Plants use sunlight to convert CO2 and H2O into glucose.',
    redaction_applied: args.redaction_applied ?? [],
    created_at: '2026-05-19T05:00:00.000Z',
    expires_at: '2026-05-26T05:00:00.000Z',
  };
}

// ─── Test helpers ────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-05-19T10:00:00.000Z');

function makeShadowRow(args: {
  request_id: string;
  task_type: string;
  inr_cost?: number;
  created_at?: string;
  shadow_grader_score?: number | null;
  grade?: string | null;
}) {
  return {
    request_id: args.request_id,
    shadow_of_request_id: `baseline-of-${args.request_id}`,
    task_type: args.task_type,
    shadow_role: 'shadow',
    inr_cost: args.inr_cost ?? 0.5,
    grade: args.grade ?? '7',
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
  grade: string;
  coach_mode: 'socratic' | 'answer' | 'review' | null;
}): Promise<GraderResult | null> => ({
  baseline: {
    accuracy: 0.9,
    cbse_scope: 0.9,
    age_appropriateness: 0.8,
    scaffold_fidelity: 0.85,
    helpfulness: 0.85,
    citation_accuracy: 0.7,
    overall: 0.86,
  },
  shadow: {
    accuracy: 0.7,
    cbse_scope: 0.8,
    age_appropriateness: 0.85,
    scaffold_fidelity: 0.7,
    helpfulness: 0.8,
    citation_accuracy: 0.6,
    overall: 0.755,
  },
  agreement: 0.9,
  winner: 'baseline',
  notes: 'NCERT alignment edge.',
  rubric_version: 'mol-grader-v2',
  model: 'claude-sonnet-4-6-20251022',
  prompt_tokens: 320,
  completion_tokens: 280,
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── Cost-cap kill switch ────────────────────────────────────────────────────

describe('gradeMolShadowPairs — cost cap kill switch', () => {
  it("flips kill_switch and exits early when today's shadow cost > cap", async () => {
    // Two shadow rows that together exceed a tight ₹1.50 cap.
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r1', task_type: 'doubt_solving', inr_cost: 1.0 }),
        makeShadowRow({ request_id: 'r2', task_type: 'doubt_solving', inr_cost: 1.0 }),
      ]),
      feature_flags: makeTableState([
        {
          flag_name: 'ff_grounded_answer_mol_shadow_v1',
          metadata: { enabled: true, kill_switch: false, task_types: ['doubt_solving'], rollout_pct: 50 },
        },
      ]),
      audit_logs: makeTableState(),
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

  // ─── B1: audit_logs row on kill_switch flip ───────────────────────────────

  it('B1: writes one audit_logs row when kill_switch flips', async () => {
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r1', task_type: 'doubt_solving', inr_cost: 1.0 }),
        makeShadowRow({ request_id: 'r2', task_type: 'doubt_solving', inr_cost: 1.0 }),
      ]),
      feature_flags: makeTableState([
        {
          flag_name: 'ff_grounded_answer_mol_shadow_v1',
          metadata: { enabled: true, kill_switch: false },
        },
      ]),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);

    await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: vi.fn(okGrader),
      costCapInr: 1.5,
    });

    expect(sb.auditInsertSpy).toHaveBeenCalledTimes(1);
    const auditRow = sb.auditInsertSpy.mock.calls[0][0] as {
      auth_user_id: unknown;
      actor_type: string;
      action: string;
      resource_type: string;
      details: { daily_shadow_cost_inr: number; cap_inr: number; run_at: string; actor: string };
    };
    expect(auditRow.auth_user_id).toBeNull();
    expect(auditRow.actor_type).toBe('cron');
    expect(auditRow.action).toBe('mol_shadow_kill_switch_flipped');
    expect(auditRow.resource_type).toBe('mol_shadow_grader');
    expect(auditRow.details.daily_shadow_cost_inr).toBeGreaterThan(0);
    expect(auditRow.details.cap_inr).toBe(1.5);
    expect(auditRow.details.run_at).toBe(FIXED_NOW.toISOString());
    expect(auditRow.details.actor).toBe('system:mol-grader-cron');
  });

  it('does NOT flip kill_switch when daily cost is below cap', async () => {
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r1', task_type: 'doubt_solving', inr_cost: 0.10 }),
      ]),
      feature_flags: makeTableState([
        {
          flag_name: 'ff_grounded_answer_mol_shadow_v1',
          metadata: { enabled: true, kill_switch: false, task_types: ['doubt_solving'], rollout_pct: 100 },
        },
      ]),
      audit_logs: makeTableState(),
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
    expect(sb.auditInsertSpy).not.toHaveBeenCalled();
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
      mol_request_logs: makeTableState([
        // grounding_check has no entry in GRADER_SAMPLING_RATES → 0%
        makeShadowRow({ request_id: 'r-gc-1', task_type: 'grounding_check', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-gc-2', task_type: 'grounding_check', inr_cost: 0 }),
        // quiz_generation also excluded
        makeShadowRow({ request_id: 'r-qg-1', task_type: 'quiz_generation', inr_cost: 0 }),
      ]),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
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
    // C4.2b-ii: with text capture wired, sampled rows that HAVE a buffer
    // row are graded; rows WITHOUT one are skipped_no_text. This test
    // verifies the sampling math by giving the buffer NO matching rows,
    // so every sampled pair falls through to skipped_no_text. (See the
    // "text capture lands" suite for the with-buffer happy path.)
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r-d-1', task_type: 'doubt_solving', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-d-2', task_type: 'doubt_solving', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-d-3', task_type: 'doubt_solving', inr_cost: 0 }),
      ]),
      mol_shadow_text_buffer: makeTableState(), // empty → resolveTexts() returns null for all 3
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: vi.fn(okGrader),
      samplingRates: { doubt_solving: 100 },
    });

    // All three are sampled, none unsampled.
    expect(out.skipped_unsampled).toBe(0);
    // No buffer rows → every sampled pair → skipped_no_text.
    expect(out.skipped_no_text).toBe(3);
    expect(out.graded).toBe(0);
  });

  it('with 0% rate, every row is unsampled', async () => {
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r-x-1', task_type: 'explanation', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-x-2', task_type: 'explanation', inr_cost: 0 }),
      ]),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
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

// ─── No-text-buffer fallback (skipped_no_text) ───────────────────────────────

describe('gradeMolShadowPairs — text buffer missing', () => {
  it('when mol_shadow_text_buffer has NO row for the shadow request_id, the pair is skipped_no_text', async () => {
    // C4.2b-ii: resolveTexts() now reads from mol_shadow_text_buffer. When
    // the table is empty (text-capture flag was off when the shadow ran,
    // or the worker recycled mid-stream), the grader degrades gracefully
    // to skipped_no_text — identical shape to the original C4.2b-i
    // scaffold-mode outcome.
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r-1', task_type: 'doubt_solving' }),
        makeShadowRow({ request_id: 'r-2', task_type: 'doubt_solving' }),
      ]),
      mol_shadow_text_buffer: makeTableState(),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      samplingRates: { doubt_solving: 100 },
    });

    expect(out.skipped_no_text).toBeGreaterThan(0);
    // Grader NEVER called because resolveTexts() returns null when the
    // buffer is empty.
    expect(graderSpy).not.toHaveBeenCalled();
    // No shadow_grader_score writes either.
    expect(sb.rowUpdateSpy).not.toHaveBeenCalled();
    // No buffer DELETE either — we never graded anything.
    expect(sb.textBufferDeleteSpy).not.toHaveBeenCalled();
  });
});

// ─── Text-buffer JOIN + grader invocation + cleanup DELETE ───────────────────

describe('gradeMolShadowPairs — text capture lands, grader runs', () => {
  it('JOINs mol_shadow_text_buffer by shadow_request_id, invokes grader, persists score, and DELETEs the buffer row', async () => {
    // The buffer row's shadow_request_id matches mol_request_logs.request_id
    // (both UUIDs are the same on the shadow row — see the C4.2a wire-up
    // contract). resolveTexts() reads question/baseline/shadow text from
    // the buffer; gradeOnePair() forwards them to the grader; on success
    // we UPDATE the score row AND DELETE the buffer row.
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r-1', task_type: 'doubt_solving', inr_cost: 0 }),
      ]),
      mol_shadow_text_buffer: makeTableState([
        makeTextBufferRow({
          shadow_request_id: 'r-1',
          question: 'Why is the sky blue?',
          baseline_response: 'Sunlight scatters off air molecules — Rayleigh scattering.',
          shadow_response: 'Blue wavelengths scatter more in the atmosphere.',
        }),
      ]),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      samplingRates: { doubt_solving: 100 },
    });

    // Grader was invoked exactly once, with the buffer's texts.
    expect(graderSpy).toHaveBeenCalledTimes(1);
    const call = graderSpy.mock.calls[0][0] as {
      question: string;
      baseline_text: string;
      shadow_text: string;
      grade: string;
      coach_mode: unknown;
    };
    expect(call.question).toBe('Why is the sky blue?');
    expect(call.baseline_text).toBe('Sunlight scatters off air molecules — Rayleigh scattering.');
    expect(call.shadow_text).toBe('Blue wavelengths scatter more in the atmosphere.');
    expect(call.grade).toBe('7'); // makeShadowRow default

    // Score landed on the shadow row.
    expect(out.graded).toBe(1);
    expect(out.skipped_no_text).toBe(0);
    expect(sb.rowUpdateSpy).toHaveBeenCalledTimes(1);
    const updatePatch = sb.rowUpdateSpy.mock.calls[0][0] as {
      shadow_grader_score: number;
      shadow_grader_payload: unknown;
      shadow_graded_at: string;
    };
    expect(updatePatch.shadow_grader_score).toBeCloseTo(0.755, 3);
    expect(updatePatch.shadow_grader_payload).toBeDefined();
    expect(updatePatch.shadow_graded_at).toBeTruthy();

    // Belt-and-braces cleanup: buffer row was DELETEd.
    expect(sb.textBufferDeleteSpy).toHaveBeenCalledTimes(1);
    const deletePred = sb.textBufferDeleteSpy.mock.calls[0][0] as { shadow_request_id: string };
    expect(deletePred.shadow_request_id).toBe('r-1');

    // The buffer state is now empty (rows were spliced out of the table state).
    expect(tables.mol_shadow_text_buffer.rows.length).toBe(0);
  });

  it('multiple pairs all grade independently when each has its own buffer row', async () => {
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r-a', task_type: 'doubt_solving', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-b', task_type: 'doubt_solving', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-c', task_type: 'doubt_solving', inr_cost: 0 }),
      ]),
      mol_shadow_text_buffer: makeTableState([
        makeTextBufferRow({ shadow_request_id: 'r-a' }),
        makeTextBufferRow({ shadow_request_id: 'r-b' }),
        makeTextBufferRow({ shadow_request_id: 'r-c' }),
      ]),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      samplingRates: { doubt_solving: 100 },
      batchConcurrency: 2, // exercise both batch boundaries
    });

    expect(graderSpy).toHaveBeenCalledTimes(3);
    expect(out.graded).toBe(3);
    expect(out.skipped_no_text).toBe(0);
    expect(sb.textBufferDeleteSpy).toHaveBeenCalledTimes(3);
    // All three buffer rows are gone.
    expect(tables.mol_shadow_text_buffer.rows.length).toBe(0);
  });

  it('mixed: rows with buffer rows grade; rows without are skipped_no_text', async () => {
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'with-buf', task_type: 'doubt_solving', inr_cost: 0 }),
        makeShadowRow({ request_id: 'no-buf', task_type: 'doubt_solving', inr_cost: 0 }),
      ]),
      mol_shadow_text_buffer: makeTableState([
        makeTextBufferRow({ shadow_request_id: 'with-buf' }),
        // no row for 'no-buf'
      ]),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      samplingRates: { doubt_solving: 100 },
    });

    expect(out.graded).toBe(1);
    expect(out.skipped_no_text).toBe(1);
    // Only the with-buf row triggered a DELETE.
    expect(sb.textBufferDeleteSpy).toHaveBeenCalledTimes(1);
    const deletePred = sb.textBufferDeleteSpy.mock.calls[0][0] as { shadow_request_id: string };
    expect(deletePred.shadow_request_id).toBe('with-buf');
  });

  it('grader returning null leaves the buffer row in place (no cleanup), still charges', async () => {
    // When the grader returns null (Sonnet HTTP 5xx, parse failure), we
    // charge the daily Sonnet cap estimate but DO NOT update the score
    // row AND DO NOT delete the buffer row — leaving the buffer in place
    // means a later grader run could retry.
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r-1', task_type: 'doubt_solving', inr_cost: 0 }),
      ]),
      mol_shadow_text_buffer: makeTableState([
        makeTextBufferRow({ shadow_request_id: 'r-1' }),
      ]),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);
    const nullGrader = vi.fn(async () => null);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: nullGrader as unknown as Parameters<typeof gradeMolShadowPairs>[1]['grader'],
      samplingRates: { doubt_solving: 100 },
    });

    expect(nullGrader).toHaveBeenCalledTimes(1);
    expect(out.graded).toBe(0);
    expect(out.skipped_no_text).toBe(1);
    // No score UPDATE (other than the grader-telemetry insert).
    expect(sb.rowUpdateSpy).not.toHaveBeenCalled();
    // No buffer DELETE — the row stays for potential retry on the next run.
    expect(sb.textBufferDeleteSpy).not.toHaveBeenCalled();
    // The buffer row is still present in state.
    expect(tables.mol_shadow_text_buffer.rows.length).toBe(1);
    // Sonnet was dispatched → estimate charged against the cap.
    expect(out.estimated_grader_cost_inr).toBeGreaterThan(0);
  });
});

// ─── B5: parallel batching ──────────────────────────────────────────────────

describe('gradeMolShadowPairs — B5: parallel grader batches', () => {
  it('dispatches concurrent grader calls per batch (Promise.allSettled fan-out, with text capture)', async () => {
    // C4.2b-ii: now that resolveTexts() reads from mol_shadow_text_buffer,
    // we can verify the parallel fan-out by providing buffer rows for every
    // sampled pair. With 10 sampled pairs and BATCH_CONCURRENCY=5, the
    // driver processes them in two batches via Promise.allSettled.
    const tables = {
      mol_request_logs: makeTableState(
        Array.from({ length: 10 }, (_, i) =>
          makeShadowRow({ request_id: `r-${i}`, task_type: 'doubt_solving', inr_cost: 0 }),
        ),
      ),
      mol_shadow_text_buffer: makeTableState(
        Array.from({ length: 10 }, (_, i) =>
          makeTextBufferRow({ shadow_request_id: `r-${i}` }),
        ),
      ),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      samplingRates: { doubt_solving: 100 },
      batchConcurrency: 5,
    });

    expect(graderSpy).toHaveBeenCalledTimes(10);
    expect(out.graded).toBe(10);
    expect(out.skipped_no_text).toBe(0);
    expect(sb.textBufferDeleteSpy).toHaveBeenCalledTimes(10);
  });

  it('a batchConcurrency override of 1 still completes (serial fallback path)', async () => {
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r-a', task_type: 'doubt_solving' }),
        makeShadowRow({ request_id: 'r-b', task_type: 'doubt_solving' }),
        makeShadowRow({ request_id: 'r-c', task_type: 'doubt_solving' }),
      ]),
      mol_shadow_text_buffer: makeTableState([
        makeTextBufferRow({ shadow_request_id: 'r-a' }),
        makeTextBufferRow({ shadow_request_id: 'r-b' }),
        makeTextBufferRow({ shadow_request_id: 'r-c' }),
      ]),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);
    const graderSpy = vi.fn(okGrader);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: graderSpy,
      samplingRates: { doubt_solving: 100 },
      batchConcurrency: 1,
    });

    expect(graderSpy).toHaveBeenCalledTimes(3);
    expect(out.graded).toBe(3);
    expect(out.skipped_no_text).toBe(0);
  });
});

// ─── B6: grader Sonnet cap ──────────────────────────────────────────────────

describe('gradeMolShadowPairs — B6: grader cap aborts without flipping kill switch', () => {
  it('aborts remaining batches when grader-side spend exceeds GRADER_DAILY_CAP_INR', async () => {
    // C4.2b-ii: with text capture wired, the grader actually runs on
    // every sampled pair that has a buffer row. We provide 4 buffer rows
    // and set graderCapInr=1.0 + estimatedGraderInrPerCall=0.6 — after
    // batch 1 (2 calls → 1.2 INR) the cap is tripped and batch 2 is
    // aborted. We assert: at most 2 graded, grader_cap_triggered=true,
    // kill_switch NOT flipped (that's only the SHADOW cap).
    const tables = {
      mol_request_logs: makeTableState([
        makeShadowRow({ request_id: 'r-1', task_type: 'doubt_solving', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-2', task_type: 'doubt_solving', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-3', task_type: 'doubt_solving', inr_cost: 0 }),
        makeShadowRow({ request_id: 'r-4', task_type: 'doubt_solving', inr_cost: 0 }),
      ]),
      mol_shadow_text_buffer: makeTableState([
        makeTextBufferRow({ shadow_request_id: 'r-1' }),
        makeTextBufferRow({ shadow_request_id: 'r-2' }),
        makeTextBufferRow({ shadow_request_id: 'r-3' }),
        makeTextBufferRow({ shadow_request_id: 'r-4' }),
      ]),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);

    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: vi.fn(okGrader),
      samplingRates: { doubt_solving: 100 },
      graderCapInr: 1.0,
      estimatedGraderInrPerCall: 0.6,
      batchConcurrency: 2,
    });

    // After batch 1 (2 pairs * 0.6 = 1.2 INR) cap is tripped; batch 2
    // never runs → at most 2 graded.
    expect(out.graded).toBeLessThanOrEqual(2);
    expect(out.grader_cap_triggered).toBe(true);
    // No audit row — only the SHADOW cap flips kill_switch + audit.
    expect(sb.auditInsertSpy).not.toHaveBeenCalled();
    // Kill switch was NOT flipped.
    expect(sb.flagUpdateSpy).not.toHaveBeenCalled();
  });

  it('grader cap is exposed as a constant separate from the shadow cap', async () => {
    // Type-only assertion that the two caps are independent surfaces.
    const { GRADER_DAILY_COST_CAP_INR, GRADER_DAILY_CAP_INR } = await import('../grader.ts');
    expect(GRADER_DAILY_COST_CAP_INR).toBeGreaterThan(GRADER_DAILY_CAP_INR);
    expect(GRADER_DAILY_CAP_INR).toBe(5_000);
    expect(GRADER_DAILY_COST_CAP_INR).toBe(10_000);
  });

  it('result shape includes grader_cap_triggered and estimated_grader_cost_inr', async () => {
    const tables = {
      mol_request_logs: makeTableState(),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
    };
    const sb = makeSupabase(tables);
    const out = await gradeMolShadowPairs(sb as unknown as Parameters<typeof gradeMolShadowPairs>[0], {
      now: () => FIXED_NOW,
      grader: vi.fn(okGrader),
    });
    expect(out).toHaveProperty('grader_cap_triggered');
    expect(out).toHaveProperty('estimated_grader_cost_inr');
    expect(out.grader_cap_triggered).toBe(false);
    expect(out.estimated_grader_cost_inr).toBe(0);
  });
});

// ─── Empty / no-op paths ─────────────────────────────────────────────────────

describe('gradeMolShadowPairs — no-op paths', () => {
  it('returns zeros when there are no ungraded shadow rows', async () => {
    const tables = {
      mol_request_logs: makeTableState(),
      feature_flags: makeTableState(),
      audit_logs: makeTableState(),
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
        grader_cap_triggered: false,
        estimated_grader_cost_inr: 0,
      }),
    );
  });
});
