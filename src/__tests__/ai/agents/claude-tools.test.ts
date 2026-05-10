import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn() }));

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

describe('callClaude with tools', () => {
  it('passes tools and tool_choice in the request body when provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'hi' }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    });

    const { callClaude } = await import('@/lib/ai/clients/claude');
    await callClaude({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        {
          name: 'echo',
          description: 'echoes',
          input_schema: { type: 'object', properties: { x: { type: 'string' } } },
        },
      ],
      toolChoice: { type: 'auto' },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe('echo');
    expect(body.tool_choice).toEqual({ type: 'auto' });
  });

  it('returns contentBlocks containing tool_use when stop_reason is tool_use', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'looking up' },
          { type: 'tool_use', id: 'toolu_x', name: 'echo', input: { x: 'hi' } },
        ],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'tool_use',
        usage: { input_tokens: 5, output_tokens: 8 },
      }),
    });

    const { callClaude } = await import('@/lib/ai/clients/claude');
    const r = await callClaude({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        { name: 'echo', description: 'e', input_schema: { type: 'object', properties: {} } },
      ],
    });

    expect(r.stopReason).toBe('tool_use');
    expect(r.contentBlocks).toHaveLength(2);
    expect(r.contentBlocks[1]).toMatchObject({
      type: 'tool_use',
      name: 'echo',
      input: { x: 'hi' },
    });
    expect(r.content).toBe('looking up'); // text-only concatenation, back-compat
  });

  it('omits tools field when not provided (back-compat)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'hi' }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const { callClaude } = await import('@/lib/ai/clients/claude');
    await callClaude({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'go' }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});
