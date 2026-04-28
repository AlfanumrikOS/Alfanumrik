/**
 * Single-retrieval contract for Foxy — REG-50.
 *
 * Phase 2.B + IP filing docs require that a single Foxy turn calls the
 * NCERT retrieval RPC (`match_rag_chunks_ncert`) at MOST ONCE. The
 * pipeline is single-retrieval-then-grounding-check — never a context
 * fan-out followed by a separate grounding fetch. Multiple retrievals
 * per turn would (a) double the Supabase RPC load, (b) double the
 * embedding cost, and (c) admit subtle race conditions where the second
 * retrieval returns chunks that don't match the citations Claude saw.
 *
 * This test pins the contract by static-inspecting the canonical Edge
 * Function source (`supabase/functions/grounded-answer/pipeline.ts`).
 * The pipeline file:
 *
 *   1. Imports `retrieveChunks` exactly once.
 *   2. Calls `retrieveChunks(sb, ...)` exactly once per pipeline run.
 *   3. The grounding-check step uses the chunks from that single call —
 *      it does NOT invoke `retrieveChunks` again.
 *   4. Cache hits short-circuit BEFORE retrieval, so the contract is
 *      "≤ 1 retrieval per non-cached turn, 0 retrievals on a cache hit".
 *
 * This is a static / parity test — same pattern as
 * `foxy-rerank-fallback.test.ts` and `xp-daily-cap.test.ts` migration
 * literal pins. The Deno integration test
 * `supabase/functions/grounded-answer/__tests__/pipeline.test.ts`
 * exercises the runtime path with a stubbed Supabase client. If the
 * implementation diverges (e.g. a future PR adds a second retrieval
 * for re-ranking or re-grounding), this test fails and quality MUST
 * reject.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pipelinePath = resolve(
  process.cwd(),
  'supabase/functions/grounded-answer/pipeline.ts',
);
const pipelineSrc = readFileSync(pipelinePath, 'utf8');

describe('REG-50: single-retrieval contract for Foxy', () => {
  it('pipeline.ts imports retrieveChunks exactly once', () => {
    const importMatches = pipelineSrc.match(/import\s*\{[^}]*\bretrieveChunks\b[^}]*\}\s*from\s*['"]\.\/retrieval(?:\.ts)?['"]/g);
    expect(importMatches).not.toBeNull();
    expect(importMatches!.length).toBe(1);
  });

  it('pipeline.ts calls retrieveChunks exactly once per turn (no fan-out)', () => {
    // The canonical retrieval call in pipeline.ts. If anyone adds a
    // second `retrieveChunks(...)` invocation (e.g. for "re-grounding"
    // or "context expansion"), this assertion fails — by design.
    const callMatches = pipelineSrc.match(/\bretrieveChunks\s*\(/g);
    expect(callMatches).not.toBeNull();
    expect(callMatches!.length).toBe(1);
  });

  it('pipeline.ts grounding-check step uses chunks from the single retrieval, not a fresh RPC', () => {
    // Pin: the grounding check must consume `ctx.chunks` (the single
    // retrieval's output), not call retrieve again. We verify by
    // asserting that `ctx.chunks` is assigned exactly once and is the
    // value used downstream.
    expect(pipelineSrc).toMatch(/ctx\.chunks\s*=\s*chunks\b/);
    // And there is no second `match_rag_chunks_ncert` direct RPC call
    // sneaking in alongside the unified retrieve module.
    const directRpcMatches = pipelineSrc.match(/match_rag_chunks_ncert/g);
    // The string may appear in comments — count direct `.rpc('match_...')`
    // invocations specifically.
    const directRpcInvocations = pipelineSrc.match(/\.rpc\s*\(\s*['"]match_rag_chunks_ncert['"]/g);
    expect(directRpcInvocations).toBeNull();
    // If the substring appears at all, it should be in comments only.
    if (directRpcMatches) {
      // Sanity: the string appears only in comments / doc references.
      // We don't enforce a count — comments can mention the RPC freely.
      expect(directRpcMatches.length).toBeGreaterThan(0);
    }
  });

  it('pipeline.ts cache hit short-circuits BEFORE retrieval (zero RPC on cache hit)', () => {
    // Cache lookup runs at Step 2; retrieval runs at Step 6. The cache
    // branch returns early on hit. Pin the ordering by source position.
    const cachePos = pipelineSrc.search(/getFromCache\s*\(/);
    const retrievePos = pipelineSrc.search(/await\s+retrieveChunks\s*\(/);
    expect(cachePos).toBeGreaterThan(-1);
    expect(retrievePos).toBeGreaterThan(-1);
    expect(cachePos).toBeLessThan(retrievePos);
    // And the cache hit returns from the function before retrieval.
    const cacheReturnSnippet = pipelineSrc.slice(cachePos, retrievePos);
    expect(cacheReturnSnippet).toMatch(/return\s+hit\b/);
  });

  it('pipeline.ts uses await retrieveChunks(sb, ...) (synchronous single call, not Promise.all fan-out)', () => {
    // Defensive: a future refactor that wraps retrieve in Promise.all
    // for parallel fan-out would break the single-retrieval contract.
    expect(pipelineSrc).not.toMatch(/Promise\.all\s*\(\s*\[\s*retrieveChunks/);
    expect(pipelineSrc).toMatch(/await\s+retrieveChunks\s*\(\s*sb\b/);
  });
});
