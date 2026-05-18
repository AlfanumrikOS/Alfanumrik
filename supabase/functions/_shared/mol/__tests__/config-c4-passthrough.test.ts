// supabase/functions/_shared/mol/__tests__/config-c4-passthrough.test.ts
//
// C4.2a (2026-05-19) — verify the orchestrator honors the three new
// GenerateRequest.config fields introduced for grounded-answer shadow
// routing:
//
//   1. system_prompt_override → MOL bypasses buildSystemPrompt() entirely
//      and uses the caller's exact string. This is the prompt-parity fix
//      from C4.1 review: shadow legs must answer the SAME composed prompt
//      baseline sent to Claude, or the offline grader compares apples to
//      oranges.
//
//   2. shadow_role → stamped onto recordMolRequest's LogPayload so the
//      auto-logged telemetry row carries the correct tag without the
//      caller writing a separate row.
//
//   3. shadow_of_request_id → JOIN key onto the same LogPayload.
//
//   4. trace_id → propagated onto LogPayload for cross-service correlation
//      with grounded_ai_traces.
//
// The pre-C4 behavior MUST be preserved: when the caller passes none of
// these fields, the orchestrator behaves byte-identical to its prior
// contract (buildSystemPrompt runs, recordMolRequest writes shadow_role
// and shadow_of_request_id as NULL).

import { describe, it, expect, vi, beforeEach } from 'vitest';

function mockDeno(env: Record<string, string>) {
  // @ts-ignore — stub Deno before module import
  globalThis.Deno = { env: { get: (k: string) => env[k] || '' } };
}

function mockFlags(
  flags: Array<{
    flag_name: string;
    is_enabled: boolean;
    rollout_percentage: number | null;
    target_environments: string[] | null;
  }>,
) {
  return new Response(JSON.stringify(flags), { status: 200 });
}

function mockOpenAIResponse(text: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      model: 'gpt-4o-mini',
    }),
    { status: 200 },
  );
}

describe('MOL orchestrator — C4.2a config passthrough', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    mockDeno({
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'ant-test',
      SUPABASE_URL: 'https://supa.test',
      SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
      USD_TO_INR: '83',
    });
    vi.resetModules();
  });

  it('system_prompt_override → orchestrator skips buildSystemPrompt and uses the override verbatim', async () => {
    // Mock prompt-builder so we can spy on whether buildSystemPrompt is
    // called. The orchestrator's import is cached at module load — we
    // re-import via vi.resetModules() in beforeEach.
    const buildSystemPromptSpy = vi.fn(() => 'DEFAULT_PROMPT_FROM_BUILDER');
    const buildSimplifyPromptSpy = vi.fn(() => 'SIMPLIFY_PROMPT_FROM_BUILDER');
    vi.doMock('../prompt-builder.ts', () => ({
      buildSystemPrompt: buildSystemPromptSpy,
      buildSimplifyPrompt: buildSimplifyPromptSpy,
    }));

    // Capture the system_prompt sent to OpenAI so we can verify the
    // override survived the prompt-builder bypass.
    let capturedSystemPrompt: string | null = null;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/feature_flags')) return Promise.resolve(mockFlags([]));
      if (url.includes('mol_routing_weights'))
        return Promise.resolve(new Response('[]', { status: 200 }));
      if (url.includes('openai.com')) {
        // OpenAI provider body is { messages: [{role:'system', content: ...}, ...] }
        try {
          const body = JSON.parse(String(init?.body ?? '{}'));
          const sys = body.messages?.find((m: { role: string }) => m.role === 'system');
          if (sys) capturedSystemPrompt = sys.content;
        } catch {
          // Ignore parse errors
        }
        return Promise.resolve(mockOpenAIResponse('Override response body'));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    const { generateResponse } = await import('../index.ts');
    const override = 'CALLER_SUPPLIED_SYSTEM_PROMPT — exactly this string.';
    const r = await generateResponse({
      task_type: 'explanation',
      input: { question: 'Explain photosynthesis' },
      student_context: { student_id: 's1', grade: '6', language: 'en' },
      config: {
        system_prompt_override: override,
      },
    });

    // prompt-builder must NOT have been invoked.
    expect(buildSystemPromptSpy).not.toHaveBeenCalled();
    // The OpenAI provider received the override verbatim.
    expect(capturedSystemPrompt).toBe(override);
    expect(r.provider).toBe('openai');
  });

  it('omitting system_prompt_override → prompt-builder runs as before', async () => {
    const buildSystemPromptSpy = vi.fn(() => 'BUILDER_OUTPUT');
    vi.doMock('../prompt-builder.ts', () => ({
      buildSystemPrompt: buildSystemPromptSpy,
      buildSimplifyPrompt: vi.fn(() => 'SIMPLIFY'),
    }));

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) return Promise.resolve(mockFlags([]));
      if (url.includes('mol_routing_weights'))
        return Promise.resolve(new Response('[]', { status: 200 }));
      if (url.includes('openai.com'))
        return Promise.resolve(mockOpenAIResponse('regular response'));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    const { generateResponse } = await import('../index.ts');
    await generateResponse({
      task_type: 'explanation',
      input: { question: 'Explain photosynthesis' },
      student_context: { student_id: 's1', grade: '6', language: 'en' },
      // No config.system_prompt_override
    });

    expect(buildSystemPromptSpy).toHaveBeenCalledTimes(1);
  });

  it('shadow_role + shadow_of_request_id + trace_id → propagated onto the recordMolRequest LogPayload', async () => {
    // Mock telemetry so we can spy on the LogPayload the orchestrator hands
    // to recordMolRequest. The auto-log is the SOLE row for the shadow path
    // (C4.2a de-dup contract).
    const recordMolRequestSpy = vi.fn();
    vi.doMock('../telemetry.ts', async () => {
      const actual = await vi.importActual<typeof import('../telemetry.ts')>('../telemetry.ts');
      return {
        ...actual,
        recordMolRequest: recordMolRequestSpy,
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) return Promise.resolve(mockFlags([]));
      if (url.includes('mol_routing_weights'))
        return Promise.resolve(new Response('[]', { status: 200 }));
      if (url.includes('openai.com'))
        return Promise.resolve(mockOpenAIResponse('shadow response'));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    const { generateResponse } = await import('../index.ts');
    await generateResponse({
      task_type: 'doubt_solving',
      input: { question: 'Why does sky look blue?' },
      student_context: { student_id: 's-shadow', grade: '8', language: 'en' },
      config: {
        preferred_provider: 'openai',
        request_id: 'baseline-req-id-99',
        surface: 'foxy',
        shadow_role: 'shadow',
        shadow_of_request_id: 'baseline-req-id-99',
        trace_id: 'trace-row-id-99',
      },
    });

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.shadow_role).toBe('shadow');
    expect(payload.shadow_of_request_id).toBe('baseline-req-id-99');
    expect(payload.trace_id).toBe('trace-row-id-99');
    expect(payload.request_id).toBe('baseline-req-id-99');
    expect(payload.surface).toBe('foxy');
  });

  it('omitting shadow_role / shadow_of_request_id / trace_id → LogPayload carries explicit nulls (legacy contract)', async () => {
    const recordMolRequestSpy = vi.fn();
    vi.doMock('../telemetry.ts', async () => {
      const actual = await vi.importActual<typeof import('../telemetry.ts')>('../telemetry.ts');
      return {
        ...actual,
        recordMolRequest: recordMolRequestSpy,
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/feature_flags')) return Promise.resolve(mockFlags([]));
      if (url.includes('mol_routing_weights'))
        return Promise.resolve(new Response('[]', { status: 200 }));
      if (url.includes('openai.com'))
        return Promise.resolve(mockOpenAIResponse('legacy caller response'));
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    const { generateResponse } = await import('../index.ts');
    await generateResponse({
      task_type: 'explanation',
      input: { question: 'Explain photosynthesis' },
      student_context: { student_id: 's-legacy', grade: '6', language: 'en' },
    });

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.shadow_role).toBeNull();
    expect(payload.shadow_of_request_id).toBeNull();
    expect(payload.trace_id).toBeNull();
  });
});
