/**
 * Phase 5 of Goal-Adaptive Learning Layers - flag registry contract.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GOAL_ADAPTIVE_FLAGS, FLAG_DEFAULTS } from '@/lib/feature-flags';

describe('Phase 5 flag registry: ff_goal_daily_plan_reminder', () => {
  it('GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN_REMINDER matches the migration string', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN_REMINDER).toBe('ff_goal_daily_plan_reminder');
  });

  it('FLAG_DEFAULTS has ff_goal_daily_plan_reminder set to false', () => {
    expect(FLAG_DEFAULTS['ff_goal_daily_plan_reminder']).toBe(false);
  });

  it('Phase 0+1+2+3+4 entries still present (drift catcher)', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES).toBe('ff_goal_profiles');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY).toBe('ff_goal_aware_foxy');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION).toBe('ff_goal_aware_selection');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN).toBe('ff_goal_daily_plan');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_RAG).toBe('ff_goal_aware_rag');
  });

  it('migration file exists', () => {
    const path = join(
      process.cwd(),
      'supabase/migrations/20260503210000_add_ff_goal_daily_plan_reminder.sql',
    );
    expect(existsSync(path)).toBe(true);
  });

  it('founder safety guard: no goal-adaptive flag defaults true', () => {
    for (const key of Object.values(GOAL_ADAPTIVE_FLAGS)) {
      expect(FLAG_DEFAULTS[key]).toBe(false);
    }
  });
});
