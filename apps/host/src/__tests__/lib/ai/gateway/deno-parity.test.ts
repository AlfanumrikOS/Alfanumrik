/**
 * Model Gateway — Deno ↔ TS MODEL_FALLBACK_ORDER parity (Phase 1).
 *
 * The legacy Anthropic-primary fallback ordering exists TWICE:
 *   - TS (Node graph):  packages/lib/src/ai/gateway/registry.ts
 *                       → `LEGACY_FALLBACK_ORDER`
 *   - Deno (Edge graph): supabase/functions/grounded-answer/config.ts
 *                       → `MODEL_FALLBACK_ORDER` (read by `resolveModelOrder`)
 *
 * Deno cannot import from packages/lib, so the ordering is duplicated. If the two
 * drift, the browser/Node path and the Edge path could route the SAME
 * model_preference to different providers — a silent provider-routing bug (P12).
 *
 * Following the established cross-runtime parity convention (see
 * grounding/config-parity.test.ts and output-screen-deno-parity.test.ts): import
 * the TS object for real, read the Deno file as text, extract its ordering, and
 * deep-compare the (provider, model) tuples per preference key.
 *
 * Owner: testing. Enforces: P12 (provider-routing parity). Reviewer: ai-engineer.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEGACY_FALLBACK_ORDER } from '@alfanumrik/lib/ai/gateway';

// cwd-resilient repo-root resolution (tests run from apps/host; supabase/ lives
// at the repo root). Mirrors edge-function-manifest.test.ts's repoPath helper.
function repoRead(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return readFileSync(fromHost, 'utf8');
  const fromRoot = resolve(process.cwd(), rel);
  return readFileSync(fromRoot, 'utf8');
}

type Target = { provider: string; model: string };

/**
 * Parse the Deno `MODEL_FALLBACK_ORDER` object literal into
 * { haiku|sonnet|auto: Target[] }. We scope to the object's text (between its
 * `export const` and the following `export const MODEL_ROUTE_REV`) then, for
 * each key, extract the ordered `{ provider: 'x', model: 'y' }` tuples.
 */
function parseDenoOrder(src: string): Record<'haiku' | 'sonnet' | 'auto', Target[]> {
  const start = src.indexOf('export const MODEL_FALLBACK_ORDER');
  expect(start, 'MODEL_FALLBACK_ORDER not found in Deno config').toBeGreaterThanOrEqual(0);
  const end = src.indexOf('export const MODEL_ROUTE_REV', start);
  const block = end > start ? src.slice(start, end) : src.slice(start);

  const out = {} as Record<'haiku' | 'sonnet' | 'auto', Target[]>;
  for (const key of ['haiku', 'sonnet', 'auto'] as const) {
    const keyMatch = block.match(new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`));
    expect(keyMatch, `Deno order missing key "${key}"`).toBeTruthy();
    const inner = keyMatch![1];
    const tuples: Target[] = [];
    const re = /\{\s*provider:\s*'([^']+)'\s*,\s*model:\s*'([^']+)'\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) {
      tuples.push({ provider: m[1], model: m[2] });
    }
    out[key] = tuples;
  }
  return out;
}

const tsAsPlain = (targets: readonly { provider: string; model: string }[]): Target[] =>
  targets.map((t) => ({ provider: t.provider, model: t.model }));

describe('MODEL_FALLBACK_ORDER Deno ↔ TS parity (P12)', () => {
  const denoSrc = repoRead('supabase/functions/grounded-answer/config.ts');
  const deno = parseDenoOrder(denoSrc);

  for (const key of ['haiku', 'sonnet', 'auto'] as const) {
    it(`${key} ordering matches byte-for-byte (same providers, models, order)`, () => {
      expect(deno[key]).toEqual(tsAsPlain(LEGACY_FALLBACK_ORDER[key]));
    });
  }

  it('both sides expose exactly the haiku / sonnet / auto keys', () => {
    expect(Object.keys(deno).sort()).toEqual(['auto', 'haiku', 'sonnet']);
    expect(Object.keys(LEGACY_FALLBACK_ORDER).sort()).toEqual(['auto', 'haiku', 'sonnet']);
  });

  it('auto chain is Anthropic-primary on both sides (Haiku → Sonnet → mini → full)', () => {
    // Anchor the specific legacy order so a reordering on EITHER side fails here,
    // not just a drift between the two.
    expect(deno.auto.map((t) => `${t.provider}:${t.model}`)).toEqual([
      'anthropic:claude-haiku-4-5-20251001',
      'anthropic:claude-sonnet-4-20250514',
      'openai:gpt-4o-mini',
      'openai:gpt-4o',
    ]);
    expect(tsAsPlain(LEGACY_FALLBACK_ORDER.auto).map((t) => `${t.provider}:${t.model}`)).toEqual(
      deno.auto.map((t) => `${t.provider}:${t.model}`),
    );
  });
});
