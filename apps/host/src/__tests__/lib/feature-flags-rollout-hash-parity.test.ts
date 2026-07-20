/**
 * Rollout hash parity — web evaluator vs identity Edge Function
 * (feature-flag RCA repair, 2026-07-20).
 *
 * The identity Edge Function (supabase/functions/identity/index.ts) cannot
 * import from packages/lib (Deno runtime), so it carries a DUPLICATE of the
 * canonical `hashForRollout` from packages/lib/src/feature-flags.ts. Before
 * the repair it used an ad-hoc hash, so web and identity disagreed on which
 * users sit inside an N% rollout — the same student could have a flag ON on
 * web and OFF on mobile (identity is the mobile flag source).
 *
 * Two layers of protection:
 *   1. Behavioural parity: an inline replica of the Deno copy (kept
 *      byte-equivalent to supabase/functions/identity/index.ts) must produce
 *      the same bucket as the canonical import for a matrix of uuid/flag
 *      pairs, and buckets must be in 0..99.
 *   2. Source pin: the identity function source must still contain the three
 *      load-bearing expressions of the canonical algorithm (`${userId}:${flagName}`
 *      seed, the ((h<<5)-h+c)|0 accumulator, abs%100 bucket), so the Deno
 *      copy cannot silently drift back to an ad-hoc hash without failing CI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashForRollout } from '@alfanumrik/lib/feature-flags';

/**
 * Inline replica of the Deno duplicate in
 * supabase/functions/identity/index.ts (function hashForRollout).
 * Keep byte-equivalent to that file — the source pin below guards drift.
 */
function denoHashForRollout(userId: string, flagName: string): number {
  let hash = 0;
  const str = `${userId}:${flagName}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

const USER_IDS = [
  '00000000-0000-4000-8000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  '5f2b7c1e-9a3d-4e6f-8b2a-1c9d7e5f3a1b',
  'a7e0c4d2-6b8f-4a1c-9e3d-5f7b2a8c4e6d',
  'deadbeef-dead-4eef-8eef-deadbeefdead',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
];

const FLAG_NAMES = [
  'ff_school_pulse_v1',
  'ff_adaptive_remediation_v1',
  'ff_adaptive_loops_bc_v1',
  'ff_foxy_math_format_v2',
  'ff_digital_twin_v1',
];

describe('rollout hash parity — canonical (packages/lib) vs identity Deno copy', () => {
  it('produces identical buckets for every uuid/flag pair', () => {
    for (const userId of USER_IDS) {
      for (const flagName of FLAG_NAMES) {
        expect(
          denoHashForRollout(userId, flagName),
          `bucket mismatch for ${userId} / ${flagName}`,
        ).toBe(hashForRollout(userId, flagName));
      }
    }
  });

  it('buckets are always in 0..99 and deterministic across calls', () => {
    for (const userId of USER_IDS) {
      for (const flagName of FLAG_NAMES) {
        const a = hashForRollout(userId, flagName);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(100);
        expect(Number.isInteger(a)).toBe(true);
        expect(hashForRollout(userId, flagName)).toBe(a);
      }
    }
  });

  it('the seed is order-sensitive: different flags bucket the same user differently somewhere', () => {
    // Non-vacuous check that flagName actually participates in the hash.
    const buckets = new Set(FLAG_NAMES.map((f) => hashForRollout(USER_IDS[0], f)));
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('identity Edge Function source pin — Deno copy cannot drift', () => {
  // setup.ts remaps repo-root asset reads, so `supabase/...` resolves to the
  // repo root even though vitest's cwd is apps/host.
  const identitySource = readFileSync(
    resolve(process.cwd(), 'supabase/functions/identity/index.ts'),
    'utf8',
  );

  it('still declares hashForRollout with the canonical algorithm', () => {
    expect(identitySource).toMatch(/function hashForRollout\(/);
    // The three load-bearing expressions of the canonical algorithm:
    expect(identitySource).toContain('`${userId}:${flagName}`');
    expect(identitySource).toContain('((hash << 5) - hash + str.charCodeAt(i)) | 0');
    expect(identitySource).toContain('Math.abs(hash) % 100');
  });

  it('applies the hash to rollout evaluation (bucket < rollout_percentage)', () => {
    expect(identitySource).toMatch(
      /hashForRollout\(\s*student\.id\s*,\s*flag\.flag_name\s*\)\s*<\s*flag\.rollout_percentage/,
    );
  });
});
