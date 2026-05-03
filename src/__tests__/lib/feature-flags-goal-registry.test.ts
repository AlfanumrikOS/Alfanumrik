import { describe, it, expect } from 'vitest';

import { GOAL_ADAPTIVE_FLAGS, FLAG_DEFAULTS } from '@/lib/feature-flags';

/**
 * Registry contract tests for the Goal-Adaptive Learning Layers flags.
 *
 * These tests pin the registry constants to the exact strings used by the
 * seeding migration `20260503120000_add_ff_goal_adaptive_layers.sql`, and
 * verify that both flags default to OFF in the SSR pre-DB-hit defaults map.
 *
 * Why this matters:
 *   - The migration writes rows keyed by `flag_name`; the TypeScript code
 *     looks up flags by the same keys. A typo on either side silently
 *     evaluates as "flag does not exist" → returns false → consumers get the
 *     legacy code path with no error surface. This test catches that drift.
 *   - `FLAG_DEFAULTS` is the documented SSR fallback before the first DB
 *     fetch resolves. Both flags MUST default to false to preserve the
 *     "ship OFF, behavior unchanged" founder constraint.
 *
 * Owning agent: architect (registry + migration parity).
 */
describe('GOAL_ADAPTIVE_FLAGS registry', () => {
  it('exposes ff_goal_profiles with the exact string used by the migration', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES).toBe('ff_goal_profiles');
  });

  it('exposes ff_goal_aware_foxy with the exact string used by the migration', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY).toBe('ff_goal_aware_foxy');
  });

  it('contains the Phase 0+1 goal-adaptive keys (no accidental drift on the original two)', () => {
    // Phase 0+1 keys MUST remain present. Newer phases (Phase 2 onward) add
    // additional keys to this registry — assert the Phase 0+1 contract here
    // and let the per-phase test files (e.g.
    // feature-flags-phase2-goal-selection-registry.test.ts) pin their own
    // keys. Using a subset assertion keeps this test stable as the registry
    // grows additively.
    const keys = Object.keys(GOAL_ADAPTIVE_FLAGS);
    expect(keys).toContain('GOAL_PROFILES');
    expect(keys).toContain('GOAL_AWARE_FOXY');
  });

  it('is an `as const` literal (compile-time check via type narrowing)', () => {
    // If `as const` were dropped, these literal-type assertions would no
    // longer narrow to the exact strings and TypeScript would refuse the
    // assignment. The runtime equality is a redundant safety net.
    const profiles: 'ff_goal_profiles' = GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES;
    const aware: 'ff_goal_aware_foxy' = GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY;
    expect(profiles).toBe('ff_goal_profiles');
    expect(aware).toBe('ff_goal_aware_foxy');
  });
});

describe('FLAG_DEFAULTS — goal-adaptive defaults are OFF', () => {
  it('defaults ff_goal_profiles to false (preserves legacy behavior pre-DB-hit)', () => {
    expect(FLAG_DEFAULTS[GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES]).toBe(false);
    expect(FLAG_DEFAULTS['ff_goal_profiles']).toBe(false);
  });

  it('defaults ff_goal_aware_foxy to false (preserves legacy behavior pre-DB-hit)', () => {
    expect(FLAG_DEFAULTS[GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY]).toBe(false);
    expect(FLAG_DEFAULTS['ff_goal_aware_foxy']).toBe(false);
  });

  it('does NOT enable any goal-adaptive flag by default (founder safety constraint)', () => {
    // Hard guard: if either flag is ever flipped to true in FLAG_DEFAULTS, the
    // "ship OFF on prod and staging" constraint is violated for the SSR window
    // before the DB fetch resolves.
    const enabledKeys = Object.entries(FLAG_DEFAULTS)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    expect(enabledKeys).not.toContain('ff_goal_profiles');
    expect(enabledKeys).not.toContain('ff_goal_aware_foxy');
  });
});
