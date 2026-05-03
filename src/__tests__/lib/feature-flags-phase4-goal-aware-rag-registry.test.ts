/**
 * Phase 4 of Goal-Adaptive Learning Layers - flag registry contract.
 * Pins parity between TS registry and SQL migration.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GOAL_ADAPTIVE_FLAGS, FLAG_DEFAULTS } from '@/lib/feature-flags';

describe('Phase 4 flag registry: ff_goal_aware_rag', () => {
  it('GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_RAG is the exact migration string', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_RAG).toBe('ff_goal_aware_rag');
  });

  it('FLAG_DEFAULTS has ff_goal_aware_rag set to false', () => {
    expect(FLAG_DEFAULTS['ff_goal_aware_rag']).toBe(false);
  });

  it('Phase 0+1+2+3 entries still present (drift catcher)', () => {
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_PROFILES).toBe('ff_goal_profiles');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_FOXY).toBe('ff_goal_aware_foxy');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_AWARE_SELECTION).toBe('ff_goal_aware_selection');
    expect(GOAL_ADAPTIVE_FLAGS.GOAL_DAILY_PLAN).toBe('ff_goal_daily_plan');
  });

  it('migration file exists at expected path', () => {
    const path = join(
      process.cwd(),
      'supabase/migrations/20260503180000_add_ff_goal_aware_rag.sql',
    );
    expect(existsSync(path)).toBe(true);
  });

  it('no goal-adaptive flag defaults to true (founder safety guard)', () => {
    for (const key of Object.values(GOAL_ADAPTIVE_FLAGS)) {
      expect(FLAG_DEFAULTS[key]).toBe(false);
    }
  });
});
