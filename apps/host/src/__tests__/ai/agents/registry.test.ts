import { describe, it, expect } from 'vitest';
import { createRegistry } from '@alfanumrik/lib/ai/agents/registry';
import type { ToolDefinition } from '@alfanumrik/lib/ai/agents/types';

const ctx = { userId: null, meta: {} };

const echoTool: ToolDefinition<{ msg: string }, { echo: string }> = {
  name: 'echo',
  description: 'Echoes a message',
  inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
  handler: async (input) => ({ echo: input.msg }),
};

const flakyTool: ToolDefinition = {
  name: 'flaky',
  description: 'Always fails',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    throw new Error('boom');
  },
};

describe('createRegistry', () => {
  it('rejects duplicate tool names', () => {
    expect(() => createRegistry([echoTool, { ...echoTool }])).toThrow(/duplicate/i);
  });

  it('returns Anthropic-shaped schemas via .schemas()', () => {
    const r = createRegistry([echoTool]);
    expect(r.schemas()).toEqual([
      { name: 'echo', description: 'Echoes a message', input_schema: echoTool.inputSchema },
    ]);
  });

  it('dispatches a tool by name and returns ok+output', async () => {
    const r = createRegistry([echoTool]);
    const result = await r.dispatch('echo', { msg: 'hi' }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toEqual({ echo: 'hi' });
  });

  it('returns ok=false when handler throws', async () => {
    const r = createRegistry([flakyTool]);
    const result = await r.dispatch('flaky', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/boom/);
  });

  it('returns ok=false when tool name is unknown', async () => {
    const r = createRegistry([echoTool]);
    const result = await r.dispatch('nope', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown tool/i);
  });

  it('opens per-tool circuit after 3 consecutive failures of the same tool', async () => {
    const r = createRegistry([flakyTool]);
    await r.dispatch('flaky', {}, ctx); // fail 1
    await r.dispatch('flaky', {}, ctx); // fail 2
    await r.dispatch('flaky', {}, ctx); // fail 3 — circuit opens
    const result = await r.dispatch('flaky', {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/circuit open|unavailable/i);
  });

  it('resets per-tool failure count on success', async () => {
    let calls = 0;
    const sometimes: ToolDefinition = {
      name: 'sometimes',
      description: 'fails twice then succeeds forever',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        calls += 1;
        if (calls <= 2) throw new Error('flake');
        return { ok: true };
      },
    };
    const r = createRegistry([sometimes]);
    await r.dispatch('sometimes', {}, ctx); // fail 1
    await r.dispatch('sometimes', {}, ctx); // fail 2
    await r.dispatch('sometimes', {}, ctx); // success → counter resets

    const flakyAgain: ToolDefinition = {
      name: 'sometimes',
      description: '',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        throw new Error('flake');
      },
    };
    const r2 = createRegistry([flakyAgain]);
    await r2.dispatch('sometimes', {}, ctx);
    await r2.dispatch('sometimes', {}, ctx);
    await r2.dispatch('sometimes', {}, ctx);
    const fourth = await r2.dispatch('sometimes', {}, ctx);
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.error).toMatch(/circuit open|unavailable/i);
  });
});
