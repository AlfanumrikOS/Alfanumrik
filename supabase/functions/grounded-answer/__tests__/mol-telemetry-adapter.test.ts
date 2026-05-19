// supabase/functions/grounded-answer/__tests__/mol-telemetry-adapter.test.ts
// C3 (MOL grounded-answer integration, 2026-05-18) — adapter unit tests.
//
// Runs under Vitest (NOT Deno). The companion claude.test.ts file in this
// directory is a Deno test that runs via `deno test --allow-all`. Vitest
// only picks up THIS specific file via the explicit include entry added to
// vitest.config.ts. Do not change the filename without updating that
// include list — otherwise the test will silently stop running.
//
// What we verify:
//   1. mapCallerToSurface covers every Caller literal (5 valid + 1 unknown).
//   2. mapPipelineToTaskType picks the grounding_check branch first and
//      maps every caller to the correct plan-table task_type literal.
//   3. shadowLogClaudeCall swallows BOTH synchronous and asynchronous
//      errors from recordMolRequest — telemetry failures must never reach
//      the student's response path (P12 + adapter contract).
//   4. shadowLogClaudeCall with student_context: null propagates null into
//      the LogPayload (mol_request_logs.student_id is nullable for
//      anonymous diagnostic flows).
//
// Mocking strategy: we vi.mock the `_shared/mol/telemetry` module so the
// real Supabase client is never constructed and recordMolRequest is a spy
// we can swap implementations on per-test.

// @ts-ignore — stub Deno before module import; telemetry.ts and the
// adapter touch globalThis.Deno when loaded.
//
// Return undefined (not '') so the `?? '83'` default in telemetry.ts's
// usdToInrRate() kicks in. Returning '' would short-circuit the default
// and `Number('')` = 0, zeroing every inr_cost assertion.
globalThis.Deno = { env: { get: (_k: string) => undefined } };

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted spy: vitest re-evaluates vi.mock factories per test file, so a
// module-level spy reference is stable.
const recordMolRequestSpy = vi.fn();

// PR audit 2026-05-19: the adapter now imports calcCost + toInr alongside
// recordMolRequest. We use REAL calcCost/toInr (they're pure functions with
// no side effects — see _shared/mol/telemetry.ts) so the cost-payload
// assertions exercise the real PRICING table.
//
// `vi.importActual` is used inside the factory because the same module
// also constructs a real Supabase client when imported normally — by
// running the factory through importActual we still get the pure functions
// without the Deno-env side effect (Deno.env is stubbed at the top of this
// file). The factory exports recordMolRequest as a spy and re-exports the
// pure helpers verbatim.
vi.mock('../../_shared/mol/telemetry.ts', async () => {
  const actual = await vi.importActual<typeof import('../../_shared/mol/telemetry.ts')>(
    '../../_shared/mol/telemetry.ts',
  );
  return {
    recordMolRequest: (...args: unknown[]) =>
      (recordMolRequestSpy as unknown as (...a: unknown[]) => unknown)(...args),
    calcCost: actual.calcCost,
    toInr: actual.toInr,
  };
});

// Imports MUST come after vi.mock so the mocked binding is in place.
import {
  mapCallerToSurface,
  mapPipelineToTaskType,
  shadowLogClaudeCall,
} from '../mol-telemetry-adapter.ts';
import type { ClaudeResponse } from '../claude.ts';

// ─── Test fixtures ───────────────────────────────────────────────────────────

function okClaude(overrides: Partial<Extract<ClaudeResponse, { ok: true }>> = {}):
  ClaudeResponse {
  return {
    ok: true,
    content: 'photosynthesis uses sunlight, water, and CO2.',
    model: 'claude-haiku-4-5-20251001',
    inputTokens: 120,
    outputTokens: 240,
    insufficientContext: false,
    fallback_count: 0,
    failure_chain: undefined,
    ...overrides,
  };
}

function failedClaude(reason: 'timeout' | 'auth_error' | 'server_error' | 'unknown' = 'timeout'):
  ClaudeResponse {
  return { ok: false, reason };
}

const studentCtx = {
  student_id: 'student-uuid-stub',
  grade: '8',
  subject: 'science',
  language: 'en' as const,
  exam_goal: 'cbse' as const,
};

beforeEach(() => {
  recordMolRequestSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── mapCallerToSurface ──────────────────────────────────────────────────────

describe('mapCallerToSurface', () => {
  it('foxy → foxy', () => {
    expect(mapCallerToSurface('foxy')).toBe('foxy');
  });

  it('quiz-generator → quiz', () => {
    expect(mapCallerToSurface('quiz-generator')).toBe('quiz');
  });

  it('ncert-solver → solver', () => {
    expect(mapCallerToSurface('ncert-solver')).toBe('solver');
  });

  it('concept-engine → null (internal indexing, no student surface)', () => {
    expect(mapCallerToSurface('concept-engine')).toBeNull();
  });

  it('diagnostic → null (internal health probes)', () => {
    expect(mapCallerToSurface('diagnostic')).toBeNull();
  });

  it('unknown caller → null (defensive — new callers must register here)', () => {
    expect(mapCallerToSurface('some-future-caller')).toBeNull();
  });

  it('empty string → null', () => {
    // Defense for the literal "" case which has tripped past type guards
    // in upstream callers; still returns null cleanly.
    expect(mapCallerToSurface('')).toBeNull();
  });
});

// ─── mapPipelineToTaskType ───────────────────────────────────────────────────

describe('mapPipelineToTaskType', () => {
  it('isGroundingCheck=true wins over caller (returns grounding_check)', () => {
    expect(
      mapPipelineToTaskType({ caller: 'foxy', mode: 'strict', isGroundingCheck: true }),
    ).toBe('grounding_check');
  });

  it('blocking foxy (soft) → doubt_solving', () => {
    expect(
      mapPipelineToTaskType({ caller: 'foxy', mode: 'soft', isGroundingCheck: false }),
    ).toBe('doubt_solving');
  });

  it('streaming foxy (soft) — task_type matches blocking foxy (mode unused in C3)', () => {
    // The streaming pipeline uses the same caller='foxy' + mode='soft' tuple
    // as blocking — both must produce the same task_type literal so a single
    // dashboard query covers both paths.
    expect(
      mapPipelineToTaskType({ caller: 'foxy', mode: 'soft', isGroundingCheck: false }),
    ).toBe('doubt_solving');
  });

  it('ncert-solver (strict) → step_by_step', () => {
    expect(
      mapPipelineToTaskType({ caller: 'ncert-solver', mode: 'strict', isGroundingCheck: false }),
    ).toBe('step_by_step');
  });

  it('quiz-generator → quiz_generation', () => {
    expect(
      mapPipelineToTaskType({ caller: 'quiz-generator', mode: 'strict', isGroundingCheck: false }),
    ).toBe('quiz_generation');
  });

  it('concept-engine → concept_explanation', () => {
    expect(
      mapPipelineToTaskType({ caller: 'concept-engine', mode: 'soft', isGroundingCheck: false }),
    ).toBe('concept_explanation');
  });

  it('diagnostic → evaluation (initial knowledge assessment, not generic explanation)', () => {
    // Diagnostic callers run initial knowledge assessment — structurally
    // 'evaluation', distinct from the 'explanation' fallback used for unknown
    // callers. Fixed in C3 review (assessment-agent feedback) while the
    // mapping is still unused in production (no diagnostic call sites wired).
    expect(
      mapPipelineToTaskType({ caller: 'diagnostic', mode: 'soft', isGroundingCheck: false }),
    ).toBe('evaluation');
  });

  it('unknown caller → explanation (broad fallback)', () => {
    expect(
      mapPipelineToTaskType({
        caller: 'some-future-caller',
        mode: 'soft',
        isGroundingCheck: false,
      }),
    ).toBe('explanation');
  });
});

// ─── shadowLogClaudeCall — error swallowing ──────────────────────────────────

describe('shadowLogClaudeCall — error swallowing', () => {
  it('swallows synchronous throw from recordMolRequest (no rethrow)', async () => {
    recordMolRequestSpy.mockImplementation(() => {
      throw new Error('boom-sync — supabase client construct failed');
    });

    await expect(
      shadowLogClaudeCall({
        traceId: 'trace-sync',
        studentContext: studentCtx,
        caller: 'foxy',
        mode: 'soft',
        isGroundingCheck: false,
        latencyMs: 1234,
        claudeResponse: okClaude(),
      }),
    ).resolves.toBeUndefined();

    // Spy WAS called (proves we reached recordMolRequest before it threw).
    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows asynchronous rejection inside recordMolRequest (handler attached)', async () => {
    // recordMolRequest's real contract (telemetry.ts L60-87) is to attach a
    // .then(resolve, reject) handler to its internal Supabase insert so the
    // async failure NEVER bubbles up as an unhandled rejection. We model
    // that exact contract here: the mock spawns a rejected promise BUT
    // attaches a handler that swallows it. The adapter still sees a void
    // return and must not throw.
    recordMolRequestSpy.mockImplementation(() => {
      Promise.reject(new Error('boom-async — network down')).catch(() => {
        // handler attached, same as telemetry.ts insert().then(_, err=>...)
      });
    });

    await expect(
      shadowLogClaudeCall({
        traceId: 'trace-async',
        studentContext: studentCtx,
        caller: 'foxy',
        mode: 'soft',
        isGroundingCheck: false,
        latencyMs: 999,
        claudeResponse: okClaude(),
      }),
    ).resolves.toBeUndefined();

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT call recordMolRequest when ClaudeResponse is ok:false', async () => {
    await shadowLogClaudeCall({
      traceId: 'trace-failed-claude',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 5000,
      claudeResponse: failedClaude('timeout'),
    });

    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });
});

// ─── shadowLogClaudeCall — LogPayload contract ──────────────────────────────

describe('shadowLogClaudeCall — LogPayload contract', () => {
  it('propagates student_context: null as student_id: null in LogPayload', async () => {
    await shadowLogClaudeCall({
      traceId: 'trace-anon',
      studentContext: null,
      caller: 'diagnostic',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 500,
      claudeResponse: okClaude(),
    });

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.student_id).toBeNull();
    expect(payload.grade).toBeNull();
    expect(payload.language).toBeNull();
    expect(payload.exam_goal).toBeNull();
  });

  // ── C4.2b-i baseline-row tagging (2026-05-19) ──
  // The adapter must stamp shadow_role='baseline' on every row it writes
  // so mol_shadow_pairs_v1 (which JOINs baseline.shadow_role='baseline' ↔
  // shadow.shadow_role='shadow') can pair the legs. Before this fix the
  // adapter wrote shadow_role=NULL on baseline rows and the view silently
  // returned zero rows even when shadow was firing — architect-flagged on
  // PR #856.
  it('stamps shadow_role: "baseline" on every successful baseline row', async () => {
    await shadowLogClaudeCall({
      traceId: 'trace-baseline-tag',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 1234,
      claudeResponse: okClaude(),
    });

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.shadow_role).toBe('baseline');
    // shadow_of_request_id and trace_id remain unset by the adapter —
    // baseline rows have no "shadow of" anchor, and the C3 adapter does
    // not yet plumb the grounded_ai_traces.id through (that's the C4.2b-ii
    // follow-up). The LogPayload boundary in telemetry.ts coerces both
    // undefined values to NULL at insert time.
    expect(payload.shadow_of_request_id).toBeUndefined();
    expect(payload.trace_id).toBeUndefined();
  });

  it('baseline tag applies regardless of caller / mode / grounding-check', async () => {
    // The tag is unconditional: every row this adapter writes is a baseline
    // row. We exercise the four most-common (caller, mode, isGroundingCheck)
    // combinations to guarantee no branch silently strips the tag.
    const matrix: Array<{
      caller: string;
      mode: 'soft' | 'strict';
      isGroundingCheck: boolean;
    }> = [
      { caller: 'foxy', mode: 'soft', isGroundingCheck: false },
      { caller: 'foxy', mode: 'strict', isGroundingCheck: true },
      { caller: 'ncert-solver', mode: 'strict', isGroundingCheck: false },
      { caller: 'quiz-generator', mode: 'strict', isGroundingCheck: false },
    ];

    for (const m of matrix) {
      recordMolRequestSpy.mockReset();
      await shadowLogClaudeCall({
        traceId: `trace-${m.caller}-${m.mode}-${m.isGroundingCheck}`,
        studentContext: studentCtx,
        caller: m.caller,
        mode: m.mode,
        isGroundingCheck: m.isGroundingCheck,
        latencyMs: 500,
        claudeResponse: okClaude(),
      });
      const payload = recordMolRequestSpy.mock.calls[0]?.[0];
      expect(payload).toBeDefined();
      expect(payload.shadow_role).toBe('baseline');
    }
  });

  it('splits ClaudeResponse.inputTokens/outputTokens into LogPayload.tokens', async () => {
    await shadowLogClaudeCall({
      traceId: 'trace-tokens',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 1111,
      claudeResponse: okClaude({ inputTokens: 73, outputTokens: 412 }),
    });

    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.tokens).toEqual({ prompt: 73, completion: 412 });
    expect(payload.provider).toBe('anthropic');
    expect(payload.passes).toBe(1);
    expect(payload.model).toBe('claude-haiku-4-5-20251001');
    expect(payload.task_type).toBe('doubt_solving');
    expect(payload.surface).toBe('foxy');
  });

  // ── PR audit 2026-05-19: baseline rows now carry computed cost ──
  // Before this fix the adapter hardcoded usd_cost=0 / inr_cost=0 with a
  // "backfill via SQL later" comment. Shadow data revealed 30 days of
  // zero-cost baseline rows would make every C5 cutover dashboard look
  // wrong. Cost is now computed at write time via calcCost() / toInr().
  it('computes usd_cost and inr_cost for a known anthropic model (claude-haiku)', async () => {
    // claude-haiku-4-5-20251001 pricing: input 1.00/1M, output 5.00/1M.
    // tokens: 100_000 prompt + 50_000 completion
    //   = (100_000 / 1_000_000) * 1.00 + (50_000 / 1_000_000) * 5.00
    //   = 0.10 + 0.25 = 0.35 USD
    // INR @ default rate 83 → 29.05; toInr() rounds to 4dp = 29.0500
    await shadowLogClaudeCall({
      traceId: 'trace-cost',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 800,
      claudeResponse: okClaude({ inputTokens: 100_000, outputTokens: 50_000 }),
    });

    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.usd_cost).toBeCloseTo(0.35, 4);
    expect(payload.inr_cost).toBeCloseTo(29.05, 2);
  });

  it('computes cost via PRICING table for claude-sonnet too', async () => {
    // claude-sonnet-4-6-20251022 pricing: input 3.00/1M, output 15.00/1M.
    // tokens: 1_000_000 prompt + 1_000_000 completion
    //   = 1.00 * 3.00 + 1.00 * 15.00 = 18.00 USD
    // INR @ default rate 83 = 1494.00
    await shadowLogClaudeCall({
      traceId: 'trace-cost-sonnet',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 1234,
      claudeResponse: okClaude({
        model: 'claude-sonnet-4-6-20251022',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    });

    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.usd_cost).toBeCloseTo(18.00, 4);
    expect(payload.inr_cost).toBeCloseTo(1494.0, 2);
  });

  it('falls back to usd_cost=0 / inr_cost=0 for unknown model (no PRICING row)', async () => {
    // claude-imaginary-model is not in PRICING → calcCost returns 0 → inr 0.
    // This preserves the fail-safe: a missing PRICING row never breaks
    // the request path; cost just shows up as 0 until SQL backfill runs.
    await shadowLogClaudeCall({
      traceId: 'trace-unknown-model',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 700,
      claudeResponse: okClaude({
        model: 'claude-imaginary-future-model',
        inputTokens: 1_000,
        outputTokens: 500,
      }),
    });

    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.usd_cost).toBe(0);
    expect(payload.inr_cost).toBe(0);
  });

  it('isGroundingCheck=true emits task_type=grounding_check even for caller=foxy', async () => {
    await shadowLogClaudeCall({
      traceId: 'trace-gc',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'strict',
      isGroundingCheck: true,
      latencyMs: 600,
      claudeResponse: okClaude(),
    });

    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.task_type).toBe('grounding_check');
    expect(payload.surface).toBe('foxy');
  });

  it('failure_chain array becomes pipe-joined string; empty/undefined becomes null', async () => {
    // Case 1: fallback fired → joined string + count
    await shadowLogClaudeCall({
      traceId: 'trace-with-fallback',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 1500,
      claudeResponse: okClaude({
        fallback_count: 2,
        failure_chain: ['anthropic:timeout', 'anthropic:5xx'],
        model: 'claude-sonnet-4-20250514',
      }),
    });
    let payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.fallback_count).toBe(2);
    expect(payload.failure_chain).toBe('anthropic:timeout|anthropic:5xx');
    expect(payload.model).toBe('claude-sonnet-4-20250514');

    recordMolRequestSpy.mockReset();

    // Case 2: no fallback (happy path) → null + 0
    await shadowLogClaudeCall({
      traceId: 'trace-no-fallback',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 700,
      claudeResponse: okClaude({ fallback_count: 0, failure_chain: undefined }),
    });
    payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.fallback_count).toBe(0);
    expect(payload.failure_chain).toBeNull();
  });

  it('uses traceId as request_id (multiple log rows per request_id are allowed by schema)', async () => {
    // Pre-verified architect fact #1: mol_request_logs.request_id has no
    // unique constraint. Two log rows with the same trace_id (primary + a
    // future grounding-check) are fine.
    await shadowLogClaudeCall({
      traceId: 'shared-trace-id',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'soft',
      isGroundingCheck: false,
      latencyMs: 100,
      claudeResponse: okClaude(),
    });
    await shadowLogClaudeCall({
      traceId: 'shared-trace-id',
      studentContext: studentCtx,
      caller: 'foxy',
      mode: 'strict',
      isGroundingCheck: true,
      latencyMs: 200,
      claudeResponse: okClaude(),
    });

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(2);
    expect(recordMolRequestSpy.mock.calls[0][0].request_id).toBe('shared-trace-id');
    expect(recordMolRequestSpy.mock.calls[1][0].request_id).toBe('shared-trace-id');
    // But task_type differs — that's the discriminator between primary
    // answer and grounding-check rows.
    expect(recordMolRequestSpy.mock.calls[0][0].task_type).toBe('doubt_solving');
    expect(recordMolRequestSpy.mock.calls[1][0].task_type).toBe('grounding_check');
  });
});
