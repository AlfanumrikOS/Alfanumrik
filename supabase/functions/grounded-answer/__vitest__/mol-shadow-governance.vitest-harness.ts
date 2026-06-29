// supabase/functions/grounded-answer/__vitest__/mol-shadow-governance.vitest-harness.ts
//
// FOX-4 / REG-197 — MoL OpenAI-Shadow Governance (P12 AI-safety) pin.
//
// This is a THIN, self-documenting governance harness that re-asserts the two
// SAFETY invariants of the OpenAI MoL shadow in the grounded-answer path. The
// detailed behavioral coverage lives in the sibling
// `mol-shadow.vitest-harness.ts` (32 tests) — this file deliberately restates
// ONLY the two load-bearing safety guarantees under a clear FOX-4 / REG-197
// header so the govern-with-flag posture is impossible to regress silently.
//
// It reuses the exact import style + the same three mock seams that already
// work in the sibling harness (no live OpenAI key, no network, no DB):
//   - `_shared/mol/index.ts`        → generateResponse is a spy (the OpenAI seam)
//   - `_shared/mol/telemetry.ts`    → recordMolRequest is a spy (the DB seam)
//   - `_shared/mol/feature-flag.ts` → getFlagEnvelope is a spy (the flag seam)
//
// The two invariants pinned here:
//   (i)  NEVER student-facing / output discarded — `shadowFireOpenAI` and
//        `fireShadowAndForget` return void; the shadow `molResult.text` is
//        discarded (the helper routes nothing back to a caller as an answer);
//        the baseline Claude content remains the sole returned/streamed answer;
//        fire-and-forget; ZERO rows written on the success path.
//   (ii) FLAG-OFF ⇒ ZERO side effects — when enabled!==true OR kill_switch===true
//        OR the task is not allow-listed OR the sample bucket misses
//        (rollout_pct=0) OR the flag read throws → short-circuit: NO
//        generateResponse call AND NO telemetry write.

// @ts-ignore — stub Deno before module import; the MOL modules touch
// globalThis.Deno at load time. (Same prelude as the sibling harness.)
globalThis.Deno = { env: { get: (_k: string) => '' } };

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted spies (reset per test) ───────────────────────────────────────────
const generateResponseSpy = vi.fn();
const recordMolRequestSpy = vi.fn();
const getFlagEnvelopeSpy = vi.fn();
const recordShadowTextSpy = vi.fn();

vi.mock('../../_shared/mol/index.ts', () => ({
  generateResponse: (...args: unknown[]) =>
    (generateResponseSpy as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('../../_shared/mol/telemetry.ts', () => ({
  recordMolRequest: (...args: unknown[]) =>
    (recordMolRequestSpy as unknown as (...a: unknown[]) => unknown)(...args),
  recordShadowText: (...args: unknown[]) =>
    (recordShadowTextSpy as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('../../_shared/mol/feature-flag.ts', () => ({
  getFlagEnvelope: (...args: unknown[]) =>
    (getFlagEnvelopeSpy as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));

// Imports MUST come after vi.mock so the mocked bindings are in place.
import {
  shadowFireOpenAI,
  fireShadowAndForget,
  __resetShadowTextStashForTests,
  type ShadowFireArgs,
} from '../mol-shadow.ts';

// ─── Fixtures (mirror the sibling harness) ────────────────────────────────────

function okMolResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    text: 'SHADOW OUTPUT — must never reach a student; discarded by design',
    provider: 'openai',
    model: 'gpt-4o-mini',
    task_type: 'doubt_solving',
    latency_ms: 950,
    tokens: { prompt: 200, completion: 350 },
    usd_cost: 0.00033,
    inr_cost: 0.0274,
    fallback_count: 0,
    passes: 1,
    request_id: 'baseline-req-id',
    ...overrides,
  };
}

function makeArgs(overrides: Partial<ShadowFireArgs> = {}): ShadowFireArgs {
  return {
    request_id: 'baseline-req-id',
    systemPrompt: 'You are Foxy, a CBSE tutor for Class 8 Science.',
    userMessage: 'What is photosynthesis?',
    maxTokens: 1024,
    temperature: 0.3,
    task_type: 'doubt_solving',
    surface: 'foxy',
    baseline_provider: 'anthropic',
    baseline_model: 'claude-haiku-4-5-20251001',
    trace_id: 'trace-uuid-stub',
    student_context: {
      student_id: 'student-uuid-stub',
      grade: '8',
      language: 'en',
      exam_goal: 'cbse',
      subject: 'science',
    },
    ...overrides,
  };
}

function envelope(opts: {
  is_enabled?: boolean;
  enabled?: boolean;
  kill_switch?: boolean;
  task_types?: string[];
  rollout_pct?: number;
}) {
  return {
    is_enabled: opts.is_enabled ?? true,
    metadata: {
      enabled: opts.enabled,
      kill_switch: opts.kill_switch,
      task_types: opts.task_types,
      rollout_pct: opts.rollout_pct,
    },
  };
}

beforeEach(() => {
  generateResponseSpy.mockReset();
  recordMolRequestSpy.mockReset();
  getFlagEnvelopeSpy.mockReset();
  recordShadowTextSpy.mockReset();
  __resetShadowTextStashForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// FOX-4 / REG-197 — MoL OpenAI-Shadow Governance (P12 AI-safety)
// ═══════════════════════════════════════════════════════════════════════════

describe('FOX-4 / REG-197 — MoL OpenAI-shadow governance (P12)', () => {
  // ── Invariant (ii): FLAG-OFF ⇒ ZERO side effects ──────────────────────────
  describe('Invariant (ii): flag-OFF / kill-switch ⇒ ZERO side effects', () => {
    it('flag enabled=false ⇒ no generateResponse call, no telemetry write', async () => {
      getFlagEnvelopeSpy.mockResolvedValueOnce(
        envelope({ enabled: false, task_types: ['doubt_solving'], rollout_pct: 100 }),
      );

      await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();

      expect(generateResponseSpy).not.toHaveBeenCalled();
      expect(recordMolRequestSpy).not.toHaveBeenCalled();
    });

    it('kill_switch=true ⇒ no generateResponse call, no telemetry write', async () => {
      getFlagEnvelopeSpy.mockResolvedValueOnce(
        envelope({
          enabled: true,
          kill_switch: true,
          task_types: ['doubt_solving'],
          rollout_pct: 100,
        }),
      );

      await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();

      expect(generateResponseSpy).not.toHaveBeenCalled();
      expect(recordMolRequestSpy).not.toHaveBeenCalled();
    });

    it('task_type not in allow-list ⇒ no generateResponse call, no telemetry write', async () => {
      getFlagEnvelopeSpy.mockResolvedValueOnce(
        envelope({ enabled: true, task_types: ['quiz_generation'], rollout_pct: 100 }),
      );

      await shadowFireOpenAI(makeArgs({ task_type: 'doubt_solving' }));

      expect(generateResponseSpy).not.toHaveBeenCalled();
      expect(recordMolRequestSpy).not.toHaveBeenCalled();
    });

    it('sample-bucket miss (rollout_pct=0, the seeded default) ⇒ no generateResponse, no telemetry', async () => {
      getFlagEnvelopeSpy.mockResolvedValueOnce(
        envelope({ enabled: true, task_types: ['doubt_solving'], rollout_pct: 0 }),
      );

      await shadowFireOpenAI(makeArgs());

      expect(generateResponseSpy).not.toHaveBeenCalled();
      expect(recordMolRequestSpy).not.toHaveBeenCalled();
    });

    it('flag read throws ⇒ treated as disabled (fail-closed), no generateResponse, no telemetry', async () => {
      getFlagEnvelopeSpy.mockRejectedValueOnce(new Error('flag fetch failed'));

      await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();

      expect(generateResponseSpy).not.toHaveBeenCalled();
      expect(recordMolRequestSpy).not.toHaveBeenCalled();
    });
  });

  // ── Invariant (i): NEVER student-facing / output discarded ────────────────
  describe('Invariant (i): shadow is NEVER student-facing (output discarded, void return)', () => {
    it('shadowFireOpenAI resolves to undefined on the success path — it returns NO answer to any caller', async () => {
      getFlagEnvelopeSpy.mockResolvedValueOnce(
        envelope({ enabled: true, task_types: ['doubt_solving'], rollout_pct: 100 }),
      );
      generateResponseSpy.mockResolvedValueOnce(okMolResult());

      const ret = await shadowFireOpenAI(makeArgs());

      // The helper's resolved value is void — the shadow molResult.text is
      // discarded and nothing is routed back as a student-facing answer.
      expect(ret).toBeUndefined();
      // Baseline Claude content is the sole returned/streamed answer; the
      // shadow helper writes ZERO rows of its own on success (single-row
      // contract — the orchestrator's auto-log inside the mocked
      // generateResponse is the only tagged row in production).
      expect(recordMolRequestSpy).not.toHaveBeenCalled();
    });

    it('fireShadowAndForget returns void synchronously (fire-and-forget) and never throws on success', async () => {
      getFlagEnvelopeSpy.mockResolvedValueOnce(
        envelope({ enabled: true, task_types: ['doubt_solving'], rollout_pct: 100 }),
      );
      generateResponseSpy.mockResolvedValueOnce(okMolResult());

      const ret = fireShadowAndForget(makeArgs());
      expect(ret).toBeUndefined();

      // Flush microtasks so the detached promise settles without leaking.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      expect(recordMolRequestSpy).not.toHaveBeenCalled();
    });

    it('fireShadowAndForget returns void synchronously even when the shadow path rejects (failure isolation)', async () => {
      getFlagEnvelopeSpy.mockResolvedValueOnce(
        envelope({ enabled: true, task_types: ['doubt_solving'], rollout_pct: 100 }),
      );
      generateResponseSpy.mockRejectedValueOnce(new Error('OpenAI 503'));

      const ret = fireShadowAndForget(makeArgs());
      // No rejection escapes to the (student-facing) caller — the baseline
      // answer is unaffected by any shadow failure.
      expect(ret).toBeUndefined();

      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
  });
});
