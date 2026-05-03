import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { GOAL_ADAPTIVE_FLAGS, FLAG_DEFAULTS } from '@/lib/feature-flags';

/**
 * Registry contract tests for the Phase 2 Goal-Aware Selection flag.
 *
 * Pins:
 *   1. The TS registry constant `GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION`
 *      to the exact string the migration writes (`ff_goal_aware_selection`).
 *      A typo on either side silently evaluates as "flag does not exist" →
 *      isFeatureEnabled returns false → consumers always get the legacy
 *      code path with no error surface. This test catches that drift.
 *   2. The SSR pre-DB-hit default for the new flag is `false`, preserving
 *      the founder constraint "Phase 2 ships OFF on prod and staging".
 *   3. The Phase 0+1 keys (GOAL_PROFILES, GOAL_AWARE_FOXY) remain present
 *      in the same registry — Phase 2 must not regress prior phases.
 *   4. The Phase 2 migration file exists at the expected timestamped path,
 *      so a missing or renamed migration fails CI before deploy.
 *
 * Owning agent: architect (registry + migration parity).
 */

describe('GOAL_ADAPTIVE_FLAGS — Phase 2 ff_goal_aware_selection', () => {
  it('exposes GOAL_AWARE_SELECTION with the exact string used by the migration', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION).toBe(
      'ff_goal_aware_selection',
    );
  });

  it('is an `as const` literal (compile-time check via type narrowing)', () => {
    // If `as const` were dropped, this literal-type assertion would no longer
    // narrow to the exact string and TypeScript would refuse the assignment.
    const selection: 'ff_goal_aware_selection' =
      GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION;
    expect(selection).toBe('ff_goal_aware_selection');
  });

  it('does NOT regress the Phase 0+1 entries (drift catcher)', () => {
    // Hard guard: if GOAL_PROFILES or GOAL_AWARE_FOXY ever disappears from
    // the registry, the Phase 0+1 wiring breaks silently. Phase 2 must be
    // additive, never substitutive.
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES).toBe('ff_goal_profiles');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY).toBe('ff_goal_aware_foxy');
  });
});

describe('FLAG_DEFAULTS — Phase 2 default is OFF', () => {
  it('defaults ff_goal_aware_selection to false (preserves legacy behavior pre-DB-hit)', () => {
    expect(FLAG_DEFAULTS[GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION]).toBe(false);
    expect(FLAG_DEFAULTS['ff_goal_aware_selection']).toBe(false);
  });

  it('does NOT enable the Phase 2 flag by default (founder safety constraint)', () => {
    // If this flag is ever flipped to true in FLAG_DEFAULTS, the
    // "ship OFF on prod and staging" constraint is violated for the SSR
    // window before the DB fetch resolves.
    const enabledKeys = Object.entries(FLAG_DEFAULTS)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    expect(enabledKeys).not.toContain('ff_goal_aware_selection');
  });

  it('continues to default the Phase 0+1 flags to false (no regression)', () => {
    expect(FLAG_DEFAULTS['ff_goal_profiles']).toBe(false);
    expect(FLAG_DEFAULTS['ff_goal_aware_foxy']).toBe(false);
  });
});

describe('Phase 2 migration filesystem contract', () => {
  it('the Phase 2 migration file exists at the timestamped path', () => {
    // The TS registry change is meaningless without the migration that
    // seeds the row. This guard couples the two so a broken-half deploy
    // (TS without SQL, or SQL without TS) is impossible to merge.
    const migrationPath = resolve(
      process.cwd(),
      'supabase/migrations/20260503140000_add_phase2_goal_aware_selection.sql',
    );
    expect(existsSync(migrationPath)).toBe(true);
  });
});
