import { describe, it, expect, vi, beforeEach } from 'vitest';

const callClaudeMock = vi.fn((..._args: unknown[]) => undefined as unknown);
const startRunMock = vi.fn(async (..._args: unknown[]) => 'run-1');
const persistStepMock = vi.fn(async (..._args: unknown[]) => undefined);
const finalizeRunMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('@alfanumrik/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
}));

vi.mock('@alfanumrik/lib/ai/agents/trace', async () => {
  const actual = await vi.importActual<typeof import('@alfanumrik/lib/ai/agents/trace')>(
    '@alfanumrik/lib/ai/agents/trace',
  );
  return {
    ...actual,
    startRun: (...args: unknown[]) => startRunMock(...args),
    persistStep: (...args: unknown[]) => persistStepMock(...args),
    finalizeRun: (...args: unknown[]) => finalizeRunMock(...args),
  };
});

vi.mock('@alfanumrik/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: vi.fn() }));
vi.mock('@alfanumrik/lib/supabase-admin', () => ({ supabaseAdmin: {} }));

import { runAgent } from '@alfanumrik/lib/ai/agents/runAgent';
import type { ToolDefinition } from '@alfanumrik/lib/ai/agents/types';
import { BudgetExceeded } from '@alfanumrik/lib/ai/agents/types';

const echoTool: ToolDefinition<{ msg: string }, { echo: string }> = {
  name: 'echo',
  description: 'echoes',
  inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
  handler: async (input) => ({ echo: input.msg }),
};

beforeEach(() => {
  callClaudeMock.mockReset();
  startRunMock.mockClear();
  persistStepMock.mockClear();
  finalizeRunMock.mockClear();
});

describe('runAgent', () => {
  it('returns final text on immediate end_turn (no tool use)', async () => {
    callClaudeMock.mockResolvedValueOnce({
      content: 'hello there',
      contentBlocks: [{ type: 'text', text: 'hello there' }],
      stopReason: 'end_turn',
      model: 'm',
      tokensUsed: 5,
      inputTokens: 3,
      outputTokens: 2,
      latencyMs: 10,
    });

    const result = await runAgent({
      agentName: 'test',
      systemPrompt: 'sys',
      userPrompt: 'hi',
      tools: [],
    });

    expect(result.finalText).toBe('hello there');
    expect(result.stepCount).toBe(1);
    expect(finalizeRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('dispatches a tool when stop_reason is tool_use, then continues', async () => {
    callClaudeMock
      .mockResolvedValueOnce({
        content: '',
        contentBlocks: [
          { type: 'tool_use', id: 'tu-1', name: 'echo', input: { msg: 'world' } },
        ],
        stopReason: 'tool_use',
        model: 'm',
        tokensUsed: 8,
        inputTokens: 5,
        outputTokens: 3,
        latencyMs: 10,
      })
      .mockResolvedValueOnce({
        content: 'echoed: world',
        contentBlocks: [{ type: 'text', text: 'echoed: world' }],
        stopReason: 'end_turn',
        model: 'm',
        tokensUsed: 6,
        inputTokens: 4,
        outputTokens: 2,
        latencyMs: 8,
      });

    const result = await runAgent({
      agentName: 'test',
      systemPrompt: 'sys',
      userPrompt: 'echo world',
      tools: [echoTool],
    });

    expect(result.finalText).toBe('echoed: world');
    expect(result.stepCount).toBe(2);

    const secondCall = callClaudeMock.mock.calls[1][0] as {
      messages: Array<{ role: string; content: Array<{ type: string; tool_use_id: string; content: string; is_error: boolean }> }>;
    };
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(Array.isArray(lastMsg.content)).toBe(true);
    expect(lastMsg.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tu-1',
      is_error: false,
    });
  });

  it('dispatches multiple tool_use blocks serially in order', async () => {
    const order: string[] = [];
    const tA: ToolDefinition = {
      name: 'a',
      description: '',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        order.push('a');
        return { x: 1 };
      },
    };
    const tB: ToolDefinition = {
      name: 'b',
      description: '',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        order.push('b');
        return { y: 2 };
      },
    };

    callClaudeMock
      .mockResolvedValueOnce({
        content: '',
        contentBlocks: [
          { type: 'tool_use', id: 't1', name: 'a', input: {} },
          { type: 'tool_use', id: 't2', name: 'b', input: {} },
        ],
        stopReason: 'tool_use',
        model: 'm',
        tokensUsed: 5,
        inputTokens: 3,
        outputTokens: 2,
        latencyMs: 5,
      })
      .mockResolvedValueOnce({
        content: 'done',
        contentBlocks: [{ type: 'text', text: 'done' }],
        stopReason: 'end_turn',
        model: 'm',
        tokensUsed: 4,
        inputTokens: 3,
        outputTokens: 1,
        latencyMs: 5,
      });

    await runAgent({ agentName: 't', systemPrompt: 's', userPrompt: 'u', tools: [tA, tB] });
    expect(order).toEqual(['a', 'b']);
  });

  it('formats handler errors as is_error tool_result and lets LLM recover', async () => {
    const failing: ToolDefinition = {
      name: 'boom',
      description: '',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        throw new Error('kaboom');
      },
    };

    callClaudeMock
      .mockResolvedValueOnce({
        content: '',
        contentBlocks: [{ type: 'tool_use', id: 'tu-x', name: 'boom', input: {} }],
        stopReason: 'tool_use',
        model: 'm',
        tokensUsed: 5,
        inputTokens: 3,
        outputTokens: 2,
        latencyMs: 5,
      })
      .mockResolvedValueOnce({
        content: 'recovered',
        contentBlocks: [{ type: 'text', text: 'recovered' }],
        stopReason: 'end_turn',
        model: 'm',
        tokensUsed: 4,
        inputTokens: 3,
        outputTokens: 1,
        latencyMs: 5,
      });

    const result = await runAgent({
      agentName: 't',
      systemPrompt: 's',
      userPrompt: 'u',
      tools: [failing],
    });
    expect(result.finalText).toBe('recovered');

    const secondCall = callClaudeMock.mock.calls[1][0] as {
      messages: Array<{ role: string; content: Array<{ type: string; tool_use_id: string; content: string; is_error: boolean }> }>;
    };
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMsg.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'tu-x',
      is_error: true,
    });
    expect(String(lastMsg.content[0].content)).toMatch(/kaboom/);
  });

  it('throws BudgetExceeded when maxSteps tripped', async () => {
    callClaudeMock.mockResolvedValue({
      content: '',
      contentBlocks: [{ type: 'tool_use', id: 'tu', name: 'echo', input: { msg: 'x' } }],
      stopReason: 'tool_use',
      model: 'm',
      tokensUsed: 5,
      inputTokens: 3,
      outputTokens: 2,
      latencyMs: 5,
    });

    await expect(
      runAgent({
        agentName: 't',
        systemPrompt: 's',
        userPrompt: 'u',
        tools: [echoTool],
        budget: { maxSteps: 2, maxTotalTokens: 100_000, maxWallMs: 60_000 },
      }),
    ).rejects.toBeInstanceOf(BudgetExceeded);

    expect(finalizeRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'budget_exceeded' }),
    );
  });

  it('persists one llm_call step per LLM response and one tool_call step per dispatch', async () => {
    callClaudeMock
      .mockResolvedValueOnce({
        content: '',
        contentBlocks: [{ type: 'tool_use', id: 'tu-1', name: 'echo', input: { msg: 'x' } }],
        stopReason: 'tool_use',
        model: 'm',
        tokensUsed: 5,
        inputTokens: 3,
        outputTokens: 2,
        latencyMs: 5,
      })
      .mockResolvedValueOnce({
        content: 'ok',
        contentBlocks: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        model: 'm',
        tokensUsed: 4,
        inputTokens: 3,
        outputTokens: 1,
        latencyMs: 5,
      });

    await runAgent({ agentName: 't', systemPrompt: 's', userPrompt: 'u', tools: [echoTool] });

    const stepTypes = persistStepMock.mock.calls.map(
      (c) => ((c as unknown[])[0] as { stepType: string }).stepType,
    );
    expect(stepTypes).toEqual(['llm_call', 'tool_call', 'llm_call']);
  });
});
