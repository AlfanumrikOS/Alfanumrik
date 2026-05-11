/**
 * agents/runtime/anthropic.ts — minimal Anthropic Messages API client.
 *
 * We avoid the npm SDK and call the API directly via fetch for two reasons:
 *   1. Adding a third-party dep needs explicit user approval; this module
 *      keeps the runtime self-contained.
 *   2. The Edge Functions in supabase/functions/ already call Anthropic
 *      via fetch from Deno, so this matches the project's house pattern.
 *
 * Covers ONLY what the L4 agent loop needs: text + tool_use response
 * blocks, tool_result content blocks back in, ephemeral cache_control on
 * the system prompt. Streaming, vision, and PDF support are deliberately
 * out of scope.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  required for any real call (assertAnthropicReady)
 *
 * Cost ceiling lives at the call site (agents/runtime/layers/l4-code-agent.ts)
 * — this module just reports usage in the response so the caller can stop.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// ─── Public types (mirror the API shape, narrowed to what we use) ─────

export type Model = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface CreateMessageRequest {
  model: Model;
  max_tokens: number;
  system?: string | SystemBlock[];
  messages: Message[];
  tools?: ToolDef[];
  temperature?: number;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface CreateMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | string;
  usage: Usage;
}

// ─── Env / boot checks ────────────────────────────────────────────────

export function assertAnthropicReady(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY missing. The key is configured in Vercel — pull it once with:\n' +
        '  vercel env pull .env.local --environment=development\n' +
        "Then re-run the tick. (The agent runtime auto-loads .env.local from the repo root.)",
    );
  }
}

// ─── Call ─────────────────────────────────────────────────────────────

export async function createMessage(req: CreateMessageRequest): Promise<CreateMessageResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing (assertAnthropicReady should have been called).');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as CreateMessageResponse;
}

// ─── Pure helpers (unit-testable) ─────────────────────────────────────

export function extractText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

export function extractToolUses(blocks: ContentBlock[]): ToolUseBlock[] {
  return blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

export function sumTokens(usages: Usage[]): number {
  return usages.reduce((acc, u) => acc + u.input_tokens + u.output_tokens, 0);
}
