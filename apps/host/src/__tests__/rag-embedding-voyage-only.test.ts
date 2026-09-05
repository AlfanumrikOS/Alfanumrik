import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RAG embedding boundary canary (CEO directive 2026-09-05).
 *
 * HARD RULE: RAG chunking and embedding must be generated with Voyage ONLY.
 * A paid chat-completion vendor's key (OpenAI, Anthropic) must never be spent
 * on embeddings — a prior OpenAI `text-embedding-3-small` fallback in
 * `_shared/embeddings.ts` could silently drain the OpenAI key when
 * VOYAGE_API_KEY was missing. This test fails the build if that class of
 * regression reappears in any embedding / chunking / retrieval-embedding path.
 *
 * It is a static source scan (like the repo's other anti-fork canaries), so it
 * cannot be bypassed at runtime and needs no network. If you are adding a
 * legitimate NON-embedding LLM call to one of these files, this test is telling
 * you it does not belong in the embedding path — move it out.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

// The files whose ONLY AI dependency may be the embedding vendor (Voyage).
// These generate or fetch vector embeddings for RAG.
const EMBEDDING_PATH_FILES = [
  'supabase/functions/_shared/embeddings.ts',
  'supabase/functions/_shared/rag/retrieve.ts',
  'supabase/functions/grounded-answer/embedding.ts',
  'supabase/functions/alfabot-answer/retrieval.ts',
  'packages/lib/src/ai/retrieval/ncert-retriever.ts',
  'scripts/ncert-ingestion/embed-chunks.ts',
];

// Endpoints/models that mean "a paid chat vendor is doing embeddings or is
// wired into a pure-embedding path". Voyage is the only allowed embedder.
const FORBIDDEN_IN_EMBEDDING_PATH: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /api\.openai\.com\/v1\/embeddings/i, why: 'OpenAI embeddings endpoint' },
  { pattern: /text-embedding-3(-small|-large)?/i, why: 'OpenAI embedding model id' },
  { pattern: /api\.anthropic\.com/i, why: 'Anthropic API (no embeddings product; never in an embed path)' },
  { pattern: /OPENAI_PROVIDER/, why: 'the removed OpenAI embedding provider' },
];

/** Strip line and block comments so an explanatory comment naming the ban is not a hit. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('RAG embedding boundary — Voyage only, no paid chat-vendor drain', () => {
  it('every embedding-path file exists (guard cannot silently pass on a moved file)', () => {
    const missing = EMBEDDING_PATH_FILES.filter((f) => !existsSync(join(REPO_ROOT, f)));
    expect(
      missing,
      `These embedding-path files moved or were deleted — update EMBEDDING_PATH_FILES so the canary keeps guarding them:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  for (const rel of EMBEDDING_PATH_FILES) {
    it(`${rel} uses Voyage only (no OpenAI/Anthropic in the embedding path)`, () => {
      const abs = join(REPO_ROOT, rel);
      if (!existsSync(abs)) return; // reported by the existence test above
      const code = stripComments(readFileSync(abs, 'utf8'));
      const hits = FORBIDDEN_IN_EMBEDDING_PATH.filter(({ pattern }) => pattern.test(code)).map(
        ({ why }) => why,
      );
      expect(
        hits,
        `${rel} references a paid chat-vendor embedding path (${hits.join('; ')}). ` +
          `Embeddings are Voyage-only by CEO directive — remove it. If this is a ` +
          `non-embedding LLM call, it does not belong in an embedding-path file.`,
      ).toEqual([]);
    });
  }

  it('the shared embedder has no OpenAI fallback in its provider resolution', () => {
    const code = stripComments(
      readFileSync(join(REPO_ROOT, 'supabase/functions/_shared/embeddings.ts'), 'utf8'),
    );
    expect(code, 'OPENAI_PROVIDER must not exist').not.toMatch(/OPENAI_PROVIDER/);
    expect(code, 'resolveProvider must not read OPENAI_API_KEY').not.toMatch(/OPENAI_API_KEY/);
    expect(code, 'Voyage must still be the embedder').toMatch(/VOYAGE_API_KEY/);
  });
});
