import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase-admin BEFORE importing the module under test.
const insertRun = vi.fn();
const insertStep = vi.fn();
const updateRun = vi.fn();

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'agent_runs') {
        return {
          insert: (row: unknown) => {
            insertRun(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: 'run-uuid-1' }, error: null }),
              }),
            };
          },
          update: (patch: unknown) => ({
            eq: (col: string, val: unknown) => {
              updateRun({ patch, col, val });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'agent_steps') {
        return {
          insert: async (row: unknown) => {
            insertStep(row);
            return { error: null };
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  },
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { startRun, persistStep, finalizeRun, redactByDefault } from '@alfanumrik/lib/ai/agents/trace';

beforeEach(() => {
  insertRun.mockReset();
  insertStep.mockReset();
  updateRun.mockReset();
});

describe('startRun', () => {
  it('inserts an agent_runs row and returns its id', async () => {
    const id = await startRun({
      agentName: 'chapter-explorer',
      userId: null,
      contextMeta: { subject: 'science' },
    });
    expect(id).toBe('run-uuid-1');
    expect(insertRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_name: 'chapter-explorer',
        status: 'unknown_error',
        context_meta: { subject: 'science' },
      }),
    );
  });
});

describe('persistStep', () => {
  it('writes an llm_call step', async () => {
    await persistStep({
      runId: 'run-uuid-1',
      stepNumber: 1,
      stepType: 'llm_call',
      durationMs: 123,
      llm: {
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 10,
        outputTokens: 20,
        stopReason: 'tool_use',
      },
    });
    expect(insertStep).toHaveBeenCalledWith(
      expect.objectContaining({
        run_id: 'run-uuid-1',
        step_number: 1,
        step_type: 'llm_call',
        llm_model: 'claude-haiku-4-5-20251001',
        llm_input_tokens: 10,
        llm_output_tokens: 20,
        llm_stop_reason: 'tool_use',
        duration_ms: 123,
      }),
    );
  });

  it('writes a tool_call step with redacted input/output', async () => {
    await persistStep({
      runId: 'run-uuid-1',
      stepNumber: 2,
      stepType: 'tool_call',
      durationMs: 50,
      tool: {
        name: 'echo',
        inputRedacted: { msg: '[REDACTED]' },
        outputRedacted: { echo: '[REDACTED]' },
        error: null,
      },
    });
    expect(insertStep).toHaveBeenCalledWith(
      expect.objectContaining({
        step_type: 'tool_call',
        tool_name: 'echo',
        tool_input_redacted: { msg: '[REDACTED]' },
        tool_output_redacted: { echo: '[REDACTED]' },
        tool_error: null,
      }),
    );
  });
});

describe('finalizeRun', () => {
  it('updates the run with status, counts, and ended_at', async () => {
    await finalizeRun({
      runId: 'run-uuid-1',
      status: 'success',
      stepCount: 3,
      tokensInput: 100,
      tokensOutput: 200,
      finalTextRedacted: 'final',
      errorMessage: null,
    });
    expect(updateRun).toHaveBeenCalledWith({
      patch: expect.objectContaining({
        status: 'success',
        step_count: 3,
        tokens_input: 100,
        tokens_output: 200,
        final_text_redacted: 'final',
        error_message: null,
        ended_at: expect.any(String),
      }),
      col: 'id',
      val: 'run-uuid-1',
    });
  });
});

describe('redactByDefault', () => {
  it('returns full-redaction shape for objects', () => {
    expect(redactByDefault({ a: 1, b: 'secret' })).toEqual({ a: '[REDACTED]', b: '[REDACTED]' });
  });
  it('returns null for null/undefined', () => {
    expect(redactByDefault(null)).toBeNull();
    expect(redactByDefault(undefined)).toBeNull();
  });
  it('returns "[REDACTED]" for non-object primitives', () => {
    expect(redactByDefault('hello')).toBe('[REDACTED]');
    expect(redactByDefault(42)).toBe('[REDACTED]');
  });
});
