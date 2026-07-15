/**
 * Node↔Deno event-registry PARITY.
 *
 * The domain-event registry exists twice:
 *   - Node (source of truth): packages/lib/src/state/events/registry.ts
 *   - Deno mirror:            supabase/functions/_shared/state-runtime/events-registry.ts
 *
 * Supabase Edge Functions run under Deno and cannot import the Node `src/`
 * tree, so the mirror is maintained BY HAND. Hand-maintained mirrors drift —
 * before this test the Deno copy was missing 24 kinds (all system dot-star,
 * several teacher/parent kinds, learner.learning_action, struggle_observed,
 * next_action_resolved). This test turns that drift into a red build.
 *
 * We cannot `import` the Deno file (its `import { z } from 'https://esm.sh/...'`
 * URL specifier isn't resolvable in the Node/vitest module graph), so we read it
 * as TEXT and extract its kind set two independent ways:
 *   (a) the string literals in its `ALL_EVENT_KINDS` array, and
 *   (b) the `z.literal('<actor>.<verb>')` discriminants in its schema bodies.
 * Both must equal the Node `ALL_EVENT_KINDS` exactly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_EVENT_KINDS } from '@alfanumrik/lib/state/events/registry';

const DENO_REGISTRY_REL =
  'supabase/functions/_shared/state-runtime/events-registry.ts';

// Resolve a repo-relative file regardless of the runner's cwd. vitest's cwd is
// usually the repo root, but __dirname points at this test's dir; try both and
// walk up until the target exists. Bulletproof against monorepo cwd quirks.
function findRepoFile(relPath: string): string {
  const rel = relPath.split('/');
  const anchors: string[] = [];
  if (typeof __dirname !== 'undefined') anchors.push(__dirname);
  anchors.push(process.cwd());
  for (const anchor of anchors) {
    let dir = anchor;
    for (let i = 0; i < 10; i++) {
      const candidate = join(dir, ...rel);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    `could not locate ${relPath} from anchors: ${anchors.join(', ')}`,
  );
}

const denoSource = readFileSync(findRepoFile(DENO_REGISTRY_REL), 'utf8');

/** Kinds listed in the Deno file's `ALL_EVENT_KINDS … = [ … ] as const`. */
function extractDenoAllEventKinds(src: string): string[] {
  // Capture the array body between the assignment `= [` and `] as const` (note
  // `readonly DomainEventKind[]` also contains `[]`, so anchor on `= [` … `]`).
  const m = src.match(/ALL_EVENT_KINDS[^=]*=\s*\[([\s\S]*?)\]\s*as const/);
  expect(m, 'Deno mirror must declare ALL_EVENT_KINDS = [ … ] as const').not.toBeNull();
  const block = m![1];
  return [...block.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((mm) => mm[1]);
}

/** Kinds used as `z.literal('<actor>.<verb>')` discriminants in the Deno file. */
function extractDenoLiteralKinds(src: string): string[] {
  return [...src.matchAll(/z\.literal\('([a-z]+\.[a-z_]+)'\)/g)].map(
    (m) => m[1],
  );
}

describe('event registry Node↔Deno parity', () => {
  it('Deno ALL_EVENT_KINDS matches Node ALL_EVENT_KINDS exactly', () => {
    const denoKinds = extractDenoAllEventKinds(denoSource).sort();
    const nodeKinds = [...ALL_EVENT_KINDS].sort();
    expect(denoKinds).toEqual(nodeKinds);
  });

  it('Deno z.literal discriminants match Node ALL_EVENT_KINDS exactly', () => {
    // Every kind must be BOTH in the union (a z.literal schema) AND the frozen
    // list — catches a schema added to the Deno union but forgotten in its list
    // (or vice-versa), the same invariant the Node shape test pins.
    const denoLiterals = [...new Set(extractDenoLiteralKinds(denoSource))].sort();
    const nodeKinds = [...ALL_EVENT_KINDS].sort();
    expect(denoLiterals).toEqual(nodeKinds);
  });

  it('the new Phase 1 kind is mirrored in Deno', () => {
    expect(extractDenoAllEventKinds(denoSource)).toContain(
      'learner.turn_classified',
    );
    expect(extractDenoLiteralKinds(denoSource)).toContain(
      'learner.turn_classified',
    );
  });

  it('Deno mirror carries no kind absent from the Node source of truth', () => {
    const nodeSet = new Set<string>(ALL_EVENT_KINDS);
    for (const kind of extractDenoAllEventKinds(denoSource)) {
      expect(nodeSet.has(kind), `Deno kind "${kind}" is not in Node`).toBe(true);
    }
  });
});
