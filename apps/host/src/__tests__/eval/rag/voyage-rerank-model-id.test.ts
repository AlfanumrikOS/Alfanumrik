// src/__tests__/eval/rag/voyage-rerank-model-id.test.ts
//
// Voyage rerank MODEL-ID production guard.
//
// Background: the legacy identifier `'voyage-rerank-2'` is NOT a valid Voyage
// rerank API model id. The Voyage `/v1/rerank` endpoint REJECTS it with HTTP
// 400 ("Model voyage-rerank-2 is not supported. Supported models are
// ['rerank-lite-1','rerank-2-lite','rerank-2','rerank-2.5','rerank-2.5-lite']").
// Because both `_shared` rerank clients swallow rerank failures and fall back
// to similarity order, the stale id SILENTLY DISABLED reranking in production
// (the B1 eval-harness baseline run caught this — Task 10/11). The fix points
// both call sites at the supported id `'rerank-2'` (same model — no provider /
// model / dimension swap; that would need CEO approval per P-AI-model-change).
//
// This test PINS the model id at BOTH production call sites so any future drift
// back to an unsupported string FAILS CI before it can silently kill rerank in
// prod again. It is a source-string scan (the same defense-in-depth pattern as
// import-boundary.test.ts) because the two clients are Deno modules under
// supabase/functions/** that `npm test` cannot import directly.
//
// Owner: testing. Pins: Voyage rerank model-id production guard (proposed REG).
// Pure/offline lane: filesystem read only, no DB, no network, no LLM.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

// Repo root: this file is src/__tests__/eval/rag/<file> → 4 up.
const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

// The complete supported Voyage rerank model set (as returned in the HTTP 400
// "Supported models are [...]" message). The legacy 'voyage-rerank-2' is
// deliberately NOT in this set — that is the whole point of the guard.
const SUPPORTED_VOYAGE_RERANK_MODELS = [
  'rerank-lite-1',
  'rerank-2-lite',
  'rerank-2',
  'rerank-2.5',
  'rerank-2.5-lite',
] as const;

// The two production rerank call sites that send a Voyage `/v1/rerank` request.
// Each declares its model id in a module-level constant.
const CALL_SITES = [
  {
    file: 'supabase/functions/_shared/rag/retrieve.ts',
    constName: 'VOYAGE_RERANK_MODEL',
  },
  {
    file: 'supabase/functions/_shared/reranking.ts',
    constName: 'RERANK_MODEL',
  },
] as const;

// Capture the single-/double-quoted string literal assigned to a given
// `const <name> = '...'` declaration. Tolerates optional trailing semicolon and
// whitespace. Anchored to `^\s*const` so a same-named field elsewhere (e.g. in a
// request body or comment) cannot be mistaken for the declaration.
function extractConstStringLiteral(src: string, constName: string): string | null {
  const re = new RegExp(
    `^\\s*const\\s+${constName}\\s*=\\s*['"]([^'"]+)['"]`,
    'm',
  );
  const m = src.match(re);
  return m ? m[1] : null;
}

describe('Voyage rerank model-id production guard', () => {
  for (const { file, constName } of CALL_SITES) {
    it(`${file} → ${constName} is a SUPPORTED Voyage rerank model id`, () => {
      const src = readFileSync(resolve(ROOT, file), 'utf-8');
      const modelId = extractConstStringLiteral(src, constName);

      expect(
        modelId,
        `Could not find a 'const ${constName} = "..."' declaration in ${file}. ` +
          `If the constant was renamed, update this guard.`,
      ).not.toBeNull();

      expect(
        SUPPORTED_VOYAGE_RERANK_MODELS as readonly string[],
        `${file}:${constName} = "${modelId}" is NOT a supported Voyage rerank ` +
          `model id. The Voyage /v1/rerank endpoint will reject it with HTTP 400 ` +
          `and reranking will SILENTLY fall back to similarity order in production. ` +
          `Supported: [${SUPPORTED_VOYAGE_RERANK_MODELS.join(', ')}]. ` +
          `(The legacy 'voyage-rerank-2' is NOT supported — use 'rerank-2'.)`,
      ).toContain(modelId);
    });

    it(`${file} → does NOT use the stale 'voyage-rerank-2' identifier at the ${constName} call site`, () => {
      const src = readFileSync(resolve(ROOT, file), 'utf-8');
      const modelId = extractConstStringLiteral(src, constName);
      // Explicit regression pin on the exact known-bad value, independent of the
      // supported-set membership check above.
      expect(modelId).not.toBe('voyage-rerank-2');
    });
  }

  it('the guard would actually FIRE on the known-bad legacy id (tripwire on the matcher)', () => {
    // Proves the extractor + membership check would catch a real regression and
    // is not silently passing on a parse failure.
    const fakeSrc = `const VOYAGE_RERANK_MODEL = 'voyage-rerank-2';`;
    const extracted = extractConstStringLiteral(fakeSrc, 'VOYAGE_RERANK_MODEL');
    expect(extracted).toBe('voyage-rerank-2');
    expect(SUPPORTED_VOYAGE_RERANK_MODELS as readonly string[]).not.toContain(
      extracted,
    );
  });
});
