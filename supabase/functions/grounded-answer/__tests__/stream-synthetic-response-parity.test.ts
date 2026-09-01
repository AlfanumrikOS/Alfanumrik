// supabase/functions/grounded-answer/__tests__/stream-synthetic-response-parity.test.ts
//
// Guards the ONE place in this function that rebuilds a ClaudeResponse field by
// field instead of spreading it: the `syntheticResponse` literal in
// pipeline-stream.ts, which feeds the MOL telemetry adapter for every STREAMED
// turn — i.e. every Foxy answer.
//
// ── The bug this exists to prevent ───────────────────────────────────────────
//
// 2026-09-01. claude.ts was fixed to capture Anthropic's prompt-cache counters
// (cache_read_input_tokens / cache_creation_input_tokens), the adapter was
// fixed to forward them, the migration added the columns, and it was deployed
// and verified green. A real Foxy turn immediately afterwards STILL logged:
//
//     prompt_tokens 22 | cache_read_tokens 0 | cache_write_tokens 0
//
// because this literal copies fields one by one and simply did not list the two
// new ones. They were dropped between a correct producer and a correct
// consumer. ~11,500 real input tokens kept pricing at zero.
//
// TypeScript could not catch it: the fields are OPTIONAL on the ok-variant
// (they must be — OpenAI never reports them), so omitting them type-checks
// cleanly. Only a value-level check finds this, hence a source assertion rather
// than a type test.
//
// STANDING RULE: every field added to the ClaudeResponse ok-variant that
// carries usage or cost MUST be listed in the literal AND here.

import { assert, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';

const STREAM_SRC = new URL('../pipeline-stream.ts', import.meta.url);

async function syntheticResponseLiteral(): Promise<string> {
  const src = await Deno.readTextFile(STREAM_SRC);
  const start = src.indexOf('const syntheticResponse: ClaudeResponse = {');
  assert(start >= 0, 'syntheticResponse literal not found — did it get renamed or removed?');
  const end = src.indexOf('};', start);
  assert(end > start, 'could not find the end of the syntheticResponse literal');
  return src.slice(start, end);
}

Deno.test('streamed turns forward Anthropic prompt-cache counters to telemetry', async () => {
  const literal = await syntheticResponseLiteral();
  // The exact regression: present in claude.ts, absent here, silently zeroed.
  assert(
    /cacheReadTokens\s*:/.test(literal),
    'syntheticResponse must copy cacheReadTokens — without it every STREAMED turn ' +
      'logs cache_read_tokens=0 and prices the cached prompt at zero.',
  );
  assert(
    /cacheWriteTokens\s*:/.test(literal),
    'syntheticResponse must copy cacheWriteTokens — a cache WRITE bills at 1.25x ' +
      'input, so omitting it under-reports the most expensive case.',
  );
});

Deno.test('streamed turns still forward the base token counts', async () => {
  const literal = await syntheticResponseLiteral();
  for (const field of ['inputTokens', 'outputTokens', 'fallback_count', 'failure_chain', 'failedAttempts']) {
    assert(
      new RegExp(`${field}\\s*:`).test(literal),
      `syntheticResponse must copy ${field} — telemetry and cost depend on it.`,
    );
  }
});

// Belt-and-braces: if someone converts the literal to a spread, this file's
// premise disappears and the field-by-field assertions above become
// meaningless-but-passing. Fail loudly instead so the guard is re-thought
// rather than silently rotting into a no-op.
Deno.test('syntheticResponse is still built field-by-field (guard premise holds)', async () => {
  const literal = await syntheticResponseLiteral();
  assertEquals(
    /\.\.\.evt/.test(literal),
    false,
    'syntheticResponse now spreads `evt`. That is arguably BETTER — a spread cannot ' +
      'drop fields — but it makes the per-field assertions in this file vacuous. ' +
      'Delete them and pin the spread instead.',
  );
});
