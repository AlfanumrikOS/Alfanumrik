import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REG-350 companion — static structure pin for migration
 * 20260806000800_affective_profile_drop_frustration_threshold.sql
 * (Foxy North-Star Phase 1, PR6, approval A4).
 *
 * Three things this migration MUST hold, in one transaction:
 *   1. CREATE OR REPLACE compute_student_affective_profile() whose body no
 *      longer writes student_learning_profiles.frustration_threshold (the
 *      p90_rt PERCENTILE_CONT feeder goes with it) — everything else,
 *      notably the adaptive_profile boredom_floor/frustration_ceiling
 *      upsert, is preserved.
 *   2. DROP COLUMN IF EXISTS frustration_threshold on
 *      public.student_learning_profiles, AFTER the function replacement —
 *      function-first ordering means no window exists where the live
 *      function references a dropped column.
 *   3. public.evaluation_state.frustration_threshold is a DIFFERENT column
 *      on a different table, NOT covered by approval A4 — the migration
 *      must not touch evaluation_state at all.
 *
 * Static SQL-text pin (no live DB), following the established pattern in
 * safeguarding-escalations-migration.test.ts. The migration's own header
 * comments legitimately NAME frustration_threshold and evaluation_state
 * while explaining the change, so `--` comment lines are stripped before
 * asserting what the migration actually DOES.
 */

const migrationsDir = join(process.cwd(), '..', '..', 'supabase', 'migrations');
const sql = readFileSync(
  join(
    migrationsDir,
    '20260806000800_affective_profile_drop_frustration_threshold.sql',
  ),
  'utf8',
);

// Active DDL only — strip `--` comment lines (both file-header comments and
// in-body plpgsql comments, which also reference the removed write).
const activeDdl = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('migration 20260806000800 — frustration_threshold retirement structure', () => {
  it('replaces compute_student_affective_profile WITHOUT any frustration_threshold write', () => {
    const fnMatch = activeDdl.match(
      /CREATE OR REPLACE FUNCTION public\.compute_student_affective_profile[\s\S]*?\$\$;/,
    );
    expect(fnMatch).not.toBeNull();
    const fnDdl = fnMatch![0];
    // The last writer is gone: the replaced body must never mention the
    // column, nor the PERCENTILE_CONT p90 that existed solely to feed it.
    expect(fnDdl).not.toMatch(/frustration_threshold/i);
    expect(fnDdl).not.toMatch(/PERCENTILE_CONT/i);
    // ...while the unrelated affective outputs are preserved
    // (frustration_ceiling is a DIFFERENT column on adaptive_profile).
    expect(fnDdl).toMatch(/INSERT INTO adaptive_profile/);
    expect(fnDdl).toMatch(/boredom_floor/);
    expect(fnDdl).toMatch(/frustration_ceiling/);
    expect(fnDdl).toMatch(/avg_response_time_seconds/);
  });

  it('drops student_learning_profiles.frustration_threshold idempotently in the SAME file', () => {
    expect(activeDdl).toMatch(
      /ALTER TABLE public\.student_learning_profiles\s+DROP COLUMN IF EXISTS frustration_threshold/,
    );
    // Exactly ONE column drop in the whole migration — nothing else may
    // ride along under approval A4.
    const drops = activeDdl.match(/DROP COLUMN/gi) ?? [];
    expect(drops).toHaveLength(1);
    expect(activeDdl).not.toMatch(/DROP TABLE/i);
  });

  it('orders function replacement BEFORE the column drop, inside one transaction', () => {
    const fnIdx = activeDdl.indexOf(
      'CREATE OR REPLACE FUNCTION public.compute_student_affective_profile',
    );
    const dropIdx = activeDdl.search(/DROP COLUMN IF EXISTS frustration_threshold/);
    expect(fnIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeGreaterThan(-1);
    // Function-first: the last writer is replaced before the column goes.
    expect(fnIdx).toBeLessThan(dropIdx);
    // Both steps sit between BEGIN and COMMIT (single transaction).
    const beginIdx = activeDdl.search(/^BEGIN;/m);
    const commitIdx = activeDdl.search(/^COMMIT;/m);
    expect(beginIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(beginIdx).toBeLessThan(fnIdx);
    expect(commitIdx).toBeGreaterThan(dropIdx);
  });

  it('does NOT touch public.evaluation_state (its frustration_threshold is a different column, not covered by A4)', () => {
    expect(activeDdl).not.toMatch(/evaluation_state/i);
    // Belt-and-braces: the only ALTER TABLE target is student_learning_profiles.
    const alterTargets = [...activeDdl.matchAll(/ALTER TABLE\s+(\S+)/gi)].map(
      (m) => m[1],
    );
    expect(alterTargets).toEqual(['public.student_learning_profiles']);
  });

  it('re-asserts the SECURITY DEFINER execute posture (no PUBLIC/anon/authenticated EXECUTE)', () => {
    expect(activeDdl).toMatch(/SECURITY DEFINER/);
    expect(activeDdl).toMatch(/SET search_path = public/);
    expect(activeDdl).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.compute_student_affective_profile[\s\S]*?FROM PUBLIC, anon, authenticated/,
    );
  });
});
