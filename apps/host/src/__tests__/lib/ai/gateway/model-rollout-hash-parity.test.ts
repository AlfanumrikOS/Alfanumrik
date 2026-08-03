/**
 * Model rollout hash parity — web/TS Gateway evaluator vs the Deno
 * grounded-answer mirror (percentage-rollout mechanism, 2026-08-03).
 *
 * Mirrors apps/host/src/__tests__/lib/feature-flags-rollout-hash-parity.test.ts
 * EXACTLY, one level down the stack: that file pins hashForRollout parity
 * between packages/lib/src/feature-flags.ts and supabase/functions/identity/
 * index.ts (mobile bootstrap). THIS file pins the same algorithm's parity
 * between the TS Model Gateway (rollout.ts, which imports hashForRollout via
 * isFeatureEnabled) and supabase/functions/grounded-answer/
 * _model-rollout-flag.ts (which cannot import packages/lib — Deno runtime —
 * so it carries its own copy).
 *
 * Both grounded-answer/claude.ts's resolveModelOrder() (Deno) and the TS
 * Gateway's resolveDefaultChain() (rollout.ts) MUST bucket the SAME caller id
 * into the SAME order (OpenAI-primary vs Claude-primary) for P12 — a caller
 * cannot get one answer style mid-conversation because one runtime's hash
 * disagreed with the other's.
 *
 * Two layers of protection (same shape as the identity parity test):
 *   1. Behavioural parity: an inline replica of the Deno copy (kept
 *      byte-equivalent to _model-rollout-flag.ts) must produce the same
 *      bucket as the canonical `hashForRollout` import, for a matrix of
 *      id/flag-name pairs, and buckets must be in 0..99.
 *   2. Source pin: the Deno file must still contain the three load-bearing
 *      expressions of the canonical algorithm, so it cannot silently drift
 *      back to an ad-hoc (or the WRONG, unsalted python-ai-proxy-style) hash
 *      without failing CI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashForRollout } from '@alfanumrik/lib/feature-flags';
import { MODEL_ROLLOUT_FLAG } from '@alfanumrik/lib/ai/gateway';

/**
 * Inline replica of the Deno duplicate in
 * supabase/functions/grounded-answer/_model-rollout-flag.ts (function
 * hashForRollout). Keep byte-equivalent to that file — the source pin below
 * guards drift.
 */
function denoHashForRollout(id: string, flagName: string): number {
  let hash = 0;
  const str = `${id}:${flagName}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

const CALLER_IDS = [
  '00000000-0000-4000-8000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  '5f2b7c1e-9a3d-4e6f-8b2a-1c9d7e5f3a1b',
  'a7e0c4d2-6b8f-4a1c-9e3d-5f7b2a8c4e6d',
  'deadbeef-dead-4eef-8eef-deadbeefdead',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
];

describe('model-rollout hash parity — canonical (packages/lib) vs grounded-answer Deno copy', () => {
  it('produces identical buckets for every caller id, using the real flag name', () => {
    for (const id of CALLER_IDS) {
      expect(
        denoHashForRollout(id, MODEL_ROLLOUT_FLAG),
        `bucket mismatch for ${id} / ${MODEL_ROLLOUT_FLAG}`,
      ).toBe(hashForRollout(id, MODEL_ROLLOUT_FLAG));
    }
  });

  it('buckets are always in 0..99 and deterministic across calls', () => {
    for (const id of CALLER_IDS) {
      const a = hashForRollout(id, MODEL_ROLLOUT_FLAG);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(100);
      expect(Number.isInteger(a)).toBe(true);
      expect(hashForRollout(id, MODEL_ROLLOUT_FLAG)).toBe(a);
    }
  });
});

describe('grounded-answer Deno copy source pin — cannot drift to an unsalted or ad-hoc hash', () => {
  // setup.ts remaps repo-root asset reads, so `supabase/...` resolves to the
  // repo root even though vitest's cwd is apps/host.
  const denoSource = readFileSync(
    resolve(process.cwd(), 'supabase/functions/grounded-answer/_model-rollout-flag.ts'),
    'utf8',
  );

  it('still declares hashForRollout with the canonical SALTED algorithm', () => {
    expect(denoSource).toMatch(/export function hashForRollout\(/);
    // The three load-bearing expressions of the canonical algorithm — the
    // SAME shape as feature-flags.ts/identity's hashForRollout, salted with
    // the flag name (NOT the unsalted inRolloutBucket/hashBucket shape used
    // by python-ai-proxy.ts / mol-shadow.ts / _shared/mol/feature-flag.ts —
    // this file deliberately does NOT reuse those, see its header).
    expect(denoSource).toContain('`${id}:${flagName}`');
    expect(denoSource).toContain('((hash << 5) - hash + str.charCodeAt(i)) | 0');
    expect(denoSource).toContain('Math.abs(hash) % 100');
  });

  it('applies the hash to the rollout decision (bucket < rollout_percentage)', () => {
    expect(denoSource).toMatch(
      /hashForRollout\(\s*callerId\s*,\s*MODEL_ROLLOUT_FLAG_NAME\s*\)\s*<\s*pct/,
    );
  });

  it('checks caller id BEFORE the flag read (fail-safe: no identity → never consult the flag)', () => {
    // Structural pin for the documented fail-safe direction: the callerId
    // falsy-check must appear textually before the readRow() call so a
    // future refactor cannot accidentally reorder them.
    const callerIdCheckIdx = denoSource.indexOf('if (!callerId) return false;');
    const readRowIdx = denoSource.indexOf('const row = await readRow();');
    expect(callerIdCheckIdx).toBeGreaterThanOrEqual(0);
    expect(readRowIdx).toBeGreaterThan(callerIdCheckIdx);
  });
});
