// supabase/functions/grounded-answer/__tests__/mol-shadow.integration.test.ts
//
// C4.2a wire-up (2026-05-19) — end-to-end shadow telemetry test.
//
// Unlike mol-shadow.test.ts (which mocks generateResponse and asserts the
// helper's interface), this test wires the REAL MOL orchestrator with a
// fetch-stubbed OpenAI provider and verifies the SINGLE-ROW CONTRACT:
//
//   1. fireShadowAndForget → shadowFireOpenAI → generateResponse
//   2. generateResponse honors system_prompt_override (skips prompt-builder)
//   3. generateResponse's recordMolRequest call writes exactly ONE row
//   4. That row carries shadow_role='shadow' and shadow_of_request_id
//      matching the helper's request_id
//   5. The orchestrator's auto-log is THE row — the helper itself writes
//      zero additional rows on the success path
//
// This is the smallest end-to-end test that proves the C4.2a fixes
// (prompt-parity + de-dup) work as a pair through the real orchestrator
// codepath. We mock only at the network boundary (fetch) and the
// telemetry write (so we don't need a live Postgres).

// @ts-ignore — stub Deno before module imports; MOL modules read Deno.env.
globalThis.Deno = { env: { get: (k: string) => env[k] || '' } };

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let env: Record<string, string> = {};

// Hoisted spies / mocks.
const recordMolRequestSpy = vi.fn();
const buildSystemPromptSpy = vi.fn(() => 'PROMPT_FROM_BUILDER_SHOULD_NOT_APPEAR');
const buildSimplifyPromptSpy = vi.fn(() => 'SIMPLIFY_PROMPT');
const getFlagEnvelopeSpy = vi.fn();

vi.mock('../../_shared/mol/telemetry.ts', async () => {
  const actual = await vi.importActual<typeof import('../../_shared/mol/telemetry.ts')>(
    '../../_shared/mol/telemetry.ts',
  );
  return {
    ...actual,
    recordMolRequest: (...args: unknown[]) =>
      (recordMolRequestSpy as unknown as (...a: unknown[]) => unknown)(...args),
  };
});

vi.mock('../../_shared/mol/prompt-builder.ts', () => ({
  buildSystemPrompt: buildSystemPromptSpy,
  buildSimplifyPrompt: buildSimplifyPromptSpy,
}));

vi.mock('../../_shared/mol/feature-flag.ts', async () => {
  const actual = await vi.importActual<typeof import('../../_shared/mol/feature-flag.ts')>(
    '../../_shared/mol/feature-flag.ts',
  );
  return {
    ...actual,
    getFlagEnvelope: (...args: unknown[]) =>
      (getFlagEnvelopeSpy as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
    // isFlagEnabled is used by the orchestrator for hybrid mode and OpenAI default.
    // For these tests we keep its real behavior (it reads from a fetch stub).
  };
});

beforeEach(() => {
  env = {
    OPENAI_API_KEY: 'sk-test',
    ANTHROPIC_API_KEY: 'ant-test',
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
    USD_TO_INR: '83',
  };
  recordMolRequestSpy.mockReset();
  buildSystemPromptSpy.mockClear();
  buildSimplifyPromptSpy.mockClear();
  getFlagEnvelopeSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('C4.2a integration — shadow → orchestrator → single-row contract', () => {
  it('with flag ON + 100% rollout, ONE shadow call produces ONE row tagged shadow with shadow_of_request_id matching baseline request_id', async () => {
    // Envelope ON, doubt_solving allowed, rollout 100% → guaranteed hit.
    getFlagEnvelopeSpy.mockResolvedValue({
      is_enabled: true,
      metadata: {
        enabled: true,
        kill_switch: false,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      },
    });

    // Capture the system_prompt the OpenAI provider receives so we can
    // verify the override survived the orchestrator's prompt-builder bypass.
    let capturedSystemPrompt: string | null = null;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/feature_flags'))
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.includes('mol_routing_weights'))
        return Promise.resolve(new Response('[]', { status: 200 }));
      if (url.includes('openai.com')) {
        try {
          const body = JSON.parse(String(init?.body ?? '{}'));
          const sys = body.messages?.find((m: { role: string }) => m.role === 'system');
          if (sys) capturedSystemPrompt = sys.content;
        } catch {
          // ignore
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Shadow answer body' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 100, completion_tokens: 50 },
              model: 'gpt-4o-mini',
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    // Re-import the module under test AFTER mocks are installed.
    vi.resetModules();
    const { shadowFireOpenAI } = await import('../mol-shadow.ts');

    const baselineSystemPrompt =
      'You are Foxy 🦊, the EXACT prompt baseline composed for this request.';

    await shadowFireOpenAI({
      request_id: 'baseline-uuid-integration-001',
      systemPrompt: baselineSystemPrompt,
      userMessage: 'Why is the sky blue?',
      maxTokens: 1024,
      temperature: 0.3,
      task_type: 'doubt_solving',
      surface: 'foxy',
      baseline_provider: 'anthropic',
      baseline_model: 'claude-haiku-4-5-20251001',
      trace_id: 'trace-uuid-integration-001',
      student_context: {
        student_id: 'student-integration-001',
        grade: '8',
        language: 'en',
        exam_goal: 'cbse',
        subject: 'science',
      },
    });

    // ── (1) Single-row contract: exactly ONE row written ──
    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);

    // ── (2) Prompt-parity: prompt-builder NOT invoked ──
    expect(buildSystemPromptSpy).not.toHaveBeenCalled();

    // ── (3) OpenAI saw the baseline's exact prompt ──
    expect(capturedSystemPrompt).toBe(baselineSystemPrompt);

    // ── (4) The single row is correctly tagged ──
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.shadow_role).toBe('shadow');
    expect(payload.shadow_of_request_id).toBe('baseline-uuid-integration-001');
    expect(payload.request_id).toBe('baseline-uuid-integration-001');
    expect(payload.trace_id).toBe('trace-uuid-integration-001');
    expect(payload.provider).toBe('openai');
    expect(payload.model).toBe('gpt-4o-mini');
    expect(payload.surface).toBe('foxy');
    expect(payload.task_type).toBe('doubt_solving');
    expect(payload.tokens.prompt).toBe(100);
    expect(payload.tokens.completion).toBe(50);
    // failure_chain is null on the success path (no fallback inside the
    // orchestrator since OpenAI returned 200 on the first attempt).
    expect(payload.failure_chain).toBeNull();
  });

  it('with flag OFF, ZERO rows written and ZERO OpenAI calls made', async () => {
    getFlagEnvelopeSpy.mockResolvedValue({
      is_enabled: true,
      metadata: {
        enabled: false, // master kill bit
        kill_switch: false,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      },
    });

    const openaiSpy = vi.fn();
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('openai.com')) {
        openaiSpy(url);
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { shadowFireOpenAI } = await import('../mol-shadow.ts');

    await shadowFireOpenAI({
      request_id: 'baseline-uuid-off',
      systemPrompt: 'prompt',
      userMessage: 'q',
      maxTokens: 1024,
      temperature: 0.3,
      task_type: 'doubt_solving',
      surface: 'foxy',
      baseline_provider: 'anthropic',
      baseline_model: 'claude-haiku-4-5-20251001',
      trace_id: null,
      student_context: {
        student_id: 's',
        grade: '8',
        language: 'en',
        exam_goal: null,
        subject: 'science',
      },
    });

    expect(openaiSpy).not.toHaveBeenCalled();
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });

  it('with flag ON but rollout_pct=0, ZERO rows written and ZERO OpenAI calls made (bucket miss)', async () => {
    getFlagEnvelopeSpy.mockResolvedValue({
      is_enabled: true,
      metadata: {
        enabled: true,
        kill_switch: false,
        task_types: ['doubt_solving'],
        rollout_pct: 0, // every hash falls outside 0
      },
    });

    const openaiSpy = vi.fn();
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('openai.com')) {
        openaiSpy(url);
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { shadowFireOpenAI } = await import('../mol-shadow.ts');

    await shadowFireOpenAI({
      request_id: 'baseline-uuid-bucket-miss',
      systemPrompt: 'prompt',
      userMessage: 'q',
      maxTokens: 1024,
      temperature: 0.3,
      task_type: 'doubt_solving',
      surface: 'foxy',
      baseline_provider: 'anthropic',
      baseline_model: 'claude-haiku-4-5-20251001',
      trace_id: null,
      student_context: {
        student_id: 's',
        grade: '8',
        language: 'en',
        exam_goal: null,
        subject: 'science',
      },
    });

    expect(openaiSpy).not.toHaveBeenCalled();
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });
});
