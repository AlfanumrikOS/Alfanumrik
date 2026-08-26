/**
 * Model Gateway — Deno / TS MODEL_FALLBACK_ORDER parity (Phase 1).
 *
 * The legacy fallback ordering (Claude-primary, OpenAI retained as fallback
 * per the 2026-08-26 quality swap back) exists TWICE:
 *   - TS (Node graph):  packages/lib/src/ai/gateway/registry.ts
 *                       -> `LEGACY_FALLBACK_ORDER`
 *   - Deno (Edge graph): supabase/functions/grounded-answer/config.ts
 *                       -> `MODEL_FALLBACK_ORDER` (read by `resolveModelOrder`)
 *
 * Deno cannot import from packages/lib, so the ordering is duplicated. If the two
 * drift, the browser/Node path and the Edge path could route the SAME
 * model_preference to different providers -- a silent provider-routing bug (P12).
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
import { LEGACY_FALLBACK_ORDER, CLAUDE_PRIMARY_FALLBACK_ORDER } from '@alfanumrik/lib/ai/gateway';

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
 * Parse a Deno order-table object literal (e.g. `MODEL_FALLBACK_ORDER` or
 * `CLAUDE_PRIMARY_FALLBACK_ORDER`) into { haiku|sonnet|auto: Target[] }. We
 * scope to the object's text (between its `export const <constName>` and the
 * following `export const <endMarker>`) then, for each key, extract the
 * ordered `{ provider: 'x', model: 'y' }` tuples.
 */
function parseDenoOrder(
  src: string,
  constName: string,
  endMarker: string,
): Record<'haiku' | 'sonnet' | 'auto', Target[]> {
  const start = src.indexOf(`export const ${constName}`);
  expect(start, `${constName} not found in Deno config`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(`export const ${endMarker}`, start);
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
  const deno = parseDenoOrder(denoSrc, 'MODEL_FALLBACK_ORDER', 'CLAUDE_PRIMARY_FALLBACK_ORDER');

  for (const key of ['haiku', 'sonnet', 'auto'] as const) {
    it(`${key} ordering matches byte-for-byte (same providers, models, order)`, () => {
      expect(deno[key]).toEqual(tsAsPlain(LEGACY_FALLBACK_ORDER[key]));
    });
  }

  it('both sides expose exactly the haiku / sonnet / auto keys', () => {
    expect(Object.keys(deno).sort()).toEqual(['auto', 'haiku', 'sonnet']);
    expect(Object.keys(LEGACY_FALLBACK_ORDER).sort()).toEqual(['auto', 'haiku', 'sonnet']);
  });

  it('auto chain is Claude-primary on both sides (Haiku -> Sonnet -> mini -> full), OpenAI retained as fallback', () => {
    // Anchor the specific current order so a reordering on EITHER side fails
    // here, not just a drift between the two. Updated 2026-08-26: the
    // quality swap back restored Claude-primary ordering.
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

// ─── CLAUDE_PRIMARY_FALLBACK_ORDER parity (percentage-rollout mechanism, 2026-08-03) ─
//
// The reconstructed pre-2026-08-02 order (the rollback target for
// ff_foxy_openai_primary_rollout_v1) ALSO exists twice — same drift risk as
// MODEL_FALLBACK_ORDER/LEGACY_FALLBACK_ORDER above, same technique here.
describe('CLAUDE_PRIMARY_FALLBACK_ORDER Deno ↔ TS parity (P12)', () => {
  const denoSrc = repoRead('supabase/functions/grounded-answer/config.ts');
  const deno = parseDenoOrder(denoSrc, 'CLAUDE_PRIMARY_FALLBACK_ORDER', 'MODEL_ROUTE_REV');

  for (const key of ['haiku', 'sonnet', 'auto'] as const) {
    it(`${key} ordering matches byte-for-byte (same providers, models, order)`, () => {
      expect(deno[key]).toEqual(tsAsPlain(CLAUDE_PRIMARY_FALLBACK_ORDER[key]));
    });
  }

  it('both sides expose exactly the haiku / sonnet / auto keys', () => {
    expect(Object.keys(deno).sort()).toEqual(['auto', 'haiku', 'sonnet']);
    expect(Object.keys(CLAUDE_PRIMARY_FALLBACK_ORDER).sort()).toEqual(['auto', 'haiku', 'sonnet']);
  });

  it('auto chain is OpenAI-primary on both sides (mini -> full -> Haiku -> Sonnet) -- the rollback target', () => {
    // CLAUDE_PRIMARY_FALLBACK_ORDER is now the OpenAI-primary rollback target
    // (swapped 2026-08-26 when Claude was restored as the default primary).
    expect(deno.auto.map((t) => `${t.provider}:${t.model}`)).toEqual([
      'openai:gpt-4o-mini',
      'openai:gpt-4o',
      'anthropic:claude-haiku-4-5-20251001',
      'anthropic:claude-sonnet-4-20250514',
    ]);
    expect(tsAsPlain(CLAUDE_PRIMARY_FALLBACK_ORDER.auto).map((t) => `${t.provider}:${t.model}`)).toEqual(
      deno.auto.map((t) => `${t.provider}:${t.model}`),
    );
  });

  it('is NOT the same order as MODEL_FALLBACK_ORDER/LEGACY_FALLBACK_ORDER (sanity — these must diverge)', () => {
    const legacyDeno = parseDenoOrder(denoSrc, 'MODEL_FALLBACK_ORDER', 'CLAUDE_PRIMARY_FALLBACK_ORDER');
    expect(deno.auto).not.toEqual(legacyDeno.auto);
    expect(CLAUDE_PRIMARY_FALLBACK_ORDER.auto).not.toEqual(LEGACY_FALLBACK_ORDER.auto);
  });
});
