/**
 * Phase 3 of Goal-Adaptive Learning Layers — flag registry contract.
 * Pins the parity between TS registry and the SQL migration string,
 * and the FLAG_DEFAULTS map.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GOAL_ADAPTIVE_FLAGS, FLAG_DEFAULTS } from '@alfanumrik/lib/feature-flags';

describe('Phase 3 flag registry: ff_goal_daily_plan', () => {
  it('GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN is the exact migration string', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN).toBe('ff_goal_daily_plan');
  });

  it('FLAG_DEFAULTS has ff_goal_daily_plan set to false', () => {
    expect(FLAG_DEFAULTS['ff_goal_daily_plan']).toBe(false);
  });

  it('Phase 0+1 entries still present (drift catcher)', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES).toBe('ff_goal_profiles');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY).toBe('ff_goal_aware_foxy');
    // ff_goal_profiles remains OFF; ff_goal_aware_foxy enabled by RCA 2026-06-21
    expect(FLAG_DEFAULTS['ff_goal_profiles']).toBe(false);
    expect(FLAG_DEFAULTS['ff_goal_aware_foxy']).toBe(true);
  });

  it('migration file exists at expected path', () => {
    const path = join(
      process.cwd(),
      'supabase/migrations/20260503160000_add_ff_goal_daily_plan.sql',
    );
    expect(existsSync(path)).toBe(true);
  });

  it('only RCA-approved goal-adaptive flags default to true (updated 2026-06-21)', () => {
    // RCA fix 2026-06-21 (CEO-approved): ff_goal_aware_foxy and ff_goal_aware_selection
    // were intentionally enabled in FLAG_DEFAULTS via migration 20260621000001.
    // All other goal-adaptive flags remain OFF.
    const RCA_ENABLED = new Set(['ff_goal_aware_foxy', 'ff_goal_aware_selection']);
    for (const key of Object.values(GOAL_ADAPTIVE_FLAGS)) {
      if (RCA_ENABLED.has(key)) {
        expect(FLAG_DEFAULTS[key]).toBe(true);
      } else {
        expect(FLAG_DEFAULTS[key]).toBe(false);
      }
    }
  });
});
