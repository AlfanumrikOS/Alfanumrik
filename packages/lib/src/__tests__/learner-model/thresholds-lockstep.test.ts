/**
 * Learner-model facade — thresholds ↔ SQL lockstep pin (REG-48 pattern).
 *
 * Reads the migration file TEXT and asserts the SQL literals equal the TS
 * constants in packages/lib/src/learner-model/thresholds.ts + bkt-mirror.ts.
 * Two SQL sources are pinned:
 *   - 20260623000100_fix_post_quiz_canonical_mastery.sql (the canonical band
 *     CASE + BKT defaults the facade mirrors — cited in the module headers)
 *   - 20260807000400_update_learner_state_post_quiz_evidence.sql (the LATEST
 *     re-creation of the RPC — evidence-columns extension; must carry the
 *     SAME band CASE + BKT defaults or the mirror silently drifts)
 *
 * If either assertion fails: SQL WINS — fix the TS mirror (and this test's
 * expectations) to match the deployed RPC, never the other way round.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  BKT_PARAMS,
  MASTERY_BAND_DEVELOPING_MIN,
  MASTERY_BAND_MASTERED_MIN,
  MASTERY_BAND_PROFICIENT_MIN,
  NEXT_CONCEPT_MASTERED_THRESHOLD,
  NEXT_CONCEPT_PRACTICE_THRESHOLD,
  RETEACH_CONCEPTUAL_ERROR_MIN,
  ZPD_SWEET_SPOT_CEILING,
  masteryBandFor,
} from '@alfanumrik/lib/learner-model';

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'supabase', 'migrations'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root (supabase/migrations) not found');
}

function readMigration(name: string): string {
  return fs.readFileSync(
    path.join(findRepoRoot(), 'supabase', 'migrations', name),
    'utf8',
  );
}

const CANONICAL_MIGRATION = '20260623000100_fix_post_quiz_canonical_mastery.sql';
const LATEST_RPC_MIGRATION =
  '20260807000400_update_learner_state_post_quiz_evidence.sql';

/** Render a TS number the way the SQL literals are written (0.4 → '0.40' etc. is NOT
 *  assumed — we assert against the exact literal styles used in the files). */
describe('learner-model thresholds — SQL lockstep (mirror of RPC 20260623000100)', () => {
  for (const migration of [CANONICAL_MIGRATION, LATEST_RPC_MIGRATION]) {
    describe(migration, () => {
      const sql = readMigration(migration);

      it('band CASE literals match the TS band constants', () => {
        // The SQL writes the band CASE with two-decimal literals.
        expect(sql).toContain(
          `v_new_mastery >= ${MASTERY_BAND_MASTERED_MIN} THEN 'mastered'`,
        );
        expect(sql).toContain(
          `v_new_mastery >= ${MASTERY_BAND_PROFICIENT_MIN.toFixed(2)} THEN 'proficient'`,
        );
        expect(sql).toContain(
          `v_new_mastery >= ${MASTERY_BAND_DEVELOPING_MIN.toFixed(2)} THEN 'developing'`,
        );
        expect(sql).toContain(`ELSE 'beginner'`);
      });

      it('BKT parameter defaults match BKT_PARAMS', () => {
        expect(sql).toContain(`p_p_learn FLOAT DEFAULT ${BKT_PARAMS.pLearn}`);
        expect(sql).toContain(`p_p_slip FLOAT DEFAULT ${BKT_PARAMS.pSlip}`);
        expect(sql).toContain(`p_p_guess FLOAT DEFAULT ${BKT_PARAMS.pGuess}`);
      });

      it('new-row prior matches BKT_PARAMS.priorInit', () => {
        expect(sql).toContain(
          `COALESCE(cm.mastery_probability, ${BKT_PARAMS.priorInit})`,
        );
      });

      it('BKT update formula shape is present (posterior + learn-transit + clamp)', () => {
        expect(sql).toMatch(/v_p_know \+ \(1\.0 - v_p_know\) \* p_p_learn/);
        expect(sql).toMatch(/LEAST\(1\.0, GREATEST\(0\.0,/);
      });
    });
  }

  it('masteryBandFor mirrors the SQL band CASE at the exact boundaries', () => {
    expect(masteryBandFor(0.95, 1)).toBe('mastered');
    expect(masteryBandFor(0.9499999, 1)).toBe('proficient');
    expect(masteryBandFor(0.7, 1)).toBe('proficient');
    expect(masteryBandFor(0.6999999, 1)).toBe('developing');
    expect(masteryBandFor(0.4, 1)).toBe('developing');
    expect(masteryBandFor(0.3999999, 1)).toBe('beginner');
    expect(masteryBandFor(0, 1)).toBe('beginner');
    expect(masteryBandFor(0.99, 0)).toBe('not_started');
  });

  it('next-action cutoffs are the assessment-pinned 0.6 / 0.85 / >=3', () => {
    // Pinned by adaptive-differential.test.ts too (REG-231..234) — these are
    // the historical ladder constants, now sourced from thresholds.ts.
    expect(NEXT_CONCEPT_PRACTICE_THRESHOLD).toBe(0.6);
    expect(NEXT_CONCEPT_MASTERED_THRESHOLD).toBe(0.85);
    expect(RETEACH_CONCEPTUAL_ERROR_MIN).toBe(3);
    // ZPD sweet-spot ceiling is the same 0.85 by design.
    expect(ZPD_SWEET_SPOT_CEILING).toBe(NEXT_CONCEPT_MASTERED_THRESHOLD);
  });
});
